// Toss Securities Open API client helpers.
// Docs: https://developers.tossinvest.com/docs

export const TOSS_BASE_URL = 'https://openapi.tossinvest.com';

function abortable(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

/**
 * Validate Toss Open API credentials by issuing an OAuth 2.0 access token
 * (Client Credentials Grant). Returns { ok, token?, expiresIn?, status?, code?, message? }.
 */
export async function validateTossCredentials({ clientId, clientSecret, baseURL = TOSS_BASE_URL }) {
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
      const data = await res.json().catch(() => ({}));
      return { ok: true, token: data.access_token, expiresIn: data.expires_in };
    }

    // Toss error envelope: { error: { code, message, ... } }
    let code;
    let message;
    try {
      const err = await res.json();
      code = err?.error?.code;
      message = err?.error?.message;
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, status: res.status, code, message };
  } catch (e) {
    return { ok: false, message: e.name === 'AbortError' ? '시간 초과' : e.message };
  } finally {
    t.done();
  }
}

// ── Access token cache ─────────────────────────────────────────────────────
let tokenCache = null; // { key, token, expiresAt }

/**
 * Get a valid access token, reusing a cached one until ~5s before expiry.
 * Throws on failure (with .toss carrying the structured error).
 */
export async function getAccessToken({ clientId, clientSecret, baseURL = TOSS_BASE_URL }) {
  const key = `${baseURL}::${clientId}`;
  const now = Date.now();
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > now + 5_000) {
    return tokenCache.token;
  }
  const res = await validateTossCredentials({ clientId, clientSecret, baseURL });
  if (!res.ok || !res.token) {
    const bits = [res.status && `HTTP ${res.status}`, res.code, res.message].filter(Boolean).join(' · ');
    const err = new Error(`토큰 발급 실패${bits ? ` — ${bits}` : ''}`);
    err.toss = res;
    throw err;
  }
  const ttl = res.expiresIn ? res.expiresIn * 1000 : 600_000;
  tokenCache = { key, token: res.token, expiresAt: now + ttl };
  return res.token;
}

async function tossGetJson(url, headers) {
  const t = abortable(10_000);
  try {
    const res = await fetch(url, { headers, signal: t.signal });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '시간 초과' : e.message };
  } finally {
    t.done();
  }
}

/**
 * Fetch a current quote for a symbol. Returns the RAW Toss responses so the
 * caller/LLM can interpret them without us hard-coding the response schema.
 * Market-data endpoints need only the Bearer token (no account header).
 */
export async function getQuote({ clientId, clientSecret, baseURL = TOSS_BASE_URL, symbol }) {
  let token;
  try {
    token = await getAccessToken({ clientId, clientSecret, baseURL });
  } catch (e) {
    return { ok: false, symbol, error: e.message };
  }
  const base = baseURL.replace(/\/+$/, '');
  const headers = { authorization: `Bearer ${token}` };
  const sym = encodeURIComponent(symbol);
  const [price, stock] = await Promise.all([
    tossGetJson(`${base}/api/v1/prices?symbols=${sym}`, headers),
    tossGetJson(`${base}/api/v1/stocks?symbols=${sym}`, headers),
  ]);
  return { ok: true, symbol, price, stock };
}
