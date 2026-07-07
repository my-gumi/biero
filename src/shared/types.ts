// Shared types for Biero.

export type Strategy = 'openai' | 'anthropic' | 'ollama';

export interface Provider {
  id: string;
  label: string;
  hint: string;
  baseURL: string;
  needsKey: boolean;
  strategy: Strategy;
}

export interface LlmConfig {
  provider: string;
  label?: string;
  baseURL: string;
  apiKey?: string;
  model?: string;
}

export interface TossConfig {
  clientId: string;
  clientSecret: string;
  baseURL?: string;
  verified?: boolean;
  accountSeq?: string;
  accountLabel?: string;
}

export interface Config {
  version: number;
  llm: LlmConfig;
  toss: TossConfig;
  gateway?: GatewayConfig;
  createdAt?: string;
  updatedAt?: string;
}

// ── Messenger gateway (mobile remote assistant) ────────────────────────────

/** Messenger platforms the gateway can bridge to the agent. */
export type Platform = 'telegram' | 'discord' | 'stdin';

/** Per-platform gateway settings, persisted under `Config.gateway`. */
export interface PlatformConfig {
  enabled: boolean;
  /** Bot token / secret. Env var (e.g. TELEGRAM_BOT_TOKEN) overrides this. */
  botToken?: string;
  /** Whitelisted sender ids. Empty = deny all; `['*']` = allow all. */
  allowedUsers: string[];
  /** Telegram home channel captured via /sethome. */
  homeChatId?: string;
}

export interface GatewayConfig {
  telegram?: PlatformConfig;
  discord?: PlatformConfig;
  /** Messages kept per conversation before trimming (default 20). */
  maxHistory?: number;
  /** Idle session expiry in ms (default 6h). */
  idleTtlMs?: number;
}

/** Identity of one inbound conversation — session key + reply target. */
export interface SessionSource {
  platform: Platform;
  /** Sender id, used for whitelist auth and session keying. */
  userId: string;
  /** Where a reply should be sent back. */
  chatId: string;
  /** Human-readable sender name, for operator-facing logs. */
  userName?: string;
}

/** One inbound message handed from a platform adapter to the core. */
export interface InboundEvent {
  source: SessionSource;
  text: string;
  /** True when the message originated from the bot itself (skip). */
  isSelf?: boolean;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}
