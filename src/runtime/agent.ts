import { getProvider } from '../llm/providers.js';
import { chatComplete, httpError, SYSTEM_PROMPT } from '../llm/client.js';
import { TOOLS, runTool } from '../tools/registry.js';
import type { ChatMessage, Config } from '../shared/types.js';

const MAX_STEPS = 5;

export interface AgentHooks {
  onTool?: (name: string, args: any) => void;
}

/**
 * Run one assistant turn with tool-calling (OpenAI-compatible).
 * Reads `messages`, may call tools, pushes the final assistant message, and
 * returns the reply text. Anthropic falls back to plain chat.
 */
export async function runAgent(cfg: Config, messages: ChatMessage[], { onTool }: AgentHooks = {}): Promise<string> {
  const provider = getProvider(cfg?.llm?.provider);
  const strategy = provider?.strategy ?? 'openai';
  const { baseURL, apiKey, model } = cfg?.llm ?? ({} as Config['llm']);

  if (strategy === 'anthropic') {
    const content = await chatComplete({ strategy, baseURL, apiKey, model: model ?? '', messages });
    messages.push({ role: 'assistant', content });
    return content;
  }

  const base = String(baseURL || '').replace(/\/+$/, '');
  const convo: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

  for (let step = 0; step < MAX_STEPS; step++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    let data: any;
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, messages: convo, tools: TOOLS, tool_choice: 'auto' }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw await httpError(res);
      data = await res.json();
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('응답 시간이 초과됐어요 (120s).');
      throw e;
    } finally {
      clearTimeout(timer);
    }

    const msg = data?.choices?.[0]?.message as ChatMessage | undefined;
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
