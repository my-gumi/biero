import type { ChatMessage, Strategy } from '../shared/types.js';

export const SYSTEM_PROMPT =
  '당신은 Biero, 한국어로 대화하는 주식 투자 AI 비서입니다. ' +
  '간결하고 친절하게, 사실에 근거해 답하세요. ' +
  '주식의 현재 시세를 물으면 get_stock_price 도구를 사용하세요. ' +
  '국내 종목은 6자리 코드(예: 삼성전자=005930, SK하이닉스=000660), ' +
  '미국 종목은 티커(예: AAPL, TSLA)를 추론해 symbol에 넣으세요. ' +
  '도구가 돌려준 데이터를 바탕으로 가격을 알기 쉽게 알려주고, ' +
  '투자 판단의 최종 책임은 사용자에게 있음을 필요할 때 덧붙이세요.';

/** Build an Error from a non-OK fetch Response, including the provider message. */
export async function httpError(res: Response): Promise<Error> {
  let msg: string | undefined;
  try {
    const e: any = await res.json();
    msg = e?.error?.message || (typeof e?.error === 'string' ? e.error : null) || e?.message;
  } catch {
    /* non-JSON body */
  }
  return new Error(`HTTP ${res.status}${msg ? ` — ${msg}` : ''}`);
}

export interface ChatOpts {
  strategy: Strategy;
  baseURL: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
}

/** Send a chat turn and return the assistant's text (no tools). */
export async function chatComplete({ strategy, baseURL, apiKey, model, messages }: ChatOpts): Promise<string> {
  const base = String(baseURL || '').replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    if (strategy === 'anthropic') {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 1024, system: SYSTEM_PROMPT, messages }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw await httpError(res);
      const data: any = await res.json();
      return (data?.content ?? []).map((c: any) => c.text || '').join('') || '';
    }

    // OpenAI-compatible (openai, openrouter, google, groq, xai, deepseek, mistral, ollama, custom)
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw await httpError(res);
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('응답 시간이 초과됐어요 (120s).');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
