/**
 * Login brute-force guard.
 *
 * Tracks failures for the submitted username and the client IP separately. A
 * distributed attack against one account trips the username counter; a single
 * host spraying many usernames trips the IP counter. Both use a fixed window and
 * then lock for a configurable duration.
 *
 * The caller must keep the 401/429 messages generic: because unknown usernames
 * are tracked too, locking does not reveal whether an account exists.
 */
import { LRUCache } from "lru-cache";
import config from "@/config";

interface GuardEntry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

const cache = new LRUCache<string, GuardEntry>({
  max: 20000,
  ttl: Math.max(config.loginGuard.windowMs, config.loginGuard.lockMs) * 2,
});

function keysFor(username: string, ip: string): string[] {
  return [`user:${username}`, `ip:${ip}`];
}

/** Remaining lock time in milliseconds (0 when not locked). */
export function lockRemainingMs(username: string, ip: string): number {
  const now = Date.now();
  let remaining = 0;
  for (const key of keysFor(username, ip)) {
    const entry = cache.get(key);
    if (entry && entry.lockedUntil > now) {
      remaining = Math.max(remaining, entry.lockedUntil - now);
    }
  }
  return remaining;
}

export function recordLoginFailure(username: string, ip: string): void {
  const now = Date.now();
  const { maxFailures, windowMs, lockMs } = config.loginGuard;

  for (const key of keysFor(username, ip)) {
    const entry = cache.get(key) ?? { failures: 0, windowStart: now, lockedUntil: 0 };

    if (now - entry.windowStart > windowMs) {
      entry.failures = 0;
      entry.windowStart = now;
    }

    entry.failures += 1;
    if (entry.failures >= maxFailures) {
      entry.lockedUntil = now + lockMs;
      entry.failures = 0;
      entry.windowStart = now;
    }

    cache.set(key, entry);
  }
}

export function resetLoginFailures(username: string, ip: string): void {
  for (const key of keysFor(username, ip)) cache.delete(key);
}
