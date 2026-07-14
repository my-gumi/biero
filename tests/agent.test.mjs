import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgent } from '../dist/src/runtime/agent.js';

const TOSS = { clientId: 'x', clientSecret: 'y' };

test('Anthropic strategy runs the tool-use loop and returns final text', async () => {
  const original = globalThis.fetch;
  const reqs = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const u = String(url);
    if (u.includes('/v1/messages')) {
      reqs.push(body);
      if (reqs.length === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            stop_reason: 'tool_use',
            content: [
              { type: 'text', text: '조회할게요.' },
              { type: 'tool_use', id: 'tu_1', name: 'get_exchange_rate', input: {} },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '1달러=1493원.' }] }),
      };
    }
    // Toss token/endpoint calls made by the tool — return an empty-ish OK so the tool resolves.
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ access_token: 't', expires_in: 3600, result: {} }) };
  };
  const cfg = {
    llm: { provider: 'anthropic', baseURL: 'https://api.anthropic.com', apiKey: 'sk-ant', model: 'claude' },
    toss: TOSS,
  };
  const messages = [{ role: 'user', content: '환율 얼마야?' }];
  const seen = [];
  try {
    const reply = await runAgent(cfg, messages, { onTool: (n) => seen.push(n) });
    assert.equal(reply, '1달러=1493원.');
    assert.deepEqual(seen, ['get_exchange_rate']);
    assert.equal(reqs.length, 2, 'one turn for tool_use, one for the final answer');
    assert.ok(Array.isArray(reqs[0].tools) && reqs[0].tools.length >= 10, 'tools sent in Anthropic format');
    assert.equal(reqs[0].tools[0].input_schema !== undefined, true, 'anthropic tool uses input_schema');
    // Second turn carries assistant tool_use then user tool_result.
    const roles = reqs[1].messages.map((m) => m.role);
    assert.deepEqual(roles, ['user', 'assistant', 'user']);
    const last = reqs[1].messages[2];
    assert.equal(last.content[0].type, 'tool_result');
    assert.equal(last.content[0].tool_use_id, 'tu_1');
    // Final assistant text is appended to the caller's history.
    assert.equal(messages[messages.length - 1].role, 'assistant');
    assert.equal(messages[messages.length - 1].content, '1달러=1493원.');
  } finally {
    globalThis.fetch = original;
  }
});

test('OpenAI strategy runs the tool-call loop and returns final text', async () => {
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/chat/completions')) {
      n += 1;
      if (n === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_exchange_rate', arguments: '{}' } }],
                },
              },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content: '환율 안내드립니다.' } }] }) };
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ access_token: 't', expires_in: 3600, result: {} }) };
  };
  const cfg = { llm: { provider: 'openai', baseURL: 'https://api.openai.com/v1', apiKey: 'sk', model: 'gpt-5' }, toss: TOSS };
  const messages = [{ role: 'user', content: '환율' }];
  const seen = [];
  try {
    const reply = await runAgent(cfg, messages, { onTool: (name) => seen.push(name) });
    assert.equal(reply, '환율 안내드립니다.');
    assert.deepEqual(seen, ['get_exchange_rate']);
    assert.equal(messages[messages.length - 1].content, '환율 안내드립니다.');
  } finally {
    globalThis.fetch = original;
  }
});
