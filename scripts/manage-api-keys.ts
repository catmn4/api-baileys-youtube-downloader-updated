/**
 * API Key Management Script
 *
 * Usage:
 *   bun scripts/manage-api-keys.ts create <role>    # Create a new API key
 *   bun scripts/manage-api-keys.ts list              # List all API keys
 *   bun scripts/manage-api-keys.ts delete <key>      # Delete an API key
 *
 * Requires Redis to be enabled and running.
 */

import { createClient } from "redis";

const REDIS_KEY_PREFIX = "@baileys-wa-api:api-keys";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  password: process.env.REDIS_PASSWORD || undefined,
});

await redis.connect();

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 48; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

const command = process.argv[2];

switch (command) {
  case "create": {
    const role = (process.argv[3] as "user" | "admin") || "user";
    if (!["user", "admin"].includes(role)) {
      console.error("Invalid role. Use 'user' or 'admin'.");
      process.exit(1);
    }
    const apiKey = generateApiKey();
    await redis.set(
      `${REDIS_KEY_PREFIX}:${apiKey}`,
      JSON.stringify({ role, createdAt: new Date().toISOString() }),
    );
    console.log(`\n✅ API key created successfully!`);
    console.log(`   Key:  ${apiKey}`);
    console.log(`   Role: ${role}`);
    console.log(`\n   Use in header: x-api-key: ${apiKey}\n`);
    break;
  }

  case "list": {
    const keys = await redis.keys(`${REDIS_KEY_PREFIX}:*`);
    if (keys.length === 0) {
      console.log("\nNo API keys found.\n");
    } else {
      console.log(`\n📋 API Keys (${keys.length}):\n`);
      for (const key of keys) {
        const apiKey = key.replace(`${REDIS_KEY_PREFIX}:`, "");
        const data = await redis.get(key);
        let parsed: { role?: string; createdAt?: string } = {};
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch {
          console.log(`   ${apiKey}  (unparseable record)`);
          continue;
        }
        console.log(`   ${apiKey}  (role: ${parsed.role}, created: ${parsed.createdAt})`);
      }
      console.log();
    }
    break;
  }

  case "delete": {
    const keyToDelete = process.argv[3];
    if (!keyToDelete) {
      console.error("Please specify the API key to delete.");
      process.exit(1);
    }
    const deleted = await redis.del(`${REDIS_KEY_PREFIX}:${keyToDelete}`);
    if (deleted) {
      console.log(`\n✅ API key deleted: ${keyToDelete}\n`);
    } else {
      console.log(`\n❌ API key not found: ${keyToDelete}\n`);
    }
    break;
  }

  default:
    console.log(`
Usage:
  bun scripts/manage-api-keys.ts create <role>    Create a new API key (role: user|admin)
  bun scripts/manage-api-keys.ts list             List all API keys
  bun scripts/manage-api-keys.ts delete <key>     Delete an API key
    `);
}

await redis.quit();
