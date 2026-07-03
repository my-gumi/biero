import { saveConfig } from '../config.js';
import type { Config, SessionSource } from '../types.js';
import type { ResolvedGateway } from './config.js';
import type { SessionStore } from './session.js';

// In-messenger slash commands (Hermes: slash_access.py). Kept intentionally
// small; anything not matched here falls through to the agent.

export interface CommandContext {
  source: SessionSource;
  cfg: Config;
  gateway: ResolvedGateway;
  session: SessionStore;
  startedAt: number;
}

export interface ParsedCommand {
  name: string;
  args: string;
}

/** Extract a leading `/command args` from text, or null if not a command. */
export function parseCommand(text: string): ParsedCommand | null {
  const m = /^\/([a-zA-Z]+)(?:@\S+)?\s*(.*)$/s.exec(text.trim());
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: m[2].trim() };
}

function humanDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분 ${sec}초`;
  return `${sec}초`;
}

const HELP = [
  '사용 가능한 명령:',
  '  /help     — 이 도움말',
  '  /status   — 연결·모델 상태',
  '  /reset    — 이 대화의 기록 초기화',
  '  /whoami   — 내 사용자 ID 확인 (화이트리스트 등록용)',
  '  /sethome  — (텔레그램) 이 채팅을 홈 채널로 지정',
  '',
  '그 밖의 메시지는 바로 비서에게 전달돼요.',
].join('\n');

/** Handle a parsed command. Returns the reply text to send back. */
export async function handleCommand(cmd: ParsedCommand, ctx: CommandContext): Promise<string> {
  const { source, cfg, gateway, session, startedAt } = ctx;
  switch (cmd.name) {
    case 'help':
    case 'start':
      return HELP;

    case 'whoami':
      return [
        `플랫폼: ${source.platform}`,
        `사용자 ID: ${source.userId}`,
        `채팅 ID: ${source.chatId}`,
        source.userName ? `이름: ${source.userName}` : '',
      ]
        .filter(Boolean)
        .join('\n');

    case 'status': {
      const label = cfg.llm?.label ?? cfg.llm?.provider ?? '-';
      const model = cfg.llm?.model ?? '(미지정)';
      return [
        'Biero 게이트웨이 상태',
        `  공급자: ${label}`,
        `  모델: ${model}`,
        `  활성 세션: ${session.size()}개`,
        `  가동 시간: ${humanDuration(Date.now() - startedAt)}`,
      ].join('\n');
    }

    case 'reset':
      session.reset(source);
      return '이 대화의 기록을 초기화했어요.';

    case 'sethome': {
      if (source.platform !== 'telegram') {
        return '/sethome 는 텔레그램에서만 지원해요.';
      }
      cfg.gateway = cfg.gateway ?? {};
      cfg.gateway.telegram = cfg.gateway.telegram ?? { enabled: true, allowedUsers: [] };
      cfg.gateway.telegram.homeChatId = source.chatId;
      cfg.updatedAt = new Date().toISOString();
      saveConfig(cfg);
      gateway.telegram.homeChatId = source.chatId; // reflect in the live session
      return `이 채팅(${source.chatId})을 홈 채널로 지정했어요.`;
    }

    default:
      return `알 수 없는 명령: /${cmd.name}\n\n${HELP}`;
  }
}
