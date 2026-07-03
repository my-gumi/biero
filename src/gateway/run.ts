import pc from 'picocolors';

import { loadConfig, CONFIG_PATH } from '../shared/config.js';
import { banner, ok, warn, danger, kv } from '../shared/theme.js';
import { resolveGateway, type ResolvedGateway } from './config.js';
import { GatewayCore } from './core.js';
import { SessionStore } from './session.js';
import { BasePlatformAdapter, type MessageHandler } from './platforms/base.js';
import { StdinAdapter } from './platforms/stdin.js';
import { TelegramAdapter } from './platforms/telegram.js';
import { DiscordAdapter } from './platforms/discord.js';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

interface StartOpts {
  stdin?: boolean;
}

/** Build the enabled platform adapters (Hermes: run.py `_create_adapter`). */
function createAdapters(g: ResolvedGateway, handler: MessageHandler, opts: StartOpts): BasePlatformAdapter[] {
  const adapters: BasePlatformAdapter[] = [];

  if (g.telegram.enabled && g.telegram.botToken) {
    adapters.push(new TelegramAdapter(handler, g.telegram.botToken));
  }
  if (g.discord.enabled && g.discord.botToken) {
    adapters.push(new DiscordAdapter(handler, g.discord.botToken));
  }

  // stdin: explicit --stdin, or as a fallback when no messenger is enabled so
  // the process is still testable locally.
  if (opts.stdin || adapters.length === 0) {
    adapters.push(new StdinAdapter(handler));
  }
  return adapters;
}

export async function runGateway(opts: StartOpts = {}): Promise<void> {
  process.stdout.write(banner());

  const cfg = loadConfig();
  if (!cfg) {
    process.stdout.write(`  ${danger('설정이 없어요.')} 먼저 ${pc.bold('biero setup')} 으로 LLM·토스 키를 연결하세요.\n\n`);
    process.exitCode = 1;
    return;
  }
  if (!cfg.llm?.model) {
    process.stdout.write(`  ${danger('LLM 모델이 설정되어 있지 않아요.')} ${pc.bold('biero setup')} 을 먼저 실행하세요.\n\n`);
    process.exitCode = 1;
    return;
  }

  const g = resolveGateway(cfg);
  const session = new SessionStore(g.maxHistory, g.idleTtlMs);
  const core = new GatewayCore(cfg, g, session);
  const handler: MessageHandler = (evt, adapter) => core.handle(evt, adapter);

  const adapters = createAdapters(g, handler, opts);

  const sweeper = setInterval(() => session.sweep(), SWEEP_INTERVAL_MS);
  sweeper.unref?.();

  let connected = 0;
  for (const a of adapters) {
    try {
      if (await a.connect()) connected++;
    } catch (e: any) {
      process.stderr.write(`${danger(`[${a.platform}] 연결 실패`)}: ${e?.message || e}\n`);
    }
  }

  if (!connected) {
    process.stdout.write(`\n  ${danger('연결된 어댑터가 없어요.')} ${pc.bold('biero gateway setup')} 으로 봇을 설정하세요.\n\n`);
    clearInterval(sweeper);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`${ok(`[gateway] 실행 중`)} — 연결된 어댑터 ${connected}개. 종료: Ctrl+C\n`);

  // Graceful shutdown (Hermes: drain_control.py).
  let closing = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (closing) return;
    closing = true;
    process.stderr.write(`\n[gateway] ${sig} 수신 — 종료 중…\n`);
    clearInterval(sweeper);
    await Promise.allSettled(adapters.map((a) => a.disconnect()));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Keep the process alive; adapters drive the event loop.
  await new Promise<void>(() => {});
}

/** `biero gateway status` — show resolved gateway configuration. */
export function showGatewayStatus(): void {
  process.stdout.write(banner());
  const cfg = loadConfig();
  if (!cfg) {
    process.stdout.write(`  ${warn('아직 설정이 없어요.')} ${pc.bold('biero setup')} 으로 시작하세요.\n\n`);
    return;
  }
  const g = resolveGateway(cfg);
  const line = (name: string, p: ResolvedGateway['telegram']): string => {
    const state = p.enabled ? ok('활성') : pc.dim('비활성');
    const users =
      p.allowedUsers.length === 0
        ? warn('없음(전원 차단)')
        : p.allowedUsers.includes('*')
          ? warn('전원 허용(*)')
          : `${p.allowedUsers.length}명`;
    return kv(name, `${state}  ·  허용 사용자 ${users}${p.homeChatId ? `  ·  홈 ${p.homeChatId}` : ''}`);
  };
  process.stdout.write(
    [
      '',
      line('텔레그램', g.telegram),
      line('디스코드', g.discord),
      '',
      kv('설정 파일', CONFIG_PATH),
      '',
      `  ${pc.dim('설정:')} ${pc.bold('biero gateway setup')}   ${pc.dim('시작:')} ${pc.bold('biero gateway start')}`,
      '',
    ].join('\n') + '\n',
  );
}
