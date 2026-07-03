import { runAgent } from '../runtime/agent.js';
import type { Config, InboundEvent, SessionSource } from '../shared/types.js';
import { isAllowed } from './authz.js';
import { handleCommand, parseCommand } from './commands.js';
import type { ResolvedGateway } from './config.js';
import type { BasePlatformAdapter } from './platforms/base.js';
import type { SessionStore } from './session.js';

// The transport-agnostic heart of the gateway: authenticate, route commands,
// otherwise drive runAgent and deliver the reply. One instance handles every
// platform; adapters call `handle()` for each inbound message.

export class GatewayCore {
  private readonly startedAt = Date.now();

  constructor(
    private readonly cfg: Config,
    private readonly gateway: ResolvedGateway,
    private readonly session: SessionStore,
  ) {}

  /** Allowed-users for a source's platform (stdin is always local-trusted). */
  private allowedFor(source: SessionSource): string[] {
    if (source.platform === 'telegram') return this.gateway.telegram.allowedUsers;
    if (source.platform === 'discord') return this.gateway.discord.allowedUsers;
    return ['*']; // stdin — operator on the local machine
  }

  async handle(evt: InboundEvent, adapter: BasePlatformAdapter): Promise<void> {
    const { source, text } = evt;

    // 1. Whitelist — the gateway's only line of defence.
    if (!isAllowed(this.allowedFor(source), source.userId)) {
      process.stderr.write(
        `[${source.platform}] 거부: userId=${source.userId}` +
          `${source.userName ? ` (${source.userName})` : ''} — 화이트리스트에 없음\n`,
      );
      await adapter.send(source.chatId, '권한이 없어요. 관리자에게 사용자 ID 등록을 요청하세요.').catch(() => {});
      return;
    }

    // 2. Slash commands are handled locally.
    const cmd = parseCommand(text);
    if (cmd) {
      const reply = await handleCommand(cmd, {
        source,
        cfg: this.cfg,
        gateway: this.gateway,
        session: this.session,
        startedAt: this.startedAt,
      });
      await adapter.send(source.chatId, reply).catch(() => {});
      return;
    }

    // 3. Otherwise, drive the agent.
    const messages = this.session.get(source);
    messages.push({ role: 'user', content: text });
    void adapter.sendTyping?.(source.chatId).catch(() => {});

    try {
      const reply = await runAgent(this.cfg, messages, {
        onTool: () => void adapter.sendTyping?.(source.chatId).catch(() => {}),
      });
      this.session.trim(source);
      await adapter.send(source.chatId, (reply || '(빈 응답)').trim());
    } catch (e: any) {
      messages.pop(); // drop the unanswered turn so history stays clean
      await adapter.send(source.chatId, `오류: ${e?.message || e}`).catch(() => {});
    }
  }
}
