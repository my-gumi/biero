import type { Platform, SendResult } from '../../types.js';
import { BasePlatformAdapter, type MessageHandler } from './base.js';

// Telegram Bot API adapter using long polling (getUpdates) — no public URL or
// webhook needed, which suits the "PC kept on at home" scenario. Raw fetch,
// matching the codebase's dependency-light style (see agent.ts / toss.ts).

const API = 'https://api.telegram.org';

interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
  is_bot?: boolean;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export class TelegramAdapter extends BasePlatformAdapter {
  readonly platform: Platform = 'telegram';
  protected readonly sendLimit = 4000; // Telegram hard limit is 4096

  private running = false;
  private offset = 0;
  private ctrl?: AbortController;

  constructor(
    handler: MessageHandler,
    private readonly token: string,
  ) {
    super(handler);
  }

  private async api<T = any>(method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.description || `Telegram ${method} 실패 (HTTP ${res.status})`);
    }
    return data.result as T;
  }

  async connect(): Promise<boolean> {
    const me = await this.api<TgUser>('getMe');
    process.stderr.write(`[telegram] 연결됨 — @${me.username ?? me.id}\n`);
    this.running = true;
    void this.poll();
    return true;
  }

  private async poll(): Promise<void> {
    let backoff = 1000;
    while (this.running) {
      this.ctrl = new AbortController();
      try {
        const updates = await this.api<TgUpdate[]>(
          'getUpdates',
          { offset: this.offset, timeout: 30, allowed_updates: ['message'] },
          this.ctrl.signal,
        );
        backoff = 1000;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          const m = u.message;
          if (!m?.text || !m.from) continue;
          void this.dispatch({
            source: {
              platform: 'telegram',
              userId: String(m.from.id),
              chatId: String(m.chat.id),
              userName: m.from.username ?? m.from.first_name,
            },
            text: m.text,
            isSelf: m.from.is_bot === true,
          });
        }
      } catch (e: any) {
        if (!this.running || e?.name === 'AbortError') break;
        process.stderr.write(`[telegram] 폴링 오류: ${e?.message || e} — ${backoff}ms 후 재시도\n`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.running = false;
    this.ctrl?.abort();
  }

  async sendTyping(chatId: string): Promise<void> {
    await this.api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  }

  async send(chatId: string, text: string): Promise<SendResult> {
    try {
      for (const part of this.chunk(text)) {
        await this.api('sendMessage', { chat_id: chatId, text: part });
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
}
