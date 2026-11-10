/**
 * API key registry.
 *
 * Keys are stored hashed (SHA-256) so a leaked dump does not expose usable
 * tokens. Storage is intentionally flexible:
 *
 * - `data/api-keys.json` is always written, so keys work without Redis and
 *   survive a Redis outage or a later switch to Redis.
 * - When Redis is available the same records are mirrored to a hash, so multiple
 *   instances share them. Reads merge both stores; deletes remove both.
 *
 * Records carry a label, a role, a single-session scope and usage timestamps.
 * Legacy plaintext keys are migrated on first lookup or listing.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import logger from "@/lib/logger";
import { getRedis, isRedisAvailable } from "@/lib/redis";

const HASHED_STORE = "@baileys-wa-api:api-keys-v2";
const LEGACY_PREFIX = "@baileys-wa-api:api-keys";
const FILE_PATH = join(process.cwd(), "data", "api-keys.json");

export type ApiKeyRole = "user" | "admin";

export interface ApiKeyRecord {
  /** SHA-256 of the token; also the Redis field name and the file key. */
  hash: string;
  label: string;
  role: ApiKeyRole;
  /** Sessions this key may use; new keys always hold exactly one id. */
  sessions: string[];
  createdAt: string;
  lastUsedAt: string | null;
  /** First 8 characters of the token, for identification only (never the key). */
  tokenPrefix?: string;
}

export interface ApiKeySummary {
  id: string;
  label: string;
  role: ApiKeyRole;
  sessions: string[];
  createdAt: string;
  lastUsedAt: string | null;
  tokenPrefix?: string;
}

export interface ApiKeyAuth {
  id: string;
  label: string;
  role: ApiKeyRole;
  sessions: string[];
}

interface FileStore {
  version: 1;
  keys: Record<string, ApiKeyRecord>;
}

function emptyFileStore(): FileStore {
  return { version: 1, keys: {} };
}

let fileCache: { mtimeMs: number; store: FileStore } | null = null;

function readFileStore(): FileStore {
  if (!existsSync(FILE_PATH)) return emptyFileStore();
  try {
    const stats = statSync(FILE_PATH);
    if (fileCache && fileCache.mtimeMs === stats.mtimeMs) return fileCache.store;

    const parsed = JSON.parse(readFileSync(FILE_PATH, "utf8")) as Partial<FileStore>;
    if (!parsed || typeof parsed !== "object" || !parsed.keys) return emptyFileStore();
    const keys: Record<string, ApiKeyRecord> = {};
    for (const [hash, value] of Object.entries(parsed.keys)) {
      const record = parseRecord(hash, JSON.stringify(value));
      if (record) keys[hash] = record;
    }
    const store = { version: 1 as const, keys };
    fileCache = { mtimeMs: stats.mtimeMs, store };
    return store;
  } catch {
    return emptyFileStore();
  }
}

