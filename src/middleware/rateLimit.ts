/**
 * Rate Limiting Middleware
 *
 * Uses LRU cache for efficient in-memory rate limiting.
 * Supports per-IP and per-session rate limits.
 */
import type { Context, Next } from "hono";
import { LRUCache } from "lru-cache";
import config from "@/config";
import { error } from "@/lib/response";

interface RateLimitOptions {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests allowed within the window */
  max: number;
  /** Custom key generator function. Defaults to IP-based. */
  keyGenerator?: (c: Context) => string;
  /** Custom message for rate limit exceeded */
  message?: string;
  /** Stable machine-readable code for the 429 body. */
  code?: string;
  /** Actionable next step for the caller. */
  hint?: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Creates a rate limiting middleware with fixed-window algorithm.
 */
export function rateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    keyGenerator,
    message = "Too many requests, please try again later",
    code = "RATE_LIMITED",
    hint = "Back off and retry after the seconds in the Retry-After header.",
  } = options;

  const cache = new LRUCache<string, RateLimitEntry>({
    max: 50000,
    ttl: windowMs,
  });

  return async (c: Context, next: Next) => {
    const key = keyGenerator?.(c) ?? getClientIp(c);
    const now = Date.now();
    const entry = cache.get(key);

    if (entry && now < entry.resetAt) {
      entry.count++;

      if (entry.count > max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        c.header("Retry-After", String(retryAfter));
        c.header("X-RateLimit-Limit", String(max));
        c.header("X-RateLimit-Remaining", "0");
        c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
        return error(c, message, 429, code, { hint, retryable: true });
      }

      cache.set(key, entry);
    } else {
      cache.set(key, { count: 1, resetAt: now + windowMs });
    }

    // Add rate limit headers to successful responses
    const remaining = Math.max(0, max - (cache.get(key)?.count ?? 0));
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));

    return next();
  };
}

/**
 * Extract client IP address.
 *
 * When TRUST_PROXY=true (behind a trusted reverse proxy / LB), the real
 * client IP is read from forwarding headers.
 *
 * When TRUST_PROXY=false (default — direct exposure), forwarding headers are
 * IGNORED because they are client-supplied and spoofable; the socket remote
 * address is used instead so attackers cannot bypass rate limits / auth by
 * forging x-forwarded-for.
 */
export function getClientIp(c: Context): string {
  if (config.trustProxy) {
    return (
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      c.req.header("cf-connecting-ip") ||
      getRemoteAddress(c) ||
      "unknown"
    );
  }
  return getRemoteAddress(c) || "unknown";
}

/** Socket remote address (peer) — not spoofable by client headers. */
function getRemoteAddress(c: Context): string {
  // Hono passes runtime-specific env as the 2nd fetch arg (Bun server object
  // for Bun.serve; the raw IncomingMessage for @hono/node-server).
  const env = c.env as
    | {
        incoming?: { socket?: { remoteAddress?: string } };
        requestIP?: (req: unknown) => { address: string } | null;
      }
    | undefined;
  const fromSocket = env?.incoming?.socket?.remoteAddress;
  if (fromSocket) return fromSocket;
  // Bun.serve exposes server.requestIP(request) → { address }
  const viaBun = env?.requestIP?.(c.req.raw)?.address;
  return viaBun || "";
}

// ── Pre-configured rate limiters ───────────────────

/** General API: 100 req/min per IP */
export const generalRateLimit = rateLimit({
  windowMs: 60_000,
  max: 100,
});

/** Auth/Login: 5 req/min per IP */
export const authRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  message: "Too many login attempts, please try again later",
});

/** Send message: 30 req/min per session+IP */
export const sendRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (c) => {
    const ip = getClientIp(c);
    const sessionId = c.req.param("sessionId") || "global";
    return `send:${sessionId}:${ip}`;
  },
});

/** Bulk/Broadcast: 5 req/min per session+IP */
export const bulkRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyGenerator: (c) => {
    const ip = getClientIp(c);
    const sessionId = c.req.param("sessionId") || "global";
    return `bulk:${sessionId}:${ip}`;
  },
});

/** Per API key: configurable, falls back to IP when unauthenticated. */
export const apiKeyRateLimit = rateLimit({
  windowMs: 60_000,
  max: config.rateLimit.perApiKey,
  message: "API key rate limit exceeded",
  hint: "Wait for Retry-After, or create a separate key per integration if you need more throughput.",
  keyGenerator: (c) => {
    const auth = c.get("auth") as { keyId?: string } | undefined;
    return auth?.keyId ? `key:${auth.keyId}` : `ip:${getClientIp(c)}`;
  },
});

/** Session create: 10 req/min per IP */
export const sessionRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
});
