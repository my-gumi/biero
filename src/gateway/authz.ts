// Whitelist enforcement — the gateway's only line of defence, since inbound
// messages drive the LLM agent (and its Toss tools). Mirrors Hermes'
// authz_mixin.py. Secure default: an empty whitelist denies everyone.

/**
 * Is `userId` allowed to talk to the bot?
 *
 * - empty list  → deny all (nobody configured yet)
 * - `['*']`     → allow all (explicit opt-in only)
 * - otherwise   → exact id match
 */
export function isAllowed(allowedUsers: string[], userId: string): boolean {
  if (!allowedUsers.length) return false;
  if (allowedUsers.includes('*')) return true;
  return allowedUsers.includes(String(userId));
}
