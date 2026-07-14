// Toss Securities Open API client helpers.
// Docs: https://developers.tossinvest.com/docs

export const TOSS_BASE_URL = 'https://openapi.tossinvest.com';

export interface TossValidation {
  ok: boolean;
  token?: string;
  expiresIn?: number;
  status?: number;
  code?: string;
  message?: string;
}

/** Toss rate-limit snapshot, parsed from X-RateLimit-* response headers. */
export interface RateLimit {
  limit?: number;
  remaining?: number;
  reset?: number;
  retryAfter?: number;
}

export interface TossHttp {
  ok: boolean;
  status?: number;
  body?: any;
  error?: string;
  rateLimit?: RateLimit;
}

export interface Quote {
  ok: boolean;
  symbol: string;
  price?: TossHttp;
  stock?: TossHttp;
  error?: string;
}

export interface TossAccountItem {
  accountSeq: string;
  label: string;
  raw: any;
}

export interface TossAccountsResult {
  ok: boolean;
  status?: number;
  accounts?: TossAccountItem[];
  body?: any;
  error?: string;
}

export interface TossHoldingsSummary {
  totalPurchaseAmount?: any;
  marketValue?: any;
  profitLoss?: any;
  dailyProfitLoss?: any;
  itemCount: number;
}

export interface TossHoldingsResult {
  ok: boolean;
  status?: number;
  body?: any;
  summary?: TossHoldingsSummary;
  error?: string;
}

interface TossCreds {
  clientId: string;
  clientSecret: string;
  baseURL?: string;
}

