import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTossHeaders, getAccounts, getHoldings } from '../dist/src/toss/client.js';

test('buildTossHeaders attaches X-Tossinvest-Account only when accountSeq is provided', () => {
  const base = buildTossHeaders('token-123');
  assert.equal(base.authorization, 'Bearer token-123');
  assert.ok(!('X-Tossinvest-Account' in base));

  const scoped = buildTossHeaders('token-123', { accountSeq: 'ACC-9' });
  assert.equal(scoped.authorization, 'Bearer token-123');
  assert.equal(scoped['X-Tossinvest-Account'], 'ACC-9');
});

test('getAccounts normalizes account list from Toss response', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });

    if (String(url).endsWith('/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'oauth-token', expires_in: 3600 }),
      };
    }

    if (String(url).includes('/api/v1/accounts')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: [
            {
              accountSeq: '1001',
              accountName: '종합계좌',
              productName: '해외주식',
              accountNumber: '123-45',
            },
            {
              accountSeq: '1002',
              productName: '국내주식',
            },
          ],
        }),
      };
    }

    throw new Error(`unexpected url: ${url}`);
  };

  try {
    const result = await getAccounts({
      clientId: 'tsck_live_dummy',
      clientSecret: 'tssk_live_dummy',
      baseURL: 'https://openapi.tossinvest.com',
    });

    assert.equal(result.ok, true);
    assert.equal(result.accounts?.length, 2);
    assert.deepEqual(result.accounts?.map((row) => row.accountSeq), ['1001', '1002']);
    assert.equal(result.accounts?.[0]?.label, '종합계좌 · 해외주식 · 123-45 · 1001');
    assert.equal(result.accounts?.[1]?.label, '국내주식 · 1002');

    const accountCall = calls.find((entry) => String(entry.url).includes('/api/v1/accounts'));
    assert.ok(accountCall);
    assert.equal(accountCall.init.headers.authorization, 'Bearer oauth-token');
    assert.ok(!('X-Tossinvest-Account' in accountCall.init.headers));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getHoldings sends account header and symbol filter, then returns Toss asset payload', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });

    if (String(url).endsWith('/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'oauth-token', expires_in: 3600 }),
      };
    }

    if (String(url).includes('/api/v1/holdings')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            totalPurchaseAmount: { krw: '6500000', usd: null },
            marketValue: {
              amount: { krw: '7200000', usd: null },
              amountAfterCost: { krw: '7050000', usd: null },
            },
            profitLoss: {
              amount: { krw: '700000', usd: null },
              amountAfterCost: { krw: '550000', usd: null },
              rate: '0.1077',
              rateAfterCost: '0.0846',
            },
            dailyProfitLoss: {
              amount: { krw: '100000', usd: null },
              rate: '0.0141',
            },
            items: [
              {
                symbol: '005930',
                name: '삼성전자',
                currency: 'KRW',
                quantity: '100',
              },
            ],
          },
        }),
      };
    }

    throw new Error(`unexpected url: ${url}`);
  };

  try {
    const result = await getHoldings({
      clientId: 'tsck_live_dummy',
      clientSecret: 'tssk_live_dummy',
      baseURL: 'https://openapi.tossinvest.com',
      accountSeq: '1001',
      symbol: '005930',
    });

    assert.equal(result.ok, true);
    assert.equal(result.body?.result?.items?.[0]?.symbol, '005930');
    assert.equal(result.summary?.itemCount, 1);
    assert.equal(result.summary?.totalPurchaseAmount?.krw, '6500000');

    const holdingsCall = calls.find((entry) => String(entry.url).includes('/api/v1/holdings'));
    assert.ok(holdingsCall);
    assert.match(holdingsCall.url, /symbol=005930/);
    assert.equal(holdingsCall.init.headers.authorization, 'Bearer oauth-token');
    assert.equal(holdingsCall.init.headers['X-Tossinvest-Account'], '1001');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
