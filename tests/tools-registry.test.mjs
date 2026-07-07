import test from 'node:test';
import assert from 'node:assert/strict';

import { runTool } from '../dist/src/tools/registry.js';

test('get_holdings requires a selected Toss account in config', async () => {
  const result = await runTool(
    'get_holdings',
    {},
    {
      version: 1,
      llm: { provider: 'openai', baseURL: 'https://example.com', model: 'gpt-test' },
      toss: {
        clientId: 'tsck_live_dummy',
        clientSecret: 'tssk_live_dummy',
      },
    },
  );

  const parsed = JSON.parse(result);
  assert.match(parsed.error, /계좌/);
});