function abortable(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

function compactUnique(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function pickAccountSeq(row: any): string {
  return String(
    row?.accountSeq ?? row?.account?.accountSeq ?? row?.account?.seq ?? row?.accountNumber ?? row?.accountNo ?? '',
  ).trim();
}

function buildAccountLabel(row: any, accountSeq: string): string {
  const parts = compactUnique([
    row?.accountName,
    row?.productName,
    row?.accountTypeName,
    row?.accountNumber,
    row?.accountNo,
    accountSeq,
  ]);
  return parts.join(' · ') || accountSeq;
}

function normalizeAccounts(body: any): TossAccountItem[] {
  const rows = Array.isArray(body?.result)
    ? body.result
    : Array.isArray(body?.results)
      ? body.results
      : Array.isArray(body?.accounts)
        ? body.accounts
        : [];

  return rows
    .map((row: any) => {
      const accountSeq = pickAccountSeq(row);
      if (!accountSeq) return null;
      return {
        accountSeq,
        label: buildAccountLabel(row, accountSeq),
        raw: row,
      } satisfies TossAccountItem;
    })
    .filter((row: TossAccountItem | null): row is TossAccountItem => Boolean(row));
}

function summarizeHoldings(body: any): TossHoldingsSummary {
  const result = body?.result ?? {};
  const items = Array.isArray(result?.items) ? result.items : [];
  return {
    totalPurchaseAmount: result?.totalPurchaseAmount ?? null,
    marketValue: result?.marketValue ?? null,
    profitLoss: result?.profitLoss ?? null,
    dailyProfitLoss: result?.dailyProfitLoss ?? null,
    itemCount: items.length,
  };
}

export function buildTossHeaders(token: string, opts: { accountSeq?: string } = {}): Record<string, string> {
  const headers: Record<string, string> = { authorization: ['Bearer', token].join(' ') };
  const accountSeq = String(opts.accountSeq ?? '').trim();
  if (accountSeq) headers['X-Tossinvest-Account'] = accountSeq;
  return headers;
}

/**
 * Validate Toss Open API credentials by issuing an OAuth 2.0 access token
 * (Client Credentials Grant).
 */
export async function validateTossCredentials({
  clientId,
  clientSecret,
  baseURL = TOSS_BASE_URL,
}: TossCreds): Promise<TossValidation> {
  const t = abortable(10_000);
  try {
    const res = await fetch(`${baseURL.replace(/\/+$/, '')}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: t.signal,
    });

    if (res.ok) {
      const data: any = await res.json().catch(() => ({}));
      return { ok: true, token: data.access_token, expiresIn: data.expires_in };
    }

    let code: string | undefined;
    let message: string | undefined;
    try {
      const err: any = await res.json();
      code = err?.error?.code;
      message = err?.error?.message;
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, status: res.status, code, message };
  } catch (e: any) {
    return { ok: false, message: e?.name === 'AbortError' ? '시간 초과' : e?.message };
  } finally {
    t.done();
  }
}

// ── Access token cache ─────────────────────────────────────────────────────
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;
// Single-flight guard: concurrent callers share one issuance. Toss invalidates
// the previous token when a new one is issued (client_credentials, single
// active token), so parallel requests must NOT each issue their own.
let tokenInflight: { key: string; promise: Promise<string> } | null = null;

async function issueToken({ clientId, clientSecret, baseURL, key }: TossCreds & { key: string }): Promise<string> {
  const res = await validateTossCredentials({ clientId, clientSecret, baseURL });
  if (!res.ok || !res.token) {
    const bits = [res.status && `HTTP ${res.status}`, res.code, res.message].filter(Boolean).join(' · ');
    const err = new Error(`토큰 발급 실패${bits ? ` — ${bits}` : ''}`) as Error & { toss?: TossValidation };
    err.toss = res;
    throw err;
  }
  const ttl = res.expiresIn ? res.expiresIn * 1000 : 600_000;
  tokenCache = { key, token: res.token, expiresAt: Date.now() + ttl };
  return res.token;
}

/** Get a valid access token, reusing a cached one until ~5s before expiry. */
export async function getAccessToken({ clientId, clientSecret, baseURL = TOSS_BASE_URL }: TossCreds): Promise<string> {
  const key = `${baseURL}::${clientId}`;
  const now = Date.now();
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > now + 5_000) {
    return tokenCache.token;
  }
  // Coalesce concurrent cold-cache issuances into a single request.
  if (tokenInflight && tokenInflight.key === key) return tokenInflight.promise;
  const promise = issueToken({ clientId, clientSecret, baseURL, key }).finally(() => {
    if (tokenInflight?.key === key) tokenInflight = null;
  });
  tokenInflight = { key, promise };
  return promise;
}

const RATE_LIMIT_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRateLimit(headers: Headers | undefined): RateLimit {
  if (!headers || typeof headers.get !== 'function') return {};
  const num = (name: string): number | undefined => {
    const raw = headers.get(name);
    if (raw == null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    limit: num('x-ratelimit-limit'),
    remaining: num('x-ratelimit-remaining'),
    reset: num('x-ratelimit-reset'),
    retryAfter: num('retry-after'),
  };
}

/**
 * Compute the backoff delay (ms) before retrying a 429. Honors `Retry-After`
 * (falling back to `X-RateLimit-Reset`), otherwise exponential 1s→2s→4s, plus
 * jitter to avoid thundering-herd retries.
 */
function retryDelayMs(rateLimit: RateLimit, attempt: number): number {
  const hinted = rateLimit.retryAfter ?? rateLimit.reset;
  const baseSeconds = hinted != null && hinted > 0 ? hinted : 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(baseSeconds * 1000, 10_000) + jitter;
}

/**
 * Core Toss request with transparent 429 retry (Retry-After / backoff+jitter).
 * Method-agnostic: GET helpers pass headers only; write helpers pass method +
 * JSON body. Returns the RAW parsed response.
 */
async function tossRequest(url: string, init: RequestInit): Promise<TossHttp> {
  let lastError: string | undefined;
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    const t = abortable(10_000);
    try {
      const res = await fetch(url, { ...init, signal: t.signal });
      const rateLimit = parseRateLimit(res.headers);
      if (res.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
        await sleep(retryDelayMs(rateLimit, attempt));
        continue;
      }
      const body = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, body, rateLimit };
    } catch (e: any) {
      lastError = e?.name === 'AbortError' ? '시간 초과' : e?.message;
      return { ok: false, error: lastError };
    } finally {
      t.done();
    }
  }
  return { ok: false, status: 429, error: lastError ?? '레이트리밋 초과 (429)' };
}

function tossGetJson(url: string, headers: Record<string, string>): Promise<TossHttp> {
  return tossRequest(url, { headers });
}

/**
 * Authenticated GET against the Toss Open API. Resolves an access token
 * (cached), builds standard headers, and delegates to {@link tossGetJson}
 * (which transparently retries on 429). Returns the RAW Toss response so the
 * caller/LLM can interpret the payload.
 */
async function authedGet(
  { clientId, clientSecret, baseURL = TOSS_BASE_URL }: TossCreds,
  path: string,
  opts: { accountSeq?: string } = {},
): Promise<TossHttp> {
  let token: string;
  try {
    token = await getAccessToken({ clientId, clientSecret, baseURL });
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
  const base = baseURL.replace(/\/+$/, '');
  return tossGetJson(`${base}${path}`, buildTossHeaders(token, { accountSeq: opts.accountSeq }));
}

/** Authenticated POST (JSON body) against the Toss Open API. */
async function authedSend(
  { clientId, clientSecret, baseURL = TOSS_BASE_URL }: TossCreds,
  path: string,
  opts: { accountSeq?: string; body?: unknown } = {},
): Promise<TossHttp> {
  let token: string;
  try {
    token = await getAccessToken({ clientId, clientSecret, baseURL });
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
  const base = baseURL.replace(/\/+$/, '');
  return tossRequest(`${base}${path}`, {
    method: 'POST',
    headers: { ...buildTossHeaders(token, { accountSeq: opts.accountSeq }), 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body ?? {}),
  });
}

export async function getAccounts({
  clientId,
  clientSecret,
  baseURL = TOSS_BASE_URL,
}: TossCreds): Promise<TossAccountsResult> {
  let token: string;
  try {
    token = await getAccessToken({ clientId, clientSecret, baseURL });
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }

  const base = baseURL.replace(/\/+$/, '');
  const res = await tossGetJson(`${base}/api/v1/accounts`, buildTossHeaders(token));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      body: res.body,
      error: res.error || res.body?.error?.message || res.body?.message,
    };
  }

  return {
    ok: true,
    status: res.status,
    body: res.body,
    accounts: normalizeAccounts(res.body),
  };
}

export async function getHoldings({
  clientId,
  clientSecret,
  baseURL = TOSS_BASE_URL,
  accountSeq,
  symbol,
}: TossCreds & { accountSeq: string; symbol?: string }): Promise<TossHoldingsResult> {
  let token: string;
  try {
    token = await getAccessToken({ clientId, clientSecret, baseURL });
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }

  const base = baseURL.replace(/\/+$/, '');
  const url = new URL(`${base}/api/v1/holdings`);
  const cleanSymbol = String(symbol ?? '').trim();
  if (cleanSymbol) url.searchParams.set('symbol', cleanSymbol);

  const res = await tossGetJson(url.toString(), buildTossHeaders(token, { accountSeq }));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      body: res.body,
      error: res.error || res.body?.error?.message || res.body?.message,
    };
  }

  return {
    ok: true,
    status: res.status,
    body: res.body,
    summary: summarizeHoldings(res.body),
  };
}

/**
 * Fetch a current quote for a symbol. Returns the RAW Toss responses so the
 * caller/LLM can interpret them without us hard-coding the response schema.
 */
export async function getQuote({
  clientId,
  clientSecret,
  baseURL = TOSS_BASE_URL,
  symbol,
}: TossCreds & { symbol: string }): Promise<Quote> {
  let token: string;
  try {
    token = await getAccessToken({ clientId, clientSecret, baseURL });
  } catch (e: any) {
    return { ok: false, symbol, error: e?.message };
  }
  const base = baseURL.replace(/\/+$/, '');
  const headers = buildTossHeaders(token);
  const sym = encodeURIComponent(symbol);
  const [price, stock] = await Promise.all([
    tossGetJson(`${base}/api/v1/prices?symbols=${sym}`, headers),
    tossGetJson(`${base}/api/v1/stocks?symbols=${sym}`, headers),
  ]);
  return { ok: true, symbol, price, stock };
}

// ── Query-string helper ────────────────────────────────────────────────────
function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

type Currency = 'KRW' | 'USD';

// ── Order info (#6, #7) — require account context ───────────────────────────

/** Cash buying power for the selected account, in the requested currency. */
export function getBuyingPower(
  creds: TossCreds & { accountSeq: string; currency?: Currency },
): Promise<TossHttp> {
  const currency = creds.currency ?? 'KRW';
  return authedGet(creds, `/api/v1/buying-power${qs({ currency })}`, { accountSeq: creds.accountSeq });
}

/** Quantity of `symbol` the selected account can currently sell. */
export function getSellableQuantity(
  creds: TossCreds & { accountSeq: string; symbol: string },
): Promise<TossHttp> {
  return authedGet(creds, `/api/v1/sellable-quantity${qs({ symbol: creds.symbol })}`, {
    accountSeq: creds.accountSeq,
  });
}

/** Trading commission rates (KR·US) for the selected account. */
export function getCommissions(creds: TossCreds & { accountSeq: string }): Promise<TossHttp> {
  return authedGet(creds, '/api/v1/commissions', { accountSeq: creds.accountSeq });
}

// ── Market info (#12) — no account context ──────────────────────────────────

/** Exchange rate for a currency pair (defaults USD→KRW). */
export function getExchangeRate(
  creds: TossCreds & { baseCurrency?: Currency; quoteCurrency?: Currency },
): Promise<TossHttp> {
  const baseCurrency = creds.baseCurrency ?? 'USD';
  const quoteCurrency = creds.quoteCurrency ?? 'KRW';
  return authedGet(creds, `/api/v1/exchange-rate${qs({ baseCurrency, quoteCurrency })}`);
}

/** Market operating hours / holidays for KR or US. */
export function getMarketCalendar(creds: TossCreds & { country: 'KR' | 'US' }): Promise<TossHttp> {
  return authedGet(creds, `/api/v1/market-calendar/${creds.country}`);
}

// ── Market data (#10) — no account context ──────────────────────────────────

/** Order book (호가) — bid/ask ladder for `symbol`. */
export function getOrderbook(creds: TossCreds & { symbol: string }): Promise<TossHttp> {
  return authedGet(creds, `/api/v1/orderbook${qs({ symbol: creds.symbol })}`);
}

/** Recent trades (체결) for `symbol`. `count` caps how many are returned. */
export function getTrades(creds: TossCreds & { symbol: string; count?: number }): Promise<TossHttp> {
  return authedGet(creds, `/api/v1/trades${qs({ symbol: creds.symbol, count: creds.count })}`);
}

/** OHLCV candles (캔들) for `symbol`. `interval` is '1m' or '1d' (default '1d'). */
export function getCandles(
  creds: TossCreds & { symbol: string; interval?: '1m' | '1d'; count?: number; before?: string },
): Promise<TossHttp> {
  const interval = creds.interval ?? '1d';
  return authedGet(
    creds,
    `/api/v1/candles${qs({ symbol: creds.symbol, interval, count: creds.count, before: creds.before })}`,
  );
}

/** Upper/lower price limits (상·하한가) for `symbol`. */
export function getPriceLimits(creds: TossCreds & { symbol: string }): Promise<TossHttp> {
  return authedGet(creds, `/api/v1/price-limits${qs({ symbol: creds.symbol })}`);
}

// ── Stock info (#11) — no account context ───────────────────────────────────

/**
 * Canonical stock info + purchase warnings (유의사항) for `symbol`. Lets the
 * model confirm a guessed symbol resolves to the expected name before acting.
 */
export async function getStockInfo(creds: TossCreds & { symbol: string }): Promise<{
  ok: boolean;
  symbol: string;
  stock?: TossHttp;
  warnings?: TossHttp;
  error?: string;
}> {
  const sym = encodeURIComponent(creds.symbol);
  const [stock, warnings] = await Promise.all([
    authedGet(creds, `/api/v1/stocks${qs({ symbols: creds.symbol })}`),
    authedGet(creds, `/api/v1/stocks/${sym}/warnings`),
  ]);
  return { ok: stock.ok || warnings.ok, symbol: creds.symbol, stock, warnings };
}

// ── Orders (#8, #9) — require account context ───────────────────────────────

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';
export type TimeInForce = 'DAY' | 'CLS';

/** Order-create request body. Quantity-based (KR·US) or amount-based (US MARKET). */
export interface OrderCreateBody {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity?: string;
  price?: string;
  orderAmount?: string;
  timeInForce?: TimeInForce;
  confirmHighValueOrder?: boolean;
  clientOrderId?: string;
}

export interface OrderModifyBody {
  orderType: OrderType;
  quantity?: string;
  price?: string;
  confirmHighValueOrder?: boolean;
}

/** List orders. `status` is 'OPEN' (대기) or 'CLOSED' (종료). */
export function getOrders(
  creds: TossCreds & {
    accountSeq: string;
    status?: 'OPEN' | 'CLOSED';
    symbol?: string;
    limit?: number;
    cursor?: string;
    from?: string;
    to?: string;
  },
): Promise<TossHttp> {
  const status = creds.status ?? 'OPEN';
  const path = `/api/v1/orders${qs({
    status,
    symbol: creds.symbol,
    limit: creds.limit,
    cursor: creds.cursor,
    from: creds.from,
    to: creds.to,
  })}`;
  return authedGet(creds, path, { accountSeq: creds.accountSeq });
}

/** Fetch one order's details (incl. execution). */
export function getOrderDetail(creds: TossCreds & { accountSeq: string; orderId: string }): Promise<TossHttp> {
  return authedGet(creds, `/api/v1/orders/${encodeURIComponent(creds.orderId)}`, { accountSeq: creds.accountSeq });
}

/** ⚠️ Place a REAL order. Callers MUST have explicit user confirmation. */
export function createOrder(creds: TossCreds & { accountSeq: string; order: OrderCreateBody }): Promise<TossHttp> {
  return authedSend(creds, '/api/v1/orders', { accountSeq: creds.accountSeq, body: creds.order });
}

/** ⚠️ Modify a REAL pending order. Returns a NEW orderId. */
export function modifyOrder(
  creds: TossCreds & { accountSeq: string; orderId: string; body: OrderModifyBody },
): Promise<TossHttp> {
  return authedSend(creds, `/api/v1/orders/${encodeURIComponent(creds.orderId)}/modify`, {
    accountSeq: creds.accountSeq,
    body: creds.body,
  });
}

/** ⚠️ Cancel a REAL pending order. */
export function cancelOrder(creds: TossCreds & { accountSeq: string; orderId: string }): Promise<TossHttp> {
  return authedSend(creds, `/api/v1/orders/${encodeURIComponent(creds.orderId)}/cancel`, {
    accountSeq: creds.accountSeq,
    body: {},
  });
}
