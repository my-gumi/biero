import type { ChatMessage, SessionSource } from '../types.js';

// Per-conversation history store. Each (platform, userId) pair gets its own
// message list — the same array handed to runAgent, which appends the reply.
// Mirrors Hermes' gateway/session.py (SessionSource-keyed sessions).

interface Session {
  messages: ChatMessage[];
  lastActive: number;
}

function keyOf(source: SessionSource): string {
  return `${source.platform}:${source.userId}`;
}

export class SessionStore {
  private sessions = new Map<string, Session>();

  constructor(
    private readonly maxHistory: number,
    private readonly idleTtlMs: number,
  ) {}

  /** Get (or create) the mutable message list for a source, pruning if idle. */
  get(source: SessionSource): ChatMessage[] {
    const key = keyOf(source);
    const now = Date.now();
    let s = this.sessions.get(key);
    if (s && now - s.lastActive > this.idleTtlMs) {
      this.sessions.delete(key);
      s = undefined;
    }
    if (!s) {
      s = { messages: [], lastActive: now };
      this.sessions.set(key, s);
    }
    s.lastActive = now;
    return s.messages;
  }

  /** Trim a source's history to the most recent `maxHistory` messages. */
  trim(source: SessionSource): void {
    const s = this.sessions.get(keyOf(source));
    if (s && s.messages.length > this.maxHistory) {
      s.messages.splice(0, s.messages.length - this.maxHistory);
    }
  }

  /** Clear one conversation's history (/reset). Returns true if it existed. */
  reset(source: SessionSource): boolean {
    return this.sessions.delete(keyOf(source));
  }

  /** Drop all sessions past their idle TTL. */
  sweep(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, s] of this.sessions) {
      if (now - s.lastActive > this.idleTtlMs) {
        this.sessions.delete(key);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.sessions.size;
  }
}
