import { getProvider } from '../llm/providers.js';
import { httpError, SYSTEM_PROMPT } from '../llm/client.js';
import { TOOLS, anthropicTools, runTool } from '../tools/registry.js';
import type { ChatMessage, Config } from '../shared/types.js';

const MAX_STEPS = 5;
const REQUEST_TIMEOUT_MS = 120_000;
const ANTHROPIC_MAX_TOKENS = 2048;

export interface AgentHooks {
  onTool?: (name: string, args: any) => void;
  /** Called with each text delta as the final answer streams in (CLI only). */
  onToken?: (delta: string) => void;
}

/**
 * Run one assistant turn with tool-calling. Reads `messages`, may call tools,
 * pushes the final assistant message, and returns the reply text.
 * OpenAI-compatible and Anthropic strategies both support the full tool loop.
 */
export async function runAgent(cfg: Config, messages: ChatMessage[], hooks: AgentHooks = {}): Promise<string> {
  const provider = getProvider(cfg?.llm?.provider);
  const strategy = provider?.strategy ?? 'openai';
  if (strategy === 'anthropic') return runAnthropicAgent(cfg, messages, hooks);
  return runOpenAIAgent(cfg, messages, hooks);
}

/** Abort helper shared by both strategies. */
async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw await httpError(res);
    return await res.json();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('응답 시간이 초과됐어요 (120s).');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST with `stream: true` and yield each SSE `data:` payload (raw string).
 * Aborts on the shared request timeout. Skips the `[DONE]` sentinel.
 */
async function* streamSse(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): AsyncGenerator<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw await httpError(res);
    if (!res.body) throw new Error('스트리밍 응답 본문이 비어 있어요.');

    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line; process complete lines.
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        yield payload;
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('응답 시간이 초과됐어요 (120s).');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stream an OpenAI chat completion, emitting text deltas via `onToken`, and
 * return the fully assembled assistant message (content + tool_calls).
 */
