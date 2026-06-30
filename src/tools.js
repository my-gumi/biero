import { getQuote } from './toss.js';

// OpenAI-style tool definitions exposed to the model.
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_stock_price',
      description:
        '국내/미국 주식의 현재 시세(현재가)를 조회한다. 종목 심볼이 필요하다. ' +
        '국내 주식은 6자리 종목코드(예: 삼성전자=005930, SK하이닉스=000660), ' +
        '미국 주식은 티커(예: AAPL, TSLA). 사용자가 종목명으로 물으면 심볼을 추론해서 넣어라.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: '종목 심볼 (국내 6자리 코드 또는 미국 티커)' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Execute a tool call by name. Always resolves to a string (JSON or message)
 * suitable to feed back to the model as a tool result.
 */
export async function runTool(name, args, cfg) {
  if (name === 'get_stock_price') {
    const symbol = String(args?.symbol ?? '').trim();
    if (!symbol) return JSON.stringify({ error: 'symbol이 필요합니다.' });
    if (!cfg?.toss?.clientId || !cfg?.toss?.clientSecret) {
      return JSON.stringify({ error: '토스 API 키가 설정되어 있지 않습니다. biero setup 을 실행하세요.' });
    }
    const result = await getQuote({ ...cfg.toss, symbol });
    // Known Toss shape: { result: [ { symbol, lastPrice, currency, timestamp } ] }.
    // Provide a clean summary for the model, but keep the raw price body as a fallback.
    const priceRow = result?.price?.body?.result?.[0];
    const stockRow = result?.stock?.body?.result?.[0];
    const summary = priceRow
      ? {
          symbol: priceRow.symbol ?? symbol,
          name: stockRow?.name ?? null,
          lastPrice: priceRow.lastPrice ?? null,
          currency: priceRow.currency ?? null,
          market: stockRow?.market ?? null,
          timestamp: priceRow.timestamp ?? null,
        }
      : null;
    return JSON.stringify({
      ok: result.ok,
      symbol,
      summary,
      price: result?.price?.body ?? result?.price,
      stock: stockRow
        ? { name: stockRow.name, market: stockRow.market, currency: stockRow.currency, status: stockRow.status }
        : (result?.stock?.body ?? result?.stock),
    }).slice(0, 4000);
  }
  return JSON.stringify({ error: `알 수 없는 도구: ${name}` });
}
