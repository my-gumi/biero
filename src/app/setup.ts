import {
  intro,
  outro,
  note,
  text,
  password,
  select,
  confirm,
  spinner,
  isCancel,
  cancel,
} from '@clack/prompts';
import pc from 'picocolors';

import { PROVIDERS, getProvider, validateLLM, curateModels } from '../llm/providers.js';
import { validateTossCredentials, TOSS_BASE_URL } from '../toss/client.js';
import { runChat } from '../runtime/chat.js';
import { saveConfig, loadConfig, configExists, CONFIG_PATH, maskSecret } from '../shared/config.js';
import { banner, toss, tossSoft, ok, warn, danger, kv } from '../shared/theme.js';
import type { Config, LlmConfig, TossConfig } from '../shared/types.js';

// Bail out cleanly when the user hits Ctrl+C / ESC on any prompt.
function guard<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel('설정을 취소했어요. 언제든 다시 `biero setup` 으로 시작할 수 있어요.');
    process.exit(0);
  }
  return value as T;
}

type Validator = (value: string | undefined) => string | undefined;

const required = (label: string): Validator => (v) =>
  v && String(v).trim() ? undefined : `${label}을(를) 입력해 주세요.`;
const isUrl: Validator = (v) =>
  /^https?:\/\/.+/i.test(String(v ?? '').trim()) ? undefined : 'http(s):// 로 시작하는 URL이어야 해요.';

function requireTTY(): boolean {
  if (process.stdin.isTTY && process.stdout.isTTY) return true;
  process.stdout.write(
    `\n${danger('대화형 터미널이 필요해요.')} 터미널에서 직접 ${pc.bold('biero setup')} 을 실행해 주세요.\n\n`,
  );
  return false;
}

// ── LLM provider step ─────────────────────────────────────────────────────
async function stepLLM(): Promise<LlmConfig> {
  const providerId = guard(
    await select({
      message: 'LLM 공급자를 선택하세요',
      options: PROVIDERS.map((p) => ({ value: p.id, label: p.label, hint: p.hint })),
      initialValue: 'openai',
    }),
  );
  const provider = getProvider(providerId)!;

  let baseURL = provider.baseURL;
  if (provider.id === 'custom') {
    baseURL = guard(
      await text({
        message: 'API Base URL (OpenAI 호환)',
        placeholder: 'https://api.example.com/v1',
        validate: isUrl,
      }),
    ).trim();
  }

  let apiKey = '';
  if (provider.needsKey) {
    apiKey = guard(await password({ message: `${provider.label} API Key`, validate: required('API Key') }));
  }

  let result = await validateLLM(provider, apiKey, baseURL);
  for (;;) {
    const s = spinner();
    s.start(`${provider.label} 연결을 확인하는 중…`);
    result = await validateLLM(provider, apiKey, baseURL);
    if (result.ok) {
      s.stop(ok(`${provider.label} 연결 성공`));
      break;
    }
    s.stop(
      danger(`연결 실패 — ${result.message || (result.status ? `HTTP ${result.status}` : '알 수 없는 오류')}`),
    );
    const choice = guard(
      await select({
        message: '어떻게 할까요?',
        options: [
          { value: 'retry', label: '키 다시 입력' },
          { value: 'continue', label: '확인 없이 이대로 진행' },
          { value: 'quit', label: '종료' },
        ],
        initialValue: 'retry',
      }),
    );
    if (choice === 'continue') break;
    if (choice === 'quit') {
      cancel('설정을 종료했어요.');
      process.exit(0);
    }
    if (provider.id === 'custom') {
      baseURL = guard(
        await text({
          message: 'API Base URL (OpenAI 호환)',
          placeholder: 'https://api.example.com/v1',
          initialValue: baseURL,
          validate: isUrl,
        }),
      ).trim();
    }
    if (provider.needsKey) {
      apiKey = guard(await password({ message: `${provider.label} API Key`, validate: required('API Key') }));
    }
  }

  // Model selection — curate to recent chat models.
  let model = '';
  const rawModels = result.ok && Array.isArray(result.models) ? result.models : [];
  if (rawModels.length) {
    const curated = curateModels(provider, rawModels);
    const list = curated.length ? curated : rawModels;
    const top = list.slice(0, 12);
    const options: Array<{ value: string; label: string }> = top.map((m) => ({ value: m, label: m }));
    if (list.length > top.length) options.push({ value: '__all__', label: `더 많은 모델 보기 (${list.length}개)` });
    options.push({ value: '__custom__', label: '기타 — 직접 입력' });

    let picked = guard(await select({ message: '사용할 모델', options, initialValue: top[0] }));
    if (picked === '__all__') {
      const allOptions: Array<{ value: string; label: string }> = list.map((m) => ({ value: m, label: m }));
      allOptions.push({ value: '__custom__', label: '기타 — 직접 입력' });
      picked = guard(await select({ message: `사용할 모델 (전체 ${list.length}개)`, options: allOptions }));
    }
    if (picked === '__custom__') {
      const raw = guard(await text({ message: '모델 이름', validate: required('모델') }));
      model = (raw ?? '').trim();
    } else {
      model = picked;
    }
  } else {
    const raw = guard(await text({ message: '사용할 모델 (선택 · 비워도 됨)' }));
    model = (raw ?? '').trim();
  }

  return { provider: provider.id, label: provider.label, baseURL, apiKey, model };
}

