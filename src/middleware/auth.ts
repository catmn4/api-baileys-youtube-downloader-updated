import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import config from "@/config";
import logger from "@/lib/logger";
import { getRedis, isRedisAvailable } from "@/lib/redis";
import { error } from "@/lib/response";
import { findApiKeyByToken, keyAllowsSession } from "@/services/apiKeys";

const REDIS_API_KEY_PREFIX = "@baileys-wa-api:api-keys";

export interface AuthData {
  role: "user" | "admin";
  /** Short id of the API key that authenticated the request. */
  keyId?: string;
  label?: string;
  /** Session ids the key may use; ["*"] means every session. */
  sessions?: string[];
}

function normalizeToken(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^Bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^Bearer\s+/i, "").trim() || null;
  }
  return trimmed;
}

function collectAuthCandidates(c: Context): string[] {
  const candidates = [
    normalizeToken(c.req.header("Authorization")),
    normalizeToken(c.req.header("x-api-key")),
    normalizeToken(c.req.header("x-access-token")),
    normalizeToken(c.req.header("token")),
  ].filter((v): v is string => Boolean(v));

  return [...new Set(candidates)];
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
  } catch {
    return false;
  }
}

/**
 * Authentication middleware.
 * - Development: skips auth
 * - Simple mode (AUTH_GLOBAL_TOKEN): checks standard token headers
 *   (`Authorization`, `x-api-key`, `x-access-token`, `token`)
 * - Redis mode: checks the same header candidates against Redis-stored API keys
 */
export async function authMiddleware(c: Context, next: Next) {
  // Skip auth in development
  if (config.env === "development") {
    return next();
  }

  const authCandidates = collectAuthCandidates(c);

  // Try simple token auth first (timing-safe comparison)
  if (config.auth.globalToken) {
    for (const token of authCandidates) {
      if (safeCompare(token, config.auth.globalToken)) {
        return next();
      }
    }
  }

  // Hashed keys live in Redis and/or the file store; the latter works without
  // Redis, so the lookup is not gated on availability.
  for (const apiKey of authCandidates) {
    try {
      const record = await findApiKeyByToken(apiKey);
      if (record) {
        const auth: AuthData = {
          role: record.role,
          keyId: record.id,
          label: record.label,
          sessions: record.sessions,
        };
        c.set("auth", auth);
        return next();
      }
    } catch (error) {
      logger.error("Auth middleware error: %s", (error as Error).message);
    }
  }

  // No simple token and no Redis key → check if simple token was configured
  if (config.auth.globalToken) {
    return error(c, "Unauthorized: invalid token", 401, undefined, {
      hint: "Check AUTH_GLOBAL_TOKEN, or use an API key created in Dashboard → REST API.",
      retryable: false,
    });
  }

  return error(c, "Unauthorized: API key required", 401, undefined, {
    hint: "Send Authorization: Bearer <API_KEY> or x-api-key. Create and revoke keys in Dashboard → REST API.",
    retryable: false,
  });
}

/**
 * Admin-only guard (requires Redis API key with admin role).
 */
export async function adminGuard(c: Context, next: Next) {
  await authMiddleware(c, async () => {});

  const auth = c.get("auth") as AuthData | undefined;
  if (auth?.role !== "admin" && config.env !== "development") {
    return error(c, "Forbidden: admin access required", 403, undefined, {
      hint: "Use an API key with the admin role.",
      retryable: false,
    });
  }

  return next();
}

/** True when the request is authenticated as an admin key or the legacy global token. */
export function isAdminApiAuth(c: Context): boolean {
  if (config.env === "development") return true;
  const auth = c.get("auth") as AuthData | undefined;
  if (!auth) return Boolean(config.auth.globalToken);
  return auth.role === "admin";
}

/**
 * Enforce API-key session scope. Admin keys and the legacy global token may
 * access every session; user keys only their scoped list. Development bypasses
 * auth entirely, matching authMiddleware.
 */
export function authAllowsSession(c: Context, sessionId: string): boolean {
  if (config.env === "development") return true;
  const auth = c.get("auth") as AuthData | undefined;
  if (!auth) return Boolean(config.auth.globalToken);
  if (auth.role === "admin") return true;
  return keyAllowsSession(auth.sessions, sessionId);
}
