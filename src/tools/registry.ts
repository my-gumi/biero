import {
  getHoldings,
  getQuote,
  getBuyingPower,
  getSellableQuantity,
  getCommissions,
  getExchangeRate,
  getMarketCalendar,
  getOrderbook,
  getTrades,
  getCandles,
  getPriceLimits,
  getStockInfo,
  getOrders,
  getOrderDetail,
  createOrder,
  modifyOrder,
  cancelOrder,
  type OrderCreateBody,
} from '../toss/client.js';
import type { Config } from '../shared/types.js';

/** Orders whose estimated KRW notional reaches this need explicit confirmation. */
const HIGH_VALUE_KRW = 100_000_000;

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const SYMBOL_HINT =
  '국내 주식은 6자리 종목코드(예: 삼성전자=005930, SK하이닉스=000660), 미국 주식은 티커(예: AAPL, TSLA).';

// OpenAI-style tool definitions exposed to the model.
export const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_stock_price',
      description:
        '국내/미국 주식의 현재 시세(현재가)를 조회한다. 종목 심볼이 필요하다. ' +
        SYMBOL_HINT +
        ' 사용자가 종목명으로 물으면 심볼을 추론해서 넣어라.',
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
  {
    type: 'function',
    function: {
      name: 'get_holdings',
      description:
        '선택된 토스증권 계좌의 보유 주식을 조회한다. symbol을 주면 해당 종목만 필터링한다. ' +
        '보유 종목, 평가금액, 손익, 일간 손익을 확인할 때 사용한다.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: '선택 사항. 종목 심볼 (국내 6자리 코드 또는 미국 티커). 비우면 전체 보유 종목 조회.',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stock_info',
      description:
        '종목의 기본정보(정식 종목명·시장·통화·상장상태)와 매수 유의사항(경고)을 조회한다. ' +
        '추론한 심볼이 맞는 종목인지 확인하거나, 매수 전 유의사항을 점검할 때 사용한다. ' +
        SYMBOL_HINT,
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
  {
    type: 'function',
    function: {
      name: 'get_buying_power',
      description:
        '선택된 토스증권 계좌의 현금 기반 매수 가능 금액을 조회한다. "얼마까지 살 수 있어?"에 사용한다. ' +
        'currency로 KRW(원화) 또는 USD(달러)를 지정한다.',
      parameters: {
        type: 'object',
        properties: {
          currency: { type: 'string', enum: ['KRW', 'USD'], description: '통화. 기본값 KRW.' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_trade_info',
      description:
        '거래 가능 정보를 조회한다: 지정한 종목의 판매 가능 수량과, 국내·미국 매매 수수료율. ' +
        '"얼마나 팔 수 있어?", "수수료 얼마야?"에 사용한다. ' +
        SYMBOL_HINT,
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: '선택 사항. 판매 가능 수량을 조회할 종목 심볼. 비우면 수수료 정보만 조회.',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_exchange_rate',
      description:
        '통화 환율을 조회한다(기본 USD→KRW). 원/달러 환율을 물으면 사용한다.',
      parameters: {
        type: 'object',
        properties: {
          baseCurrency: { type: 'string', enum: ['KRW', 'USD'], description: '기준 통화. 기본값 USD.' },
          quoteCurrency: { type: 'string', enum: ['KRW', 'USD'], description: '표시 통화. 기본값 KRW.' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_hours',
      description:
        '주식 시장 운영시간·개장 여부를 조회한다(오늘/전영업일/다음영업일의 정규장·프리마켓·애프터마켓 시각). ' +
        'country로 KR(국내) 또는 US(미국)를 지정한다. "지금 장 열려?"에 사용한다.',
      parameters: {
        type: 'object',
        properties: {
          country: { type: 'string', enum: ['KR', 'US'], description: '시장 국가. 기본값 KR.' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_orderbook',
      description: '종목의 실시간 호가(매도·매수 호가와 잔량)를 조회한다. ' + SYMBOL_HINT,
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: '종목 심볼' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_trades',
      description: '종목의 최근 체결 내역(체결가·수량·시각)을 조회한다. ' + SYMBOL_HINT,
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: '종목 심볼' },
          count: { type: 'integer', description: '가져올 체결 개수 (선택).' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_candles',
      description:
        '종목의 캔들(OHLCV: 시가·고가·저가·종가·거래량)을 조회한다. interval은 1m(분봉) 또는 1d(일봉). ' +
        '추세·차트 관련 질문에 사용한다. ' +
        SYMBOL_HINT,
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: '종목 심볼' },
          interval: { type: 'string', enum: ['1m', '1d'], description: '봉 간격. 기본값 1d.' },
          count: { type: 'integer', description: '가져올 캔들 개수 (선택).' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_price_limits',
      description: '종목의 상한가·하한가(당일 가격 제한폭)를 조회한다. ' + SYMBOL_HINT,
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: '종목 심볼' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_orders',
      description:
        '선택된 계좌의 주문 내역을 조회한다. status=OPEN(대기·미체결), status=CLOSED(종료·체결/취소). ' +
        'symbol로 특정 종목만 필터링 가능. "내 주문 상태", "미체결 주문"에 사용한다.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['OPEN', 'CLOSED'], description: '주문 상태. 기본값 OPEN.' },
          symbol: { type: 'string', description: '선택 사항. 종목 심볼 필터.' },
          limit: { type: 'integer', description: '가져올 개수 (1~100, 기본 20).' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_order_detail',
      description: '주문 ID로 개별 주문의 상세(체결 내역 포함)를 조회한다.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: '주문 ID' },
        },
        required: ['orderId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'place_order',
      description:
        '⚠️ 실제 주식 주문을 넣는다(실거래·실제 돈). 반드시 2단계로 사용하라: ' +
        '(1) confirmed 없이(또는 false) 호출하면 API를 호출하지 않고 주문 미리보기만 반환한다. ' +
        '그 내용을 사용자에게 그대로 보여주고 "정말 주문할까요?"로 명시적 동의를 받아라. ' +
        '(2) 사용자가 이번 턴에서 분명히 동의한 경우에만 confirmed=true로 다시 호출해 실제 체결한다. ' +
        '사용자의 명시적 동의 없이 confirmed=true를 절대 넣지 마라. ' +
        'orderType=LIMIT이면 price 필수, MARKET이면 price 무시. ' +
        'quantity(주 수) 또는 orderAmount(달러, 미국 시장가 매수 전용) 중 하나로 수량을 지정한다.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: '종목 심볼. ' + SYMBOL_HINT },
          side: { type: 'string', enum: ['BUY', 'SELL'], description: '매수(BUY)/매도(SELL)' },
          orderType: { type: 'string', enum: ['LIMIT', 'MARKET'], description: '지정가(LIMIT)/시장가(MARKET)' },
          quantity: { type: 'string', description: '주문 수량(주). orderAmount 대신 사용.' },
          price: { type: 'string', description: 'LIMIT 주문 가격. MARKET이면 생략.' },
          orderAmount: { type: 'string', description: '주문 금액(달러). 미국 MARKET 매수 전용.' },
          timeInForce: { type: 'string', enum: ['DAY', 'CLS'], description: '유효조건. 기본 DAY.' },
          confirmed: {
            type: 'boolean',
            description: '사용자의 명시적 동의를 받은 뒤에만 true. 없으면 미리보기만 반환.',
          },
        },
        required: ['symbol', 'side', 'orderType'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'modify_order',
      description:
        '⚠️ 대기 중인 실제 주문을 정정한다(실거래). place_order와 동일하게 2단계로 사용하라: ' +
        'confirmed 없이 호출하면 미리보기만 반환하고, 사용자 동의 후에만 confirmed=true로 실제 정정한다. ' +
        '정정 시 새 주문 ID가 발급된다.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: '정정할 원주문 ID' },
          orderType: { type: 'string', enum: ['LIMIT', 'MARKET'], description: '변경할 호가 유형' },
          quantity: { type: 'string', description: '변경할 수량(선택)' },
          price: { type: 'string', description: '변경할 가격(LIMIT일 때)' },
          confirmed: { type: 'boolean', description: '사용자 동의 후에만 true.' },
        },
        required: ['orderId', 'orderType'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_order',
      description:
        '⚠️ 대기 중인 실제 주문을 취소한다(실거래). confirmed 없이 호출하면 취소 대상만 미리보기로 반환하고, ' +
        '사용자가 취소에 동의한 경우에만 confirmed=true로 실제 취소한다.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: '취소할 주문 ID' },
          confirmed: { type: 'boolean', description: '사용자 동의 후에만 true.' },
        },
        required: ['orderId'],
        additionalProperties: false,
      },
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function hasKeys(cfg: Config): boolean {
  return Boolean(cfg?.toss?.clientId && cfg?.toss?.clientSecret);
}

const ERR_NO_KEYS = JSON.stringify({
  error: '토스 API 키가 설정되어 있지 않습니다. biero setup 을 실행하세요.',
});
const ERR_NO_ACCOUNT = JSON.stringify({
  error: '선택된 토스 계좌가 없습니다. biero setup 에서 계좌를 선택해 주세요.',
});

function clip(value: unknown): string {
  return JSON.stringify(value).slice(0, 4000);
}

/** Extract the `result` payload from a raw Toss response, or an error object. */
function unwrap(res: { ok: boolean; status?: number; body?: any; error?: string }): unknown {
  if (res.ok) return res.body?.result ?? res.body ?? null;
  return { error: res.error || res.body?.error?.message || res.body?.message || `HTTP ${res.status ?? '?'}` };
}

/** Execute a tool call by name. Always resolves to a string for the model. */
export async function runTool(name: string, args: any, cfg: Config): Promise<string> {
  if (!hasKeys(cfg)) return ERR_NO_KEYS;
  const symbol = String(args?.symbol ?? '').trim();

  if (name === 'get_stock_price') {
    if (!symbol) return JSON.stringify({ error: 'symbol이 필요합니다.' });
    const result = await getQuote({ ...cfg.toss, symbol });
    // Known Toss shape: { result: [ { symbol, lastPrice, currency, timestamp } ] }.
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
    return clip({
      ok: result.ok,
      symbol,
      summary,
      price: result?.price?.body ?? result?.price,
      stock: stockRow
        ? { name: stockRow.name, market: stockRow.market, currency: stockRow.currency, status: stockRow.status }
        : (result?.stock?.body ?? result?.stock),
    });
  }

  if (name === 'get_holdings') {
    if (!cfg?.toss?.accountSeq) return ERR_NO_ACCOUNT;
    const result = await getHoldings({
      ...cfg.toss,
      accountSeq: cfg.toss.accountSeq,
      ...(symbol ? { symbol } : {}),
    });
    return clip({
      ok: result.ok,
      symbol: symbol || null,
      accountSeq: cfg.toss.accountSeq,
      accountLabel: cfg.toss.accountLabel ?? null,
      summary: result.summary ?? null,
      holdings: result.body?.result?.items ?? [],
      raw: result.body ?? result,
      error: result.error ?? null,
    });
  }

  if (name === 'get_stock_info') {
    if (!symbol) return JSON.stringify({ error: 'symbol이 필요합니다.' });
    const result = await getStockInfo({ ...cfg.toss, symbol });
    return clip({
      ok: result.ok,
      symbol,
      stock: result.stock?.body?.result?.[0] ?? unwrap(result.stock ?? { ok: false }),
      warnings: result.warnings?.body?.result ?? unwrap(result.warnings ?? { ok: false }),
    });
  }

  if (name === 'get_buying_power') {
    if (!cfg?.toss?.accountSeq) return ERR_NO_ACCOUNT;
    const currency = args?.currency === 'USD' ? 'USD' : 'KRW';
    const result = await getBuyingPower({ ...cfg.toss, accountSeq: cfg.toss.accountSeq, currency });
    return clip({ ok: result.ok, currency, buyingPower: unwrap(result) });
  }

  if (name === 'get_trade_info') {
    if (!cfg?.toss?.accountSeq) return ERR_NO_ACCOUNT;
    const accountSeq = cfg.toss.accountSeq;
    const [sellable, commissions] = await Promise.all([
      symbol ? getSellableQuantity({ ...cfg.toss, accountSeq, symbol }) : Promise.resolve(null),
      getCommissions({ ...cfg.toss, accountSeq }),
    ]);
    return clip({
      ok: commissions.ok,
      symbol: symbol || null,
      sellable: sellable ? unwrap(sellable) : null,
      commissions: unwrap(commissions),
    });
  }

  if (name === 'get_exchange_rate') {
    const baseCurrency = args?.baseCurrency === 'KRW' ? 'KRW' : 'USD';
    const quoteCurrency = args?.quoteCurrency === 'USD' ? 'USD' : 'KRW';
    const result = await getExchangeRate({ ...cfg.toss, baseCurrency, quoteCurrency });
    return clip({ ok: result.ok, exchangeRate: unwrap(result) });
  }

  if (name === 'get_market_hours') {
    const country = args?.country === 'US' ? 'US' : 'KR';
    const result = await getMarketCalendar({ ...cfg.toss, country });
    return clip({ ok: result.ok, country, calendar: unwrap(result) });
  }

  if (name === 'get_orderbook') {
    if (!symbol) return JSON.stringify({ error: 'symbol이 필요합니다.' });
    const result = await getOrderbook({ ...cfg.toss, symbol });
    return clip({ ok: result.ok, symbol, orderbook: unwrap(result) });
  }

  if (name === 'get_recent_trades') {
    if (!symbol) return JSON.stringify({ error: 'symbol이 필요합니다.' });
    const count = Number.isFinite(args?.count) ? Number(args.count) : undefined;
    const result = await getTrades({ ...cfg.toss, symbol, count });
    return clip({ ok: result.ok, symbol, trades: unwrap(result) });
  }

  if (name === 'get_candles') {
    if (!symbol) return JSON.stringify({ error: 'symbol이 필요합니다.' });
    const interval = args?.interval === '1m' ? '1m' : '1d';
    const count = Number.isFinite(args?.count) ? Number(args.count) : undefined;
    const result = await getCandles({ ...cfg.toss, symbol, interval, count });
    return clip({ ok: result.ok, symbol, interval, candles: unwrap(result) });
  }

  if (name === 'get_price_limits') {
    if (!symbol) return JSON.stringify({ error: 'symbol이 필요합니다.' });
    const result = await getPriceLimits({ ...cfg.toss, symbol });
    return clip({ ok: result.ok, symbol, priceLimits: unwrap(result) });
  }

  // ── Orders (#8, #9) — require a selected account ──────────────────────────
  if (name === 'get_orders') {
    if (!cfg?.toss?.accountSeq) return ERR_NO_ACCOUNT;
    const status = args?.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
    const limit = Number.isFinite(args?.limit) ? Number(args.limit) : undefined;
    const result = await getOrders({
      ...cfg.toss,
      accountSeq: cfg.toss.accountSeq,
      status,
      ...(symbol ? { symbol } : {}),
      ...(limit ? { limit } : {}),
    });
    return clip({ ok: result.ok, status, orders: unwrap(result) });
  }

  if (name === 'get_order_detail') {
    if (!cfg?.toss?.accountSeq) return ERR_NO_ACCOUNT;
    const orderId = String(args?.orderId ?? '').trim();
    if (!orderId) return JSON.stringify({ error: 'orderId가 필요합니다.' });
    const result = await getOrderDetail({ ...cfg.toss, accountSeq: cfg.toss.accountSeq, orderId });
    return clip({ ok: result.ok, orderId, order: unwrap(result) });
  }

  if (name === 'place_order') {
    if (!cfg?.toss?.accountSeq) return ERR_NO_ACCOUNT;
    const side = args?.side === 'SELL' ? 'SELL' : args?.side === 'BUY' ? 'BUY' : null;
    const orderType = args?.orderType === 'MARKET' ? 'MARKET' : args?.orderType === 'LIMIT' ? 'LIMIT' : null;
    if (!symbol || !side || !orderType) {
      return JSON.stringify({ error: 'symbol, side(BUY/SELL), orderType(LIMIT/MARKET)이 필요합니다.' });
    }
    const quantity = args?.quantity != null ? String(args.quantity).trim() : '';
    const price = args?.price != null ? String(args.price).trim() : '';
    const orderAmount = args?.orderAmount != null ? String(args.orderAmount).trim() : '';
    if (orderType === 'LIMIT' && !price) return JSON.stringify({ error: 'LIMIT 주문은 price가 필요합니다.' });
    if (!quantity && !orderAmount) return JSON.stringify({ error: 'quantity 또는 orderAmount가 필요합니다.' });

    const isDomestic = /^\d{6}$/.test(symbol);
    const estAmountKRW =
      isDomestic && price && quantity ? Number(price) * Number(quantity) : null;
    const highValue = estAmountKRW != null && estAmountKRW >= HIGH_VALUE_KRW;

    const preview = {
      symbol,
      side,
      orderType,
      ...(quantity ? { quantity } : {}),
      ...(orderType === 'LIMIT' ? { price } : {}),
      ...(orderAmount ? { orderAmount } : {}),
      timeInForce: args?.timeInForce === 'CLS' ? 'CLS' : 'DAY',
      estimatedAmountKRW: estAmountKRW,
      highValue,
    };

    if (args?.confirmed !== true) {
      return clip({
        needsConfirmation: true,
        action: 'place_order',
        preview,
        message:
          '실제 주문입니다(실거래). 위 내용을 사용자에게 보여주고 명시적으로 동의를 받은 뒤에만 confirmed=true로 다시 호출하세요.' +
          (highValue ? ' ⚠️ 1억원 이상 고액 주문입니다. 특히 신중히 확인받으세요.' : ''),
      });
    }

    const order: OrderCreateBody = {
      symbol,
      side,
      orderType,
      ...(quantity ? { quantity } : {}),
      ...(orderType === 'LIMIT' ? { price } : {}),
      ...(orderAmount ? { orderAmount } : {}),
      timeInForce: preview.timeInForce as 'DAY' | 'CLS',
      confirmHighValueOrder: true, // user already confirmed via the tool gate
    };
    const result = await createOrder({ ...cfg.toss, accountSeq: cfg.toss.accountSeq, order });
    return clip({ ok: result.ok, executed: result.ok, result: unwrap(result) });
  }

  if (name === 'modify_order') {
    if (!cfg?.toss?.accountSeq) return ERR_NO_ACCOUNT;
    const orderId = String(args?.orderId ?? '').trim();
    const orderType = args?.orderType === 'MARKET' ? 'MARKET' : args?.orderType === 'LIMIT' ? 'LIMIT' : null;
    if (!orderId || !orderType) return JSON.stringify({ error: 'orderId와 orderType(LIMIT/MARKET)이 필요합니다.' });
    const quantity = args?.quantity != null ? String(args.quantity).trim() : '';
    const price = args?.price != null ? String(args.price).trim() : '';

    const preview = {
      orderId,
      orderType,
      ...(quantity ? { quantity } : {}),
      ...(orderType === 'LIMIT' && price ? { price } : {}),
    };
    if (args?.confirmed !== true) {
      return clip({
        needsConfirmation: true,
        action: 'modify_order',
        preview,
        message: '실제 주문 정정입니다. 사용자 동의를 받은 뒤에만 confirmed=true로 다시 호출하세요.',
      });
    }
    const result = await modifyOrder({
      ...cfg.toss,
      accountSeq: cfg.toss.accountSeq,
      orderId,
      body: {
        orderType,
        ...(quantity ? { quantity } : {}),
        ...(orderType === 'LIMIT' && price ? { price } : {}),
        confirmHighValueOrder: true,
      },
    });
    return clip({ ok: result.ok, executed: result.ok, result: unwrap(result) });
  }

  if (name === 'cancel_order') {
    if (!cfg?.toss?.accountSeq) return ERR_NO_ACCOUNT;
    const orderId = String(args?.orderId ?? '').trim();
    if (!orderId) return JSON.stringify({ error: 'orderId가 필요합니다.' });
    if (args?.confirmed !== true) {
      return clip({
        needsConfirmation: true,
        action: 'cancel_order',
        preview: { orderId },
        message: '실제 주문 취소입니다. 사용자 동의를 받은 뒤에만 confirmed=true로 다시 호출하세요.',
      });
    }
    const result = await cancelOrder({ ...cfg.toss, accountSeq: cfg.toss.accountSeq, orderId });
    return clip({ ok: result.ok, executed: result.ok, result: unwrap(result) });
  }

  return JSON.stringify({ error: `알 수 없는 도구: ${name}` });
}
