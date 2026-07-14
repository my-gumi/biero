import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../shared/config.js';
import type { ChatMessage } from '../shared/types.js';

// Persistent CLI conversation history, so `biero chat --continue` can resume
// the last session. Stored under ~/.biero/sessions/cli-latest.json.
export const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const LATEST_PATH = path.join(SESSIONS_DIR, 'cli-latest.json');

/** Keep at most this many messages on disk to bound file growth. */
const MAX_PERSISTED = 100;

interface StoredHistory {
  updatedAt: string;
  messages: ChatMessage[];
}

/** Load the last saved CLI conversation, or an empty list if none/corrupt. */
export function loadHistory(): ChatMessage[] {
  try {
    const data = JSON.parse(fs.readFileSync(LATEST_PATH, 'utf8')) as StoredHistory;
    return Array.isArray(data?.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

/** Persist the CLI conversation (owner-only), trimming to the most recent turns. */
export function saveHistory(messages: ChatMessage[]): void {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
    const trimmed = messages.slice(-MAX_PERSISTED);
    const payload: StoredHistory = { updatedAt: new Date().toISOString(), messages: trimmed };
    fs.writeFileSync(LATEST_PATH, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  } catch {
    /* best-effort: never let a persistence failure break the chat */
  }
}

/** Delete the saved CLI conversation. Returns true if a file was removed. */
export function clearHistory(): boolean {
  try {
    if (!fs.existsSync(LATEST_PATH)) return false;
    fs.rmSync(LATEST_PATH, { force: true });
    return true;
  } catch {
    return false;
  }
}