// ── Toss credentials step ─────────────────────────────────────────────────
// The Toss console labels these "API Key" (tsck_live_…) and "Secret Key"
// (tssk_live_…). In OAuth2 they are client_id / client_secret.
async function stepToss(): Promise<TossConfig> {
  note(
    [
      '토스증권 WTS 로그인 → 설정 → Open API 에서',
      `${pc.bold('API Key')} 와 ${pc.bold('Secret Key')} 를 발급받으세요.`,
      '',
      `  ${pc.dim('· API Key    ')}tsck_live_…  ${pc.dim('(= client_id)')}`,
      `  ${pc.dim('· Secret Key ')}tssk_live_…  ${pc.dim('(= client_secret)')}`,
      '',
      pc.dim('허용 IP 목록에 지금 이 PC의 공인 IP가 있어야 토큰이 발급돼요.'),
      pc.dim('가이드: https://developers.tossinvest.com/docs'),
    ].join('\n'),
    '토스증권 Open API 키',
  );

  let clientId = '';
  let clientSecret = '';
  let verified = false;

  for (;;) {
    clientId = (
      guard(
        await text({ message: 'Toss API Key', placeholder: 'tsck_live_…', validate: required('API Key') }),
      ) ?? ''
    ).trim();
    clientSecret = (
      guard(await password({ message: 'Toss Secret Key', validate: required('Secret Key') })) ?? ''
    ).trim();

    if (clientId.startsWith('tssk_') || clientSecret.startsWith('tsck_')) {
      note(
        [
          'API Key와 Secret Key가 바뀐 것 같아요.',
          'API Key(tsck_…)를 먼저, Secret Key(tssk_…)를 다음에 입력해 주세요.',
        ].join('\n'),
        '확인해 주세요',
      );
      continue;
    }

    const s = spinner();
    s.start('토스증권에 키가 유효한지 확인하는 중…');
    const res = await validateTossCredentials({ clientId, clientSecret });
    if (res.ok) {
      s.stop(ok('토스증권 인증 성공 — 키가 유효해요'));
      verified = true;
      break;
    }
    const detail = [res.status && `HTTP ${res.status}`, res.code, res.message].filter(Boolean).join(' · ');
    s.stop(danger(`인증 실패${detail ? ` — ${detail}` : ''}`));

    const hint =
      res.status === 403 || res.code === 'edge-blocked' || res.code === 'forbidden'
        ? '허용 IP 목록에 현재 PC의 공인 IP가 포함돼 있는지 확인해 주세요.'
        : res.status === 401 || res.code === 'invalid-request' || res.code === 'invalid-token'
          ? 'API Key·Secret Key가 정확한지, 서로 바뀌지 않았는지 확인해 주세요.'
          : null;
    if (hint) note(hint, '도움말');

    const choice = guard(
      await select({
        message: '어떻게 할까요?',
        options: [
          { value: 'retry', label: '키 다시 입력' },
          { value: 'skip', label: '확인 없이 저장 (나중에 다시 시도)' },
          { value: 'quit', label: '종료' },
        ],
        initialValue: 'retry',
      }),
    );
    if (choice === 'skip') break;
    if (choice === 'quit') {
      cancel('설정을 종료했어요.');
      process.exit(0);
    }
  }

  return { clientId, clientSecret, baseURL: TOSS_BASE_URL, verified };
}

