import type { Config, GatewayConfig, PlatformConfig } from '../shared/types.js';

// Resolved gateway settings: config.json values with env-var overrides applied.
// Mirrors Hermes' `_apply_env_overrides` — env always wins when present.

export interface ResolvedPlatform {
  enabled: boolean;
  botToken?: string;
  allowedUsers: string[];
  homeChatId?: string;
}

export interface ResolvedGateway {
  telegram: ResolvedPlatform;
  discord: ResolvedPlatform;
  maxHistory: number;
  idleTtlMs: number;
}

const DEFAULT_MAX_HISTORY = 20;
const DEFAULT_IDLE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/** Parse a comma/space-separated env list into trimmed, non-empty ids. */
function envList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function resolvePlatform(
  saved: PlatformConfig | undefined,
  tokenEnv: string,
  usersEnv: string,
  homeEnv?: string,
): ResolvedPlatform {
  const botToken = env(tokenEnv) ?? saved?.botToken;
  const envUsers = envList(usersEnv);
  const allowedUsers = envUsers.length ? envUsers : saved?.allowedUsers ?? [];
  const homeChatId = (homeEnv ? env(homeEnv) : undefined) ?? saved?.homeChatId;
  // A platform runs when it has a token and is opted in — either enabled in
  // config.json, or a token supplied via env (which implies intent to run).
  const enabledInConfig = saved?.enabled ?? false;
  const enabledViaEnv = Boolean(env(tokenEnv));
  const enabled = Boolean(botToken) && (enabledInConfig || enabledViaEnv);
  return { enabled, botToken, allowedUsers, homeChatId };
}

export function resolveGateway(cfg: Config): ResolvedGateway {
  const g: GatewayConfig = cfg.gateway ?? {};
  return {
    telegram: resolvePlatform(g.telegram, 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS', 'TELEGRAM_HOME_CHAT'),
    discord: resolvePlatform(g.discord, 'DISCORD_BOT_TOKEN', 'DISCORD_ALLOWED_USERS'),
    maxHistory: g.maxHistory ?? DEFAULT_MAX_HISTORY,
    idleTtlMs: g.idleTtlMs ?? DEFAULT_IDLE_TTL_MS,
  };
}

/** Which platforms have a usable configuration (token present, not disabled). */
export function enabledPlatforms(g: ResolvedGateway): Array<'telegram' | 'discord'> {
  const out: Array<'telegram' | 'discord'> = [];
  if (g.telegram.enabled) out.push('telegram');
  if (g.discord.enabled) out.push('discord');
  return out;
}
