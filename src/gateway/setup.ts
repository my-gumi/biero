import { intro, outro, note, text, password, multiselect, isCancel, cancel } from '@clack/prompts';
import pc from 'picocolors';

import { loadConfig, saveConfig } from '../shared/config.js';
import { banner, toss, tossSoft, ok, warn, danger, kv } from '../shared/theme.js';
import type { PlatformConfig } from '../shared/types.js';

// `biero gateway setup` — the user pastes their OWN bot tokens here; nothing is
// hardcoded. Saved to ~/.biero/config.json (0600). Env vars override at runtime.

function guard<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel('설정을 취소했어요. 언제든 `biero gateway setup` 으로 다시 시작할 수 있어요.');
    process.exit(0);
  }
  return value as T;
}

function requireTTY(): boolean {
  if (process.stdin.isTTY && process.stdout.isTTY) return true;
  process.stdout.write(
    `\n${danger('대화형 터미널이 필요해요.')} 터미널에서 직접 ${pc.bold('biero gateway setup')} 을 실행해 주세요.\n\n`,
  );
  return false;
}

/** Parse a comma/space-separated id list into trimmed, non-empty ids. */
function parseUsers(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function stepTelegram(existing?: PlatformConfig): Promise<PlatformConfig> {
  note(
    [
      `${pc.bold('@BotFather')} 에게 ${pc.bold('/newbot')} 으로 봇을 만들고 토큰을 받으세요.`,
      '허용 사용자 ID는 봇 실행 후 메시지를 보내면 콘솔 로그에 찍히고,',
      `메신저에서 ${pc.bold('/whoami')} 로도 확인할 수 있어요.`,
    ].join('\n'),
    '텔레그램 봇',
  );
  const token = guard(
    await password({ message: '텔레그램 Bot Token', validate: (v) => (v?.trim() ? undefined : '토큰을 입력해 주세요.') }),
  ).trim();
  const users = parseUsers(
    guard(
      await text({
        message: '허용 사용자 ID (쉼표로 구분 · 비우면 아무도 못 씀 · * = 전원)',
        placeholder: '123456789, 987654321',
        initialValue: (existing?.allowedUsers ?? []).join(', '),
      }),
    ),
  );
  if (!users.length) note(warn('허용 사용자가 비어 있어요. 보안 기본값으로 아무도 사용할 수 없어요.'), '주의');
  return { enabled: true, botToken: token, allowedUsers: users, homeChatId: existing?.homeChatId };
}

async function stepDiscord(existing?: PlatformConfig): Promise<PlatformConfig> {
  note(
    [
      `${pc.bold('Discord Developer Portal')} → New Application → Bot 에서 토큰을 발급하세요.`,
      `봇 설정에서 ${pc.bold('MESSAGE CONTENT INTENT')} 를 켜야 메시지를 읽을 수 있어요.`,
      '허용 사용자 ID는 디스코드 개발자 모드에서 사용자 우클릭 → ID 복사.',
    ].join('\n'),
    '디스코드 봇',
  );
  const token = guard(
    await password({ message: '디스코드 Bot Token', validate: (v) => (v?.trim() ? undefined : '토큰을 입력해 주세요.') }),
  ).trim();
  const users = parseUsers(
    guard(
      await text({
        message: '허용 사용자 ID (쉼표로 구분 · 비우면 아무도 못 씀 · * = 전원)',
        placeholder: '123456789012345678',
        initialValue: (existing?.allowedUsers ?? []).join(', '),
      }),
    ),
  );
  if (!users.length) note(warn('허용 사용자가 비어 있어요. 보안 기본값으로 아무도 사용할 수 없어요.'), '주의');
  return { enabled: true, botToken: token, allowedUsers: users };
}

export async function runGatewaySetup(): Promise<void> {
  process.stdout.write(banner());
  if (!requireTTY()) return;

  const cfg = loadConfig();
  if (!cfg) {
    process.stdout.write(
      `  ${danger('먼저 LLM·토스 설정이 필요해요.')} ${pc.bold('biero setup')} 을 실행한 뒤 다시 시도하세요.\n\n`,
    );
    process.exitCode = 1;
    return;
  }

  intro(`${pc.inverse(toss(' Biero '))}  ${pc.dim('메신저 게이트웨이 설정')}`);
  note(
    [
      'PC를 켜둔 채 모바일 메신저로 비서를 원격 조종해요.',
      pc.dim('봇 토큰은 이 PC(~/.biero)에만 저장되고, 환경변수로 덮어쓸 수 있어요.'),
    ].join('\n'),
    '무엇을 하나요',
  );

  const chosen = guard(
    await multiselect({
      message: '연결할 메신저를 고르세요 (스페이스로 선택)',
      options: [
        { value: 'telegram', label: '텔레그램', hint: 'long-poll · 지금 사용 가능' },
        { value: 'discord', label: '디스코드', hint: 'discord.js · 곧 지원' },
      ],
      required: true,
    }),
  ) as string[];

  const gateway = cfg.gateway ?? {};
  if (chosen.includes('telegram')) gateway.telegram = await stepTelegram(gateway.telegram);
  if (chosen.includes('discord')) gateway.discord = await stepDiscord(gateway.discord);

  cfg.gateway = gateway;
  cfg.updatedAt = new Date().toISOString();
  const savedPath = saveConfig(cfg);

  const summary: string[] = [];
  if (gateway.telegram)
    summary.push(kv('텔레그램', `${ok('설정됨')} · 허용 ${gateway.telegram.allowedUsers.length}명`));
  if (gateway.discord)
    summary.push(kv('디스코드', `${ok('설정됨')} · 허용 ${gateway.discord.allowedUsers.length}명`));
  summary.push(kv('저장 위치', savedPath));
  note(summary.join('\n'), '저장했어요');

  outro(tossSoft(`이제 ${pc.bold('biero gateway start')} 로 상주 프로세스를 띄우세요.`));
}
