import test from 'node:test';
import assert from 'node:assert/strict';

import { loadHistory, saveHistory, clearHistory } from '../dist/src/runtime/history.js';

test('CLI history saves, loads, trims to 100, and clears', () => {
  // Back up any real session so this test never destroys the user's data.
  const backup = loadHistory();
  try {
    saveHistory([
      { role: 'user', content: '삼성전자 얼마?' },
      { role: 'assistant', content: '264,500원입니다.' },
    ]);
    const loaded = loadHistory();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[1].content, '264,500원입니다.');

    // Oversized histories are trimmed to the most recent 100 on save.
    saveHistory(Array.from({ length: 150 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })));
    const trimmed = loadHistory();
    assert.equal(trimmed.length, 100);
    assert.equal(trimmed.at(-1).content, 'm149');

    assert.equal(clearHistory(), true);
    assert.deepEqual(loadHistory(), []);
    assert.equal(clearHistory(), false, 'clearing an absent history returns false');
  } finally {
    if (backup.length) saveHistory(backup);
    else clearHistory();
  }
});
