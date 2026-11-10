import { createClient, type RedisClientType } from "redis";
import config from "@/config";
import logger from "@/lib/logger";

let redis: RedisClientType | null = null;

export async function initializeRedis(): Promise<RedisClientType | null> {
  if (!config.redis.enabled) {
    logger.info("Redis is disabled, using file-based storage");
    return null;
  }

  try {
    redis = createClient({
      url: config.redis.url,
      password: config.redis.password || undefined,
    });

    redis.on("error", (error) => {
      logger.error("Redis client error: %s", error.message);
    });

    redis.on("connect", async () => {
      await redis?.clientSetName("baileys-wa-api");
      logger.info("Connected to Redis at %s", config.redis.url);
    });

    redis.on("reconnecting", () => {
      logger.warn("Redis client reconnecting...");
    });

    await redis.connect();
    return redis;
  } catch (error) {
    logger.error("Failed to connect to Redis: %s", (error as Error).message);
    logger.warn("Falling back to file-based storage");
    redis = null;
    return null;
  }
}

export function getRedis(): RedisClientType | null {
  return redis;
}

export function isRedisAvailable(): boolean {
  return Boolean(redis?.isOpen);
}

export default { initializeRedis, getRedis, isRedisAvailable };
