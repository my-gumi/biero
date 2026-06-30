#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { confirm, isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { runSetup, showStatus } from '../src/setup.js';
import { runChat } from '../src/chat.js';
import { configExists, clearConfig, CONFIG_PATH } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Compiled layout is dist/bin/biero.js → package.json is two levels up.
const projectRoot = path.resolve(__dirname, '..', '..');

function readPkg(): { name: string; version: string } {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  } catch {
    return { name: 'biero', version: '0.0.0' };
  }
}

function printHelp(): void {
  const { version } = readPkg();
  process.stdout.write(`
${pc.bold('Biero')} v${version} — 리스크 평가 및 최적화를 위한 행동 지능 비서

${pc.dim('사용법')}
  biero [command]

${pc.dim('명령')}
  chat             AI 비서와 대화 (LLM에 바로 요청·응답)
  setup            LLM 공급자 · 토스증권 API 키를 설정 (대화형)
  config, status   현재 설정 보기
  reset            저장된 설정 삭제
  -v, --version    버전 출력
  -h, --help       도움말

${pc.dim('그냥')} biero ${pc.dim('— 설정돼 있으면 대화, 아니면 설정 위저드가 열려요.')}
`);
}

async function reset(): Promise<void> {
  if (!configExists()) {
    process.stdout.write(`\n  설정이 없어요. 지울 것도 없네요.\n\n`);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`\n  대화형 터미널이 필요해요. 터미널에서 직접 ${pc.bold('biero reset')} 을 실행해 주세요.\n\n`);
    process.exitCode = 1;
    return;
  }
  const yes = await confirm({ message: `정말 설정을 삭제할까요? (${CONFIG_PATH})`, initialValue: false });
  if (isCancel(yes) || !yes) {
    process.stdout.write(`\n  취소했어요.\n\n`);
    return;
  }
  clearConfig();
  process.stdout.write(`\n  ${pc.bold('삭제 완료.')} 다시 설정하려면 biero setup 을 실행하세요.\n\n`);
}

async function main(): Promise<void> {
  const [cmd] = process.argv.slice(2);

  switch (cmd) {
    case 'setup':
      return runSetup();
    case 'chat':
      return runChat();
    case 'config':
    case 'status':
      return showStatus();
    case 'reset':
      return reset();
    case '-v':
    case '--version':
      return void process.stdout.write(`${readPkg().version}\n`);
    case '-h':
    case '--help':
      return printHelp();
    case undefined:
      return configExists() ? runChat() : runSetup();
    default:
      process.stdout.write(`\n  알 수 없는 명령: ${pc.bold(cmd)}\n`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
