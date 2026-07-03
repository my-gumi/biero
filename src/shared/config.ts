import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Config } from './types.js';

export const CONFIG_DIR = path.join(os.homedir(), '.biero');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

export function loadConfig(): Config | null {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Config;
  } catch {
    return null;
  }
}

/** Persist config to ~/.biero/config.json with owner-only permissions. */
export function saveConfig(config: Config): string {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // mkdir mode only applies on creation (and is umask-masked); enforce for a
  // pre-existing dir too. Best-effort (no-op on Windows).
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch {
    /* best-effort */
  }
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best-effort (e.g. Windows) */
  }
  return CONFIG_PATH;
}

export function clearConfig(): boolean {
  try {
    fs.rmSync(CONFIG_PATH, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Mask a secret for display: keep first/last `show` chars, never lengthen. */
export function maskSecret(s: string | null | undefined, show = 4): string {
  if (!s) return '';
  if (s.length < 12) return '•'.repeat(s.length);
  return `${s.slice(0, show)}${'•'.repeat(s.length - show * 2)}${s.slice(-show)}`;
}
