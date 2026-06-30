import { getProvider } from './providers.js';
import { chatComplete, httpError, SYSTEM_PROMPT } from './llm.js';
import { TOOLS, runTool } from './tools.js';

const MAX_STEPS = 5;

/**
 * Run one assistant turn with tool-calling (OpenAI-compatible).
 *
 * Reads `messages` (user/assistant history), may call tools, and on success
 * pushes the final assistant message onto `messages`. Returns the reply text.
 * Anthropic falls back to plain chat (tool-calling not wired yet).
 *
 * @param {object} cfg                 loaded config ({ llm, toss })
 * @param {Array}  messages            conversation history (mutated)
 * @param {{ onTool?: (name, args) => void }} [hooks]
 */
export async function runAgent(cfg, messages, { onTool } = {}) {
  const provider = getProvider(cfg?.llm?.provider);
  const strategy = provider?.strategy ?? 'openai';
  const { baseURL, apiKey, model } = cfg?.llm ?? {};

  if (strategy === 'anthropic') {
    const content = await chatComplete({ strategy, baseURL, apiKey, model, messages });
    messages.push({ role: 'assistant', content });
    return content;
  }

  const base = String(baseURL || '').replace(/\/+$/, '');
  const convo = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

  for (let step = 0; step < MAX_STEPS; step++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    let data;
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
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('응답 시간이 초과됐어요 (120s).');
      throw e;
    } finally {
      clearTimeout(timer);
    }

    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error('빈 응답을 받았어요.');
    convo.push(msg);

    const calls = msg.tool_calls;
    if (Array.isArray(calls) && calls.length) {
      for (const call of calls) {
        const name = call.function?.name;
        let toolArgs = {};
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
