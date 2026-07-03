import type { Client, Message } from 'discord.js';
import type { Platform, SendResult } from '../../shared/types.js';
import { BasePlatformAdapter, type MessageHandler } from './base.js';

// Discord adapter over the Gateway WebSocket via discord.js (Hermes uses
// discord.py). discord.js handles the socket lifecycle and reconnection with
// backoff internally, so we only wire message events and delivery.
//
// `import type` is erased at runtime, so this module loads even when discord.js
// isn't installed; the actual library is imported lazily inside connect().

export class DiscordAdapter extends BasePlatformAdapter {
  readonly platform: Platform = 'discord';
  protected readonly sendLimit = 2000; // Discord message limit

  private client?: Client;

  constructor(
    handler: MessageHandler,
    private readonly token: string,
  ) {
    super(handler);
  }

  async connect(): Promise<boolean> {
    let d: typeof import('discord.js');
    try {
      d = await import('discord.js');
    } catch {
      throw new Error('discord.js 가 설치돼 있지 않아요. `npm i discord.js` 후 다시 시도하세요.');
    }
    const { Client, GatewayIntentBits, Partials, Events } = d;

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // privileged — enable in the Dev Portal
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel], // needed to receive DMs
    });
    this.client = client;

    client.on(Events.MessageCreate, (msg: Message) => {
      if (msg.author?.bot) return; // ignore bots (incl. self)
      void this.dispatch({
        source: {
          platform: 'discord',
          userId: msg.author.id,
          chatId: msg.channelId,
          userName: msg.author.username,
        },
        text: msg.content ?? '',
        isSelf: msg.author.id === client.user?.id,
      });
    });
    client.on(Events.Error, (e) => process.stderr.write(`[discord] 오류: ${e?.message || e}\n`));

    await new Promise<void>((resolve, reject) => {
      client.once(Events.ClientReady, (c) => {
        process.stderr.write(`[discord] 연결됨 — ${c.user.tag}\n`);
        resolve();
      });
      client.login(this.token).catch(reject);
    });
    return true;
  }

  async disconnect(): Promise<void> {
    await this.client?.destroy();
    this.client = undefined;
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      const ch = await this.client?.channels.fetch(chatId);
      if (ch && 'sendTyping' in ch) await ch.sendTyping();
    } catch {
      /* best-effort */
    }
  }

  async send(chatId: string, text: string): Promise<SendResult> {
    try {
      const ch = await this.client?.channels.fetch(chatId);
      if (!ch || !('send' in ch)) return { ok: false, error: '메시지를 보낼 수 없는 채널이에요.' };
      for (const part of this.chunk(text)) await ch.send(part);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
}
