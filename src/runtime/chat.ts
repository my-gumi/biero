import readline from 'node:readline';
import pc from 'picocolors';

import { loadConfig, configExists } from '../shared/config.js';
import { runAgent } from './agent.js';
import { loadHistory, saveHistory, clearHistory } from './history.js';
import { wordmark, toss, tossSoft, danger } from '../shared/theme.js';
import type { ChatMessage } from '../shared/types.js';

const EXIT_WORDS = new Set(['/exit', '/quit', '/q', 'exit', 'quit', ':q']);
const RESET_WORDS = new Set(['/reset', '/new', '/clear']);

const PROMPT = `${toss('❯')} `;
const ASSISTANT_MARK = toss('⏺');
const TOOL_MARK = pc.dim('⎿');
const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Short label shown next to a running tool. */
function toolStatus(name: string, args: any): string {
  const sym = args?.symbol ? ` ${pc.dim(args.symbol)}` : '';
  switch (name) {
    case 'get_stock_price':
      return `시세 조회${sym}`;
    case 'get_orderbook':
      return `호가 조회${sym}`;
    case 'get_recent_trades':
      return `체결 조회${sym}`;
    case 'get_candles':
      return `캔들 조회${sym}`;
    case 'get_price_limits':
      return `상·하한가 조회${sym}`;
    case 'get_stock_info':
      return `종목정보 조회${sym}`;
    case 'get_holdings':
      return '보유 종목 조회';
    case 'get_buying_power':
      return '매수 가능 금액 조회';
    case 'get_trade_info':
      return `거래 정보 조회${sym}`;
    case 'get_exchange_rate':
      return '환율 조회';
    case 'get_market_hours':
      return '장 운영시간 조회';
    case 'get_orders':
    case 'get_order_detail':
      return '주문 내역 조회';
    case 'place_order':
      return '주문 처리';
    case 'modify_order':
      return '주문 정정';
    case 'cancel_order':
      return '주문 취소';
    default:
      return name;
  }
}

/** Minimal inline spinner that owns a single terminal line. */
function makeSpinner(): { start: (label: string) => void; setLabel: (l: string) => void; stop: () => void } {
  let i = 0;
  let label = '';
  let timer: ReturnType<typeof setInterval> | null = null;
  const render = (): void => {
    process.stdout.write(`\r\x1b[K  ${toss(SPIN_FRAMES[(i = (i + 1) % SPIN_FRAMES.length)])} ${pc.dim(label)}`);
  };
  return {
    start(l) {
      label = l;
      if (timer) return;
      timer = setInterval(render, 80);
      render();
    },
    setLabel(l) {
      label = l;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      process.stdout.write('\r\x1b[K'); // clear the spinner line
    },
  };
}

function requireTTY(): boolean {
  if (process.stdin.isTTY && process.stdout.isTTY) return true;
  process.stdout.write(
    `\n${danger('대화형 터미널이 필요해요.')} 터미널에서 직접 ${pc.bold('biero')} 를 실행해 주세요.\n\n`,
  );
  return false;
}

/** One-line preview of a restored message. */
function preview(m: ChatMessage): string {
  const mark = m.role === 'user' ? toss('❯') : ASSISTANT_MARK;
  const body = (m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 64);
  return `  ${mark} ${pc.dim(body || '…')}`;
}

export async function runChat({
  fromSetup = false,
  continueSession = false,
}: { fromSetup?: boolean; continueSession?: boolean } = {}): Promise<void> {
  void fromSetup;

  if (!configExists()) {
    process.stdout.write(`  설정이 먼저 필요해요. ${pc.bold('biero setup')} 으로 LLM·토스 키를 연결하세요.\n\n`);
    process.exitCode = 1;
    return;
  }
  if (!requireTTY()) return;

  const cfg = loadConfig();
  const model = cfg?.llm?.model;
  const label = cfg?.llm?.label ?? cfg?.llm?.provider;

  if (!cfg || !model) {
    process.stdout.write(
      `  ${danger('모델이 설정되어 있지 않아요.')} ${pc.bold('biero setup')} 으로 모델을 지정하세요.\n\n`,
    );
    process.exitCode = 1;
    return;
  }

  const messages: ChatMessage[] = continueSession ? loadHistory() : [];

  // ── Header ────────────────────────────────────────────────────────────────
  const out = process.stdout;
  out.write(`\n  ${wordmark('biero')}  ${pc.dim('주식 AI 비서')}\n`);
  out.write(`  ${pc.dim(`${label ?? '-'} · ${model}`)}\n`);
  if (continueSession && messages.length) {
    out.write(`  ${pc.dim(`이전 대화 ${messages.length}개 이어가기`)}\n`);
    for (const m of messages.slice(-2)) out.write(`${preview(m)}\n`);
  }
  out.write(`  ${pc.dim('/reset 새 대화   /exit 종료')}\n\n`);

  // ── REPL ──────────────────────────────────────────────────────────────────
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });
  rl.on('SIGINT', () => rl.close());

  const ask = (): Promise<string | null> =>
    new Promise((resolve) => {
      if (closed) return resolve(null);
      const onClose = (): void => resolve(null);
      rl.once('close', onClose);
      rl.question(PROMPT, (answer) => {
        rl.removeListener('close', onClose);
        resolve(answer);
      });
    });

  const spinner = makeSpinner();

  for (;;) {
    const input = await ask();
    if (input === null) break; // Ctrl+C / Ctrl+D / EOF
    const msg = input.trim();
    if (!msg) continue;
    if (EXIT_WORDS.has(msg.toLowerCase())) break;
    if (RESET_WORDS.has(msg.toLowerCase())) {
      messages.length = 0;
      clearHistory();
      out.write(`  ${pc.dim('새 대화를 시작했어요.')}\n\n`);
      continue;
    }

    messages.push({ role: 'user', content: msg });
    out.write('\n');
    spinner.start('생각 중…');

    let started = false;
    try {
      const reply = await runAgent(cfg, messages, {
        onTool: (name, args) => {
          spinner.stop();
          out.write(`  ${TOOL_MARK} ${pc.dim(toolStatus(name, args))}\n`);
          spinner.start('생각 중…');
        },
        onToken: (delta) => {
          if (!started) {
            spinner.stop();
            out.write(`  ${ASSISTANT_MARK} `);
            started = true;
          }
          out.write(delta.replace(/\n/g, '\n    '));
        },
      });
      if (started) {
        out.write('\n\n');
      } else {
        spinner.stop();
        out.write(`  ${ASSISTANT_MARK} ${(reply || '(빈 응답)').trim()}\n\n`);
      }
      saveHistory(messages);
    } catch (e: any) {
      spinner.stop();
      if (started) out.write('\n');
      out.write(`  ${danger('✖')} ${danger(String(e?.message || e))}\n\n`);
      messages.pop();
    }
  }

  rl.close();
  out.write(`\n  ${tossSoft('안녕히 가세요.')}\n\n`);
}