// ── Orchestration ─────────────────────────────────────────────────────────
export async function runSetup(): Promise<void> {
  process.stdout.write(banner());
  if (!requireTTY()) return;

  intro(`${pc.inverse(toss(' Biero '))}  ${pc.dim('설정을 시작할게요')}`);

  if (configExists()) {
    const again = guard(await confirm({ message: '이미 설정이 있어요. 다시 설정할까요?', initialValue: false }));
    if (!again) {
      outro(tossSoft('기존 설정을 그대로 둘게요.'));
      return;
    }
  }

  note(
    [
      '두 가지만 연결하면 끝나요.',
      `  ${toss('1')}  LLM 공급자  ${pc.dim('— 대화·분석을 담당하는 두뇌')}`,
      `  ${toss('2')}  토스증권 Open API  ${pc.dim('— 시세·계좌·주문')}`,
      '',
      pc.dim('키는 이 PC(~/.biero)에만 저장돼요. 검증·사용할 때만 당신이 고른 공급자(LLM·토스)와'),
      pc.dim('직접 통신하고, 비에로 서버는 거치지 않아요.'),
    ].join('\n'),
    '연결할 것',
  );

  const llm = await stepLLM();
  const tossCreds = await stepToss();

  const now = new Date().toISOString();
  const existing = loadConfig();
  const config: Config = {
    version: 1,
    llm,
    toss: tossCreds,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const savedPath = saveConfig(config);

  const permLabel =
    process.platform === 'win32' ? '사용자 폴더에 저장 (Windows 파일 ACL 적용)' : '600 (본인만 읽기/쓰기)';
  note(
    [
      kv('LLM', `${llm.label}${llm.model ? ` · ${llm.model}` : ''}`),
      kv('Toss API Key', `${maskSecret(tossCreds.clientId)} ${tossCreds.verified ? ok('· 확인됨') : warn('· 미확인')}`),
      kv('저장 위치', savedPath),
      kv('파일 권한', permLabel),
    ].join('\n'),
    '로컬에 저장했어요',
  );

  const startNow = guard(await confirm({ message: '바로 대화를 시작할까요?', initialValue: true }));
  outro(toss('준비가 끝났어요. Biero가 당신의 투자를 도울게요.'));

  if (startNow) await runChat({ fromSetup: true });
}

// ── Status view ────────────────────────────────────────────────────────────
export function showStatus(): void {
  process.stdout.write(banner());
  const cfg = loadConfig();
  if (!cfg) {
    process.stdout.write(`  ${warn('아직 설정이 없어요.')} ${pc.bold('biero setup')} 으로 시작하세요.\n\n`);
    return;
  }
  const lines = [
    '',
    kv('LLM 공급자', cfg.llm?.label ?? cfg.llm?.provider ?? '-'),
    kv('모델', cfg.llm?.model || pc.dim('(미지정)')),
    kv('Base URL', cfg.llm?.baseURL ?? '-'),
    kv('API Key', cfg.llm?.apiKey ? maskSecret(cfg.llm.apiKey) : pc.dim('(없음)')),
    '',
    kv('Toss API Key', cfg.toss?.clientId ? maskSecret(cfg.toss.clientId) : pc.dim('(없음)')),
    kv('Toss 확인', cfg.toss?.verified ? ok('확인됨') : warn('미확인')),
    '',
    kv('설정 파일', CONFIG_PATH),
    kv('업데이트', cfg.updatedAt ?? '-'),
    '',
    `  ${pc.dim('다시 설정:')} ${pc.bold('biero setup')}   ${pc.dim('초기화:')} ${pc.bold('biero reset')}`,
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}
