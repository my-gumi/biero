import readline from 'node:readline';
import type { Platform, SendResult } from '../../types.js';
import { BasePlatformAdapter } from './base.js';

// A local stdin/stdout adapter for testing the gateway core without any bot.
// Everything typed at the terminal is dispatched as if it came from a
// whitelisted user; replies print to stdout.

export class StdinAdapter extends BasePlatformAdapter {
  readonly platform: Platform = 'stdin';
  private rl?: readline.Interface;

  async connect(): Promise<boolean> {
    if (!process.stdin.isTTY) {
      process.stderr.write('[stdin] 대화형 터미널이 아니라 stdin 어댑터를 건너뜁니다.\n');
      return false;
    }
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write('[stdin] 로컬 테스트 어댑터 — 메시지를 입력하면 비서가 답합니다. (Ctrl+C 종료)\n');
    this.rl.on('line', (line) => {
      const text = line.trim();
      if (!text) return;
      void this.dispatch({
        source: { platform: 'stdin', userId: 'local', chatId: 'local', userName: 'local' },
        text,
      });
    });
    return true;
  }

  async disconnect(): Promise<void> {
    this.rl?.close();
    this.rl = undefined;
  }

  async send(_chatId: string, text: string): Promise<SendResult> {
    for (const part of this.chunk(text)) process.stdout.write(`\nBiero> ${part}\n`);
    return { ok: true };
  }
}
