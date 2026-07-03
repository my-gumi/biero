import type { InboundEvent, Platform, SendResult } from '../../types.js';

// Common contract every messenger adapter implements, modelled on Hermes'
// BasePlatformAdapter. The core wires one `MessageHandler` into each adapter;
// adapters call `dispatch()` for every inbound message.

export type MessageHandler = (evt: InboundEvent, adapter: BasePlatformAdapter) => Promise<void>;

export abstract class BasePlatformAdapter {
  abstract readonly platform: Platform;
  /** Max characters per outbound message; adapters override per platform. */
  protected readonly sendLimit: number = 4000;

  constructor(protected readonly handler: MessageHandler) {}

  /** Establish the connection and start listening. Resolves false on failure. */
  abstract connect(): Promise<boolean>;

  /** Close connections and cancel any polling/socket tasks. */
  abstract disconnect(): Promise<void>;

  /** Send a text message to a chat, splitting past the platform limit. */
  abstract send(chatId: string, text: string): Promise<SendResult>;

  /** Optional typing indicator while the agent thinks. */
  sendTyping?(chatId: string): Promise<void>;

  /** Hand an inbound message to the core (skipping the bot's own messages). */
  protected async dispatch(evt: InboundEvent): Promise<void> {
    if (evt.isSelf) return;
    if (!evt.text?.trim()) return;
    await this.handler(evt, this);
  }

  /** Split `text` into chunks no longer than `limit`, preferring line breaks. */
  protected chunk(text: string, limit = this.sendLimit): string[] {
    const out: string[] = [];
    let rest = text;
    while (rest.length > limit) {
      let cut = rest.lastIndexOf('\n', limit);
      if (cut < limit * 0.5) cut = limit; // no nearby newline → hard split
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n/, '');
    }
    if (rest) out.push(rest);
    return out;
  }
}
