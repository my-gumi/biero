import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getBuyingPower,
  getExchangeRate,
  getStockInfo,
  getOrders,
  createOrder,
} from '../dist/src/toss/client.js';
import { runTool } from '../dist/src/tools/registry.js';

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

test('getOrders builds status/limit query and sends account header', async () => {
  const original = globalThis.fetch;
  const base = 'https://mock-orders.example';
  const { fn, calls } = makeFetch((url) => {
    if (url.endsWith('/oauth2/token')) return { status: 200, body: { access_token: 'tok', expires_in: 3600 } };
    return { status: 200, body: { result: { orders: [], nextCursor: null, hasNext: false } } };
  });
  globalThis.fetch = fn;
  try {
    const res = await getOrders({ ...CREDS(base), accountSeq: '3', status: 'CLOSED', limit: 5 });
    assert.equal(res.ok, true);
    const c = calls.find((x) => x.url.includes('/api/v1/orders'));
    assert.match(c.url, /status=CLOSED/);
    assert.match(c.url, /limit=5/);
    assert.equal(c.init.headers['X-Tossinvest-Account'], '3');
  } finally {
    globalThis.fetch = original;
  }
});

test('createOrder POSTs JSON body with method and content-type', async () => {
  const original = globalThis.fetch;
  const base = 'https://mock-create.example';
  const { fn, calls } = makeFetch((url) => {
    if (url.endsWith('/oauth2/token')) return { status: 200, body: { access_token: 'tok', expires_in: 3600 } };
    return { status: 200, body: { result: { orderId: 'ord-1', clientOrderId: null } } };
  });
  globalThis.fetch = fn;
  try {
    const res = await createOrder({
      ...CREDS(base),
      accountSeq: '3',
      order: { symbol: '005930', side: 'BUY', orderType: 'LIMIT', price: '50000', quantity: '1', confirmHighValueOrder: true },
    });
    assert.equal(res.ok, true);
    assert.equal(res.body.result.orderId, 'ord-1');
    const c = calls.find((x) => x.url.endsWith('/api/v1/orders'));
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.headers['Content-Type'], 'application/json');
    const sent = JSON.parse(c.init.body);
    assert.equal(sent.symbol, '005930');
    assert.equal(sent.confirmHighValueOrder, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('place_order tool returns a preview and does NOT hit the API without confirmed=true', async () => {
  const original = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async (url) => {
    called += 1;
    if (String(url).endsWith('/oauth2/token')) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    }
    throw new Error('order endpoint must not be called during preview');
  };
  const cfg = {
    toss: { clientId: 'x', clientSecret: 'y', baseURL: 'https://mock-preview.example', accountSeq: '1' },
  };
  try {
    const out = JSON.parse(await runTool('place_order', { symbol: '005930', side: 'BUY', orderType: 'LIMIT', price: '200000', quantity: '600' }, cfg));
    assert.equal(out.needsConfirmation, true);
    assert.equal(out.preview.highValue, true, '1.2억 order should be flagged high-value');
    assert.equal(out.preview.estimatedAmountKRW, 120000000);
    assert.equal(called, 0, 'no network call (not even token) during a preview');
  } finally {
    globalThis.fetch = original;
  }
});

test('place_order tool requires a selected account', async () => {
  const out = JSON.parse(
    await runTool('place_order', { symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: '1', confirmed: true }, { toss: { clientId: 'x', clientSecret: 'y' } }),
  );
  assert.match(out.error, /계좌/);
});