async function streamOpenAI(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  onToken?: (delta: string) => void,
): Promise<ChatMessage> {
  let content = '';
  const toolCalls: any[] = [];
  for await (const payload of streamSse(url, headers, { ...(body as object), stream: true })) {
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta = json?.choices?.[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      onToken?.(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const i = tc.index ?? 0;
      if (!toolCalls[i]) toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (tc.id) toolCalls[i].id = tc.id;
      if (tc.function?.name) toolCalls[i].function.name = tc.function.name;
      if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
    }
  }
  const msg: ChatMessage = { role: 'assistant', content: content || null };
  const assembled = toolCalls.filter(Boolean);
  if (assembled.length) msg.tool_calls = assembled;
  return msg;
}

// ── OpenAI-compatible (openai, openrouter, google, groq, xai, …, ollama) ─────
async function runOpenAIAgent(cfg: Config, messages: ChatMessage[], { onTool, onToken }: AgentHooks): Promise<string> {
  const { baseURL, apiKey, model } = cfg?.llm ?? ({} as Config['llm']);
  const base = String(baseURL || '').replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const convo: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

  for (let step = 0; step < MAX_STEPS; step++) {
    const reqBody = { model, messages: convo, tools: TOOLS, tool_choice: 'auto' };
    let msg: ChatMessage | undefined;
    if (onToken) {
      msg = await streamOpenAI(url, headers, reqBody, onToken);
    } else {
      const data = await postJson(url, headers, reqBody);
      msg = data?.choices?.[0]?.message as ChatMessage | undefined;
    }
    if (!msg) throw new Error('빈 응답을 받았어요.');
    convo.push(msg);

    const calls = msg.tool_calls;
    if (Array.isArray(calls) && calls.length) {
      for (const call of calls) {
        const name = call.function?.name;
        let toolArgs: any = {};
        try {
          toolArgs = JSON.parse(call.function?.arguments || '{}');
        } catch {
          /* keep empty args on parse failure */
        }
        onTool?.(name, toolArgs);
        const result = await runTool(name, toolArgs, cfg);
        convo.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      continue; // let the model read the tool results and respond
    }

    const content = msg.content ?? '';
    messages.push({ role: 'assistant', content });
    return content;
  }

  throw new Error('도구 호출이 너무 많이 반복됐어요. 다시 시도해 주세요.');
}

// ── Anthropic (/v1/messages tool use) ────────────────────────────────────────
type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicBlock[];
}

/**
 * Stream an Anthropic message, emitting text deltas via `onToken`, and return
 * the assembled content blocks plus the stop reason.
 */
async function streamAnthropic(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  onToken?: (delta: string) => void,
): Promise<{ blocks: AnthropicBlock[]; stopReason: string | null }> {
  const acc: Array<{ type: string; text?: string; id?: string; name?: string; json?: string }> = [];
  let stopReason: string | null = null;
  for await (const payload of streamSse(url, headers, { ...(body as object), stream: true })) {
    let ev: any;
    try {
      ev = JSON.parse(payload);
    } catch {
      continue;
    }
    if (ev.type === 'content_block_start') {
      const cb = ev.content_block ?? {};
      acc[ev.index] = { type: cb.type, text: cb.text ?? '', id: cb.id, name: cb.name, json: '' };
    } else if (ev.type === 'content_block_delta') {
      const b = acc[ev.index];
      if (!b) continue;
      if (ev.delta?.type === 'text_delta') {
        b.text = (b.text ?? '') + ev.delta.text;
        onToken?.(ev.delta.text);
      } else if (ev.delta?.type === 'input_json_delta') {
        b.json = (b.json ?? '') + (ev.delta.partial_json ?? '');
      }
    } else if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
    }
  }
  const blocks: AnthropicBlock[] = acc.filter(Boolean).map((b) => {
    if (b.type === 'tool_use') {
      let input: any = {};
      try {
        input = b.json ? JSON.parse(b.json) : {};
      } catch {
        /* leave empty on malformed partial json */
      }
      return { type: 'tool_use', id: b.id ?? '', name: b.name ?? '', input };
    }
    return { type: 'text', text: b.text ?? '' };
  });
  return { blocks, stopReason };
}

async function runAnthropicAgent(cfg: Config, messages: ChatMessage[], { onTool, onToken }: AgentHooks): Promise<string> {
  const { baseURL, apiKey, model } = cfg?.llm ?? ({} as Config['llm']);
  const base = String(baseURL || '').replace(/\/+$/, '');
  const url = `${base}/v1/messages`;
  const headers = { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' };

  // Seed the Anthropic conversation from the caller's user/assistant history.
  const convo: AnthropicMessage[] = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content ?? '' }));

  for (let step = 0; step < MAX_STEPS; step++) {
    const reqBody = { model, max_tokens: ANTHROPIC_MAX_TOKENS, system: SYSTEM_PROMPT, tools: anthropicTools(), messages: convo };
    let blocks: AnthropicBlock[];
    let stopReason: string | null;
    if (onToken) {
      ({ blocks, stopReason } = await streamAnthropic(url, headers, reqBody, onToken));
    } else {
      const data = await postJson(url, headers, reqBody);
      blocks = Array.isArray(data?.content) ? data.content : [];
      stopReason = data?.stop_reason ?? null;
    }

    const toolUses = blocks.filter((b): b is Extract<AnthropicBlock, { type: 'tool_use' }> => b.type === 'tool_use');

    if (stopReason === 'tool_use' && toolUses.length) {
      convo.push({ role: 'assistant', content: blocks });
      const results: AnthropicBlock[] = [];
      for (const tu of toolUses) {
        onTool?.(tu.name, tu.input);
        const result = await runTool(tu.name, tu.input, cfg);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
      }
      convo.push({ role: 'user', content: results });
      continue; // let the model read the tool results and respond
    }

    const text = blocks
      .filter((b): b is Extract<AnthropicBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    messages.push({ role: 'assistant', content: text });
    return text;
  }

  throw new Error('도구 호출이 너무 많이 반복됐어요. 다시 시도해 주세요.');
}
