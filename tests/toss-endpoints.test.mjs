import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getBuyingPower,
  getExchangeRate,
  getStockInfo,
} from '../dist/src/toss/client.js';

// Build a fetch mock whose responses expose a case-insensitive `headers.get`,
// matching the subset of the Headers API our client relies on.
function makeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init, calls.length);
    const headerMap = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return {
      ok: r.ok ?? (r.status >= 200 && r.status < 300),
      status: r.status,
      headers: { get: (k) => (headerMap.has(String(k).toLowerCase()) ? headerMap.get(String(k).toLowerCase()) : null) },
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  };
  return { fn, calls };
}

const CREDS = (baseURL) => ({ clientId: 'id_' + baseURL, clientSecret: 'secret', baseURL });

test('tossGetJson retries on 429 (Retry-After) then succeeds; sends account header', async () => {
  const original = globalThis.fetch;
  const base = 'https://mock-429.example';
  const { fn, calls } = makeFetch((url, _init, n) => {
    if (url.endsWith('/oauth2/token')) return { status: 200, body: { access_token: 'tok', expires_in: 3600 } };
    if (url.includes('/api/v1/buying-power')) {
      // First two attempts are rate-limited, third succeeds.
      if (n <= 3) return { status: 429, headers: { 'retry-after': '0.01', 'x-ratelimit-remaining': '0' }, body: { error: { message: 'rate' } } };
      return { status: 200, headers: { 'x-ratelimit-remaining': '5' }, body: { result: { currency: 'KRW', cashBuyingPower: '1000' } } };
    }
    throw new Error('unexpected ' + url);
  });
  globalThis.fetch = fn;
  try {
    const res = await getBuyingPower({ ...CREDS(base), accountSeq: '7', currency: 'KRW' });
    assert.equal(res.ok, true);
    assert.equal(res.body.result.cashBuyingPower, '1000');
    assert.equal(res.rateLimit?.remaining, 5);

    const bpCalls = calls.filter((c) => c.url.includes('/api/v1/buying-power'));
    assert.equal(bpCalls.length, 3, 'should retry twice then succeed');
    assert.match(bpCalls[0].url, /currency=KRW/);
    assert.equal(bpCalls[0].init.headers['X-Tossinvest-Account'], '7');
  } finally {
    globalThis.fetch = original;
  }
});

test('getExchangeRate defaults to USD->KRW', async () => {
  const original = globalThis.fetch;
  const base = 'https://mock-fx.example';
  const { fn, calls } = makeFetch((url) => {
    if (url.endsWith('/oauth2/token')) return { status: 200, body: { access_token: 'tok', expires_in: 3600 } };
    return { status: 200, body: { result: { baseCurrency: 'USD', quoteCurrency: 'KRW', rate: '1490' } } };
  });
  globalThis.fetch = fn;
  try {
    const res = await getExchangeRate({ ...CREDS(base) });
    assert.equal(res.ok, true);
    const fx = calls.find((c) => c.url.includes('/api/v1/exchange-rate'));
    assert.match(fx.url, /baseCurrency=USD/);
    assert.match(fx.url, /quoteCurrency=KRW/);
  } finally {
    globalThis.fetch = original;
  }
});

test('getStockInfo issues the access token only once for its two parallel calls (single-flight)', async () => {
  const original = globalThis.fetch;
  const base = 'https://mock-singleflight.example';
  const { fn, calls } = makeFetch((url) => {
    if (url.endsWith('/oauth2/token')) return { status: 200, body: { access_token: 'tok', expires_in: 3600 } };
    if (url.includes('/warnings')) return { status: 200, body: { result: [] } };
    if (url.includes('/api/v1/stocks')) return { status: 200, body: { result: [{ symbol: '005930', name: '삼성전자' }] } };
    throw new Error('unexpected ' + url);
  });
  globalThis.fetch = fn;
  try {
    const res = await getStockInfo({ ...CREDS(base), symbol: '005930' });
    assert.equal(res.ok, true);
    assert.equal(res.stock.body.result[0].name, '삼성전자');
    assert.deepEqual(res.warnings.body.result, []);

    const tokenCalls = calls.filter((c) => c.url.endsWith('/oauth2/token'));
    assert.equal(tokenCalls.length, 1, 'concurrent cold-cache callers must share one token issuance');
  } finally {
    globalThis.fetch = original;
  }
});