function writeFileStore(store: FileStore): void {
  mkdirSync(dirname(FILE_PATH), { recursive: true });
  const tmp = `${FILE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(tmp, FILE_PATH);
  fileCache = { mtimeMs: statSync(FILE_PATH).mtimeMs, store };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function shortId(hash: string): string {
  return hash.slice(0, 12);
}

function parseRecord(hash: string, raw: string): ApiKeyRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ApiKeyRecord>;
    return {
      hash,
      label: typeof parsed.label === "string" ? parsed.label : "unnamed",
      role: parsed.role === "admin" ? "admin" : "user",
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.filter((value): value is string => typeof value === "string")
        : ["*"],
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      lastUsedAt: typeof parsed.lastUsedAt === "string" ? parsed.lastUsedAt : null,
      tokenPrefix:
        typeof parsed.tokenPrefix === "string" ? parsed.tokenPrefix.slice(0, 8) : undefined,
    };
  } catch {
    return null;
  }
}

function toSummary(record: ApiKeyRecord): ApiKeySummary {
  return {
    id: shortId(record.hash),
    label: record.label,
    role: record.role,
    sessions: record.sessions,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    tokenPrefix: record.tokenPrefix,
  };
}

/** Merge file and Redis records; Redis wins when both exist. */
async function readAllRecords(): Promise<Map<string, ApiKeyRecord>> {
  const merged = new Map<string, ApiKeyRecord>();

  for (const [hash, record] of Object.entries(readFileStore().keys)) {
    merged.set(hash, record);
  }

  if (isRedisAvailable()) {
    const redis = getRedis();
    if (redis) {
      try {
        const all = await redis.hGetAll(HASHED_STORE);
        for (const [hash, raw] of Object.entries(all)) {
          const record = parseRecord(hash, raw);
          if (record) merged.set(hash, record);
        }
      } catch (error) {
        logger.warn("[ApiKeys] Redis read failed, using file store: %s", (error as Error).message);
      }
    }
  }

  return merged;
}

async function persistRecord(record: ApiKeyRecord): Promise<void> {
  const store = readFileStore();
  store.keys[record.hash] = record;
  writeFileStore(store);

  if (!isRedisAvailable()) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hSet(HASHED_STORE, record.hash, JSON.stringify(record));
  } catch (error) {
    logger.warn("[ApiKeys] Redis write failed, kept file copy: %s", (error as Error).message);
  }
}

async function deleteRecord(hash: string): Promise<void> {
  const store = readFileStore();
  if (store.keys[hash]) {
    delete store.keys[hash];
    writeFileStore(store);
  }

  if (!isRedisAvailable()) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hDel(HASHED_STORE, hash);
  } catch (error) {
    logger.warn("[ApiKeys] Redis delete failed: %s", (error as Error).message);
  }
}

/** Move plaintext legacy keys into the hashed stores. Best effort. */
async function migrateLegacyKeys(): Promise<void> {
  if (!isRedisAvailable()) return;
  const redis = getRedis();
  if (!redis) return;

  try {
    const legacy: string[] = [];
    for await (const key of redis.scanIterator({ MATCH: `${LEGACY_PREFIX}:*`, COUNT: 100 })) {
      legacy.push(String(key));
    }

    for (const key of legacy) {
      const token = key.slice(`${LEGACY_PREFIX}:`.length);
      if (!token) continue;
      const raw = await redis.get(key);
      const parsed = raw ? (JSON.parse(raw) as { role?: string; createdAt?: string }) : {};
      const record: ApiKeyRecord = {
        hash: hashToken(token),
        label: "legacy key",
        role: parsed.role === "admin" ? "admin" : "user",
        sessions: ["*"],
        createdAt: parsed.createdAt ?? new Date().toISOString(),
        lastUsedAt: null,
      };
      await persistRecord(record);
      await redis.del(key);
    }
  } catch {
    // Migration is opportunistic; existing records keep working.
  }
}

export async function listApiKeys(): Promise<ApiKeySummary[]> {
  await migrateLegacyKeys();
  const merged = await readAllRecords();
  return [...merged.values()]
    .map(toSummary)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function createApiKey(input: {
  label: string;
  /** Exactly one session: a key is bound to the number it may send from. */
  session: string;
  /** Reserved for legacy callers; dashboard keys are always "user". */
  role?: ApiKeyRole;
}): Promise<{ token: string; key: ApiKeySummary }> {
  await migrateLegacyKeys();

  // 32 random bytes as base64url: no padding, URL-safe, 256 bits of entropy.
  const token = `wa_${randomBytes(32).toString("base64url")}`;
  const record: ApiKeyRecord = {
    hash: hashToken(token),
    label: input.label.trim() || "unnamed",
    role: input.role === "admin" ? "admin" : "user",
    sessions: [input.session.trim()],
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    tokenPrefix: token.slice(0, 8),
  };

  await persistRecord(record);
  return { token, key: toSummary(record) };
}

export async function revokeApiKey(idPrefix: string): Promise<boolean> {
  const merged = await readAllRecords();
  const record = [...merged.values()].find(
    (entry) => shortId(entry.hash) === idPrefix || entry.hash === idPrefix,
  );
  if (!record) return false;
  await deleteRecord(record.hash);
  return true;
}

/** Remove keys scoped to a session that is being deleted. Wildcard keys stay. */
export async function revokeApiKeysForSession(sessionId: string): Promise<number> {
  const records = await readAllRecords();
  let removed = 0;
  for (const record of records.values()) {
    if (record.sessions.includes(sessionId)) {
      await deleteRecord(record.hash);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Resolve a presented token without scanning: one Redis hGet, then the cached
 * file store, then a single legacy GET. The old version called KEYS and parsed
 * every record on each authenticated request.
 */
export async function findApiKeyByToken(token: string): Promise<ApiKeyAuth | null> {
  const hash = hashToken(token);
  let record: ApiKeyRecord | null = null;

  if (isRedisAvailable()) {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.hGet(HASHED_STORE, hash).catch(() => null);
      if (raw) record = parseRecord(hash, raw);
    }
  }

  if (!record) record = readFileStore().keys[hash] ?? null;

  if (!record && isRedisAvailable()) {
    const redis = getRedis();
    if (redis) {
      const legacy = await redis.get(`${LEGACY_PREFIX}:${token}`).catch(() => null);
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy) as { role?: string; createdAt?: string };
          record = {
            hash,
            label: "legacy key",
            role: parsed.role === "admin" ? "admin" : "user",
            sessions: ["*"],
            createdAt: parsed.createdAt ?? new Date().toISOString(),
            lastUsedAt: null,
          };
          await persistRecord(record);
          await redis.del(`${LEGACY_PREFIX}:${token}`).catch(() => undefined);
        } catch {
          return null;
        }
      }
    }
  }

  if (!record) return null;
  return touch(record);
}

/** lastUsedAt is written at most once per minute per key, not per request. */
const lastTouchedAt = new Map<string, number>();

async function touch(record: ApiKeyRecord): Promise<ApiKeyAuth> {
  const now = Date.now();
  const last = lastTouchedAt.get(record.hash) ?? 0;

  if (now - last > 60_000) {
    if (lastTouchedAt.size > 5000) lastTouchedAt.clear();
    lastTouchedAt.set(record.hash, now);
    const updated: ApiKeyRecord = { ...record, lastUsedAt: new Date(now).toISOString() };
    await persistRecord(updated).catch(() => undefined);
  }

  return {
    id: shortId(record.hash),
    label: record.label,
    role: record.role,
    sessions: record.sessions,
  };
}

/** True when a key may act on a session (["*"] means every session). */
export function keyAllowsSession(sessions: string[] | undefined, sessionId: string): boolean {
  if (!sessions || sessions.length === 0) return true;
  return sessions.includes("*") || sessions.includes(sessionId);
}
