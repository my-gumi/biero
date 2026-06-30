import pc from 'picocolors';

// ── Toss-inspired palette (truecolor ANSI) ───────────────────────────────
// Respect NO_COLOR / non-TTY by mirroring picocolors' own detection.
const rgb =
  (r: number, g: number, b: number) =>
  (s: string): string =>
    pc.isColorSupported ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m` : String(s);

export const toss = rgb(49, 130, 246); // Toss blue  #3182F6
export const tossSoft = rgb(120, 170, 235);
export const ok = rgb(38, 197, 129); // green
export const warn = rgb(245, 190, 80); // amber
export const danger = rgb(235, 90, 80); // red

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

// Horizontal gradient wordmark (Toss blue → light blue).
export function wordmark(text = 'Biero'): string {
  if (!pc.isColorSupported) return pc.bold(text);
  const from: [number, number, number] = [49, 130, 246];
  const to: [number, number, number] = [125, 205, 255];
  const chars = [...text];
  return chars
    .map((ch, i) => {
      const t = chars.length === 1 ? 0 : i / (chars.length - 1);
      const r = lerp(from[0], to[0], t);
      const g = lerp(from[1], to[1], t);
      const b = lerp(from[2], to[2], t);
      return `\x1b[1m\x1b[38;2;${r};${g};${b}m${ch}\x1b[0m`;
    })
    .join('');
}

export function banner(): string {
  return [
    '',
    `  ${wordmark('Biero')}   ${pc.dim('주식 AI 비서')}`,
    `  ${pc.dim('Behavioral Intelligence for Evaluating Risk & Optimization')}`,
    '',
  ].join('\n');
}

// A "key: value" line for status views.
export function kv(key: string, value: string): string {
  return `  ${pc.dim(key.padEnd(12))} ${value}`;
}
