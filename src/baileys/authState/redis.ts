import {
  type AuthenticationCreds,
  type AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { decodeMetadataSecrets, encodeMetadataSecrets } from "@/baileys/authState/metadataSecrets";
import logger from "@/lib/logger";
import { getRedis } from "@/lib/redis";
import { assertValidSessionId } from "@/lib/sessionId";

const REDIS_KEY_PREFIX = "@baileys-wa-api:connections";

export async function useRedisAuthState(
  sessionId: string,
  metadata?: unknown,
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not available for auth state");

  assertValidSessionId(sessionId);
  const createKey = (key: string) => `${REDIS_KEY_PREFIX}:${sessionId}:${key}`;

  const writeData = (key: string, field: string, data: unknown) =>
    redis.hSet(createKey(key), field, JSON.stringify(data, BufferJSON.replacer));

  const readData = async (key: string, field: string) => {
    const data = await redis.hGet(createKey(key), field);
    return data ? JSON.parse(data, BufferJSON.reviver) : null;
  };

  const creds: AuthenticationCreds = (await readData("authState", "creds")) || initAuthCreds();

  // Store metadata (webhook URL, options, etc.)
  if (metadata) {
    await redis.hSet(
      createKey("authState"),
      "metadata",
      JSON.stringify(encodeMetadataSecrets(metadata)),
    );
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};
          const entries = await Promise.all(
            ids.map(async (id) => {
              const value = await readData("authState", `${type}-${id}`);
              const normalized =
                type === "app-state-sync-key" && value
                  ? proto.Message.AppStateSyncKeyData.fromObject(value)
                  : value;
              return [id, normalized] as const;
            }),
          );
          for (const [id, value] of entries) data[id] = value;
          return data;
        },
        set: async (data) => {
          const multi = redis.multi();
          for (const [category, categoryData] of Object.entries(data) as Array<
            [string, Partial<Record<string, unknown>>]
          >) {
            for (const [id, value] of Object.entries(categoryData ?? {})) {
              const field = `${category}-${id}`;
              if (value) {
                multi.hSet(
                  createKey("authState"),
                  field,
                  JSON.stringify(value, BufferJSON.replacer),
                );
              } else {
                multi.hDel(createKey("authState"), field);
              }
            }
          }
          await multi.execAsPipeline();
        },
        clear: async () => {
          await redis.del(createKey("authState"));
          logger.debug("[Redis Auth] Cleared auth state for session: %s", sessionId);
        },
      },
    },
    saveCreds: async () => {
      await writeData("authState", "creds", creds);
    },
  };
}

/**
 * Get all saved session IDs from Redis with their metadata.
 */
export async function getRedisSavedSessionIds<T>(): Promise<Array<{ id: string; metadata: T }>> {
  const redis = getRedis();
  if (!redis) return [];

  const keys: string[] = [];
  for await (const key of redis.scanIterator({
    MATCH: `${REDIS_KEY_PREFIX}:*:authState`,
    COUNT: 100,
  })) {
    keys.push(String(key));
  }
  const ids = keys.map((key) => key.split(":").at(-2) ?? "").filter(Boolean);

  if (ids.length === 0) return [];

  const multi = redis.multi();
  for (const id of ids) {
    multi.hGet(`${REDIS_KEY_PREFIX}:${id}:authState`, "metadata");
  }
  const metadata = await multi.execAsPipeline();

  return ids.map((id, index) => {
    const raw = metadata[index];
    if (typeof raw !== "string" || !raw) return { id, metadata: null as T };

    try {
      return { id, metadata: decodeMetadataSecrets(JSON.parse(raw) as T) };
    } catch {
      return { id, metadata: null as T };
    }
  });
}

/**
 * Delete Redis auth state for a session.
 */
export async function deleteRedisAuthState(sessionId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(`${REDIS_KEY_PREFIX}:${sessionId}:authState`);
}

export async function updateRedisSessionMetadata(
  sessionId: string,
  metadata: unknown,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hSet(
    `${REDIS_KEY_PREFIX}:${sessionId}:authState`,
    "metadata",
    JSON.stringify(encodeMetadataSecrets(metadata)),
  );
}
