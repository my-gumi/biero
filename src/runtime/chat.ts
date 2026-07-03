import { intro, outro, note, text, spinner, isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { loadConfig, configExists } from '../shared/config.js';
import { runAgent } from './agent.js';
import { banner, toss, tossSoft, danger, kv } from '../shared/theme.js';
import type { ChatMessage } from '../shared/types.js';

const EXIT_WORDS = new Set(['/exit', '/quit', '/q', 'exit', 'quit', ':q']);

function requireTTY(): boolean {
  if (process.stdin.isTTY && process.stdout.isTTY) return true;
  process.stdout.write(
    `\n${danger('대화형 터미널이 필요해요.')} 터미널에서 직접 ${pc.bold('biero')} 를 실행해 주세요.\n\n`,
  );
  return false;
}

export async function runChat({ fromSetup = false }: { fromSetup?: boolean } = {}): Promise<void> {
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
  note(
    [
      kv('공급자', label ?? '-'),
      kv('모델', model),
      '',
      pc.dim('시세도 물어보세요.  예: "삼성전자 얼마야?"'),
      pc.dim('종료: /exit 또는 Ctrl+C'),
    ].join('\n'),
    '대화 시작',
  );

  const messages: ChatMessage[] = [];

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

    messages.push({ role: 'user', content: msg });

    const s = spinner();
    s.start('생각하는 중…');
    try {
      const reply = await runAgent(cfg, messages, {
        onTool: (name, args) => {
          if (name === 'get_stock_price') {
            s.message(`토스에서 시세 조회 중…${args?.symbol ? ` (${args.symbol})` : ''}`);
          }
        },
      });
      s.stop(toss(pc.bold('Biero')));
      note((reply || '(빈 응답)').trim(), '');
    } catch (e: any) {
      s.stop(danger('응답 실패'));
      note(String(e?.message || e), '오류');
      messages.pop();
    }
  }
}
