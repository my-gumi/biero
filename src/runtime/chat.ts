import { intro, outro, note, text, spinner, isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { loadConfig, configExists } from '../shared/config.js';
import { runAgent } from './agent.js';
import { loadHistory, saveHistory, clearHistory } from './history.js';
import { banner, toss, tossSoft, danger, kv } from '../shared/theme.js';
import type { ChatMessage } from '../shared/types.js';

const EXIT_WORDS = new Set(['/exit', '/quit', '/q', 'exit', 'quit', ':q']);
const RESET_WORDS = new Set(['/reset', '/new', '/clear']);

/** Friendly status shown while a tool runs. */
function toolStatus(name: string, args: any): string {
  const sym = args?.symbol ? ` (${args.symbol})` : '';
  switch (name) {
    case 'get_stock_price':
    case 'get_orderbook':
    case 'get_recent_trades':
    case 'get_candles':
    case 'get_price_limits':
    case 'get_stock_info':
      return `토스에서 시세 조회 중…${sym}`;
    case 'get_holdings':
      return '보유 종목 조회 중…';
    case 'get_buying_power':
    case 'get_trade_info':
      return '거래 정보 조회 중…';
    case 'get_exchange_rate':
      return '환율 조회 중…';
    case 'get_market_hours':
      return '장 운영시간 조회 중…';
    case 'get_orders':
    case 'get_order_detail':
      return '주문 내역 조회 중…';
    case 'place_order':
    case 'modify_order':
    case 'cancel_order':
      return '주문 처리 중…';
    default:
      return '조회 중…';
  }
}

function requireTTY(): boolean {
  if (process.stdin.isTTY && process.stdout.isTTY) return true;
  process.stdout.write(
    `\n${danger('대화형 터미널이 필요해요.')} 터미널에서 직접 ${pc.bold('biero')} 를 실행해 주세요.\n\n`,
  );
  return false;
}

/** One-line preview of a restored message, for the resume note. */
function preview(m: ChatMessage): string {
  const who = m.role === 'user' ? pc.cyan('나') : toss('Biero');
  const body = (m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${who}  ${pc.dim(body || '…')}`;
}

export async function runChat({
  fromSetup = false,
  continueSession = false,
}: { fromSetup?: boolean; continueSession?: boolean } = {}): Promise<void> {
  if (!fromSetup) process.stdout.write(banner());

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

  intro(`${pc.inverse(toss(' Biero '))}  ${pc.dim('주식 AI 비서와 대화하기')}`);

  const messages: ChatMessage[] = continueSession ? loadHistory() : [];
  const noteLines = [
    kv('공급자', label ?? '-'),
    kv('모델', model),
    '',
    pc.dim('시세도 물어보세요.  예: "삼성전자 얼마야?"'),
    pc.dim('새 대화: /reset · 종료: /exit 또는 Ctrl+C'),
  ];
  if (continueSession && messages.length) {
    const last = messages.slice(-2).map(preview);
    noteLines.push('', pc.dim(`이전 대화 ${messages.length}개 메시지를 이어갑니다.`), ...last);
  } else if (continueSession) {
    noteLines.push('', pc.dim('이어갈 이전 대화가 없어요. 새로 시작합니다.'));
  }
  note(noteLines.join('\n'), '대화 시작');

  for (;;) {
    const input = await text({ message: pc.cyan('나'), placeholder: '삼성전자 얼마야?' });
    if (isCancel(input)) {
      outro(tossSoft('대화를 종료할게요.'));
      return;
    }
    const msg = (input ?? '').trim();
    if (!msg) continue;
    if (EXIT_WORDS.has(msg.toLowerCase())) {
      outro(tossSoft('대화를 종료할게요.'));
      return;
    }
    if (RESET_WORDS.has(msg.toLowerCase())) {
      messages.length = 0;
      clearHistory();
      note(tossSoft('새 대화를 시작했어요. 이전 맥락을 지웠습니다.'), '초기화');
      continue;
    }

    messages.push({ role: 'user', content: msg });

    const s = spinner();
    s.start('생각하는 중…');
    let streaming = false;
    const startStream = (): void => {
      if (streaming) return;
      s.stop(toss(pc.bold('Biero')));
      streaming = true;
      process.stdout.write('  ');
    };

    try {
      const reply = await runAgent(cfg, messages, {
        onTool: (name, args) => {
          if (!streaming) s.message(toolStatus(name, args));
        },
        onToken: (delta) => {
          startStream();
          process.stdout.write(delta);
        },
      });
      if (streaming) {
        process.stdout.write('\n\n');
      } else {
        s.stop(toss(pc.bold('Biero')));
        note((reply || '(빈 응답)').trim(), '');
      }
      saveHistory(messages);
    } catch (e: any) {
      if (streaming) process.stdout.write('\n');
      s.stop(danger('응답 실패'));
      note(String(e?.message || e), '오류');
      messages.pop();
    }
  }
}
