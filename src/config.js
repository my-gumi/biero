import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const CONFIG_DIR = path.join(os.homedir(), '.biero');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function configExists() {
  return fs.existsSync(CONFIG_PATH);
}

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Persist config to ~/.biero/config.json with owner-only permissions.
 * Returns the absolute path written.
 */
export function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // mkdir mode only applies on creation (and is umask-masked); enforce for
  // a pre-existing dir too. Best-effort (no-op on Windows).
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch {
    /* best-effort */
  }
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // mode on writeFile is masked by umask for existing files; enforce explicitly.
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best-effort (e.g. Windows) */
  }
  return CONFIG_PATH;
}

export function clearConfig() {
  try {
    fs.rmSync(CONFIG_PATH, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Mask a secret for display: keep first/last `show` chars, never lengthen. */
export function maskSecret(s, show = 4) {
  if (!s) return '';
  // Short values: fully mask (don't reveal most of a short secret).
  if (s.length < 12) return '•'.repeat(s.length);
  return `${s.slice(0, show)}${'•'.repeat(s.length - show * 2)}${s.slice(-show)}`;
}
