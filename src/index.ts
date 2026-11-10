import app from "@/app";
import { assertAuthStateBackendConsistency } from "@/baileys/authState";
import { cleanupOrphanSessionFiles } from "@/baileys/authState/file";
import connectionManager from "@/baileys/connectionManager";
import config from "@/config";
import { hasUsers } from "@/dashboard/auth";
import logger, { deepSanitizeObject } from "@/lib/logger";
import { initializeRedis } from "@/lib/redis";
import { isBun } from "@/lib/runtime";
import { MediaCleanupService } from "@/services/mediaCleanup";
import { errorToString } from "@/utils/validation";

// ── Global Error Handlers ───────────────────────────
process.on("uncaughtException", (error) => {
  logger.error("[UNCAUGHT EXCEPTION] %s", errorToString(error));
});

process.on("unhandledRejection", (reason) => {
  logger.error("[UNHANDLED REJECTION] %s", errorToString(reason as Error));
});

// ── Services ────────────────────────────────────────
const mediaCleanup = new MediaCleanupService();

// ── Start Server ────────────────────────────────────
async function startServer() {
  let hostname: string;
  let port: number;

  if (isBun) {
    // Bun runtime — use native Bun.serve
    const server = Bun.serve({
      port: config.port,
      hostname: config.host,
      idleTimeout: 120,
      fetch: app.fetch,
    });
    hostname = String(server.hostname ?? config.host);
    port = Number(server.port ?? config.port);
  } else {
    // Node.js runtime — use @hono/node-server
    const { serve } = await import("@hono/node-server");
    serve({
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    });
    hostname = config.host;
    port = config.port;
  }

  const runtime = isBun ? "Bun" : "Node.js";
  logger.info(`📖 Swagger docs: http://${hostname}:${port}/docs`);
  logger.info(`🚀 api-Baileys-WA running on http://${hostname}:${port} (${runtime})`);
  logger.info(
    "⚙️ Config:\n%s",
    JSON.stringify(deepSanitizeObject(config, { omitKeys: ["globalToken", "password"] }), null, 2),
  );
}

startServer();

// ── Production Config Validation ────────────────────
if (config.env === "production") {
  if (config.dashboard.jwtMisconfigured) {
    logger.error(
      "❌ DASHBOARD_JWT_SECRET is not set to a secure value! Dashboard auth is DISABLED (fail-closed). Generate one with: openssl rand -base64 48",
    );
  }
  if (config.corsOrigin === "*") {
    logger.warn(
      "⚠️  CORS_ORIGIN is set to '*'. This is fine for a token-based public API (CORS is not auth), but if you serve the dashboard UI to other domains, restrict CORS_ORIGIN to your known dashboard domain(s) (comma-separated).",
    );
  }
  if (!config.auth.globalToken && !config.redis.enabled) {
    logger.warn("⚠️  No authentication configured! Set AUTH_GLOBAL_TOKEN or enable Redis API keys.");
  }

  if (config.webhook.allowGlobalTokenFallback) {
    logger.warn(
      "⚠️  WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK is enabled in production. AUTH_GLOBAL_TOKEN may be sent to webhook receivers when per-session secret is missing.",
    );
  } else {
    logger.info("✅ Webhook global-token fallback is disabled in production (recommended).");
  }
}

if (config.env === "development") {
  logger.warn(
    "⚠️  Development mode is active. API auth middleware may be bypassed for local testing.",
  );
}

if (config.dashboard.enabled) {
  if (!hasUsers()) {
    logger.warn(
      "⚠️  Dashboard setup is not initialized yet. The first registered account will become system admin.",
    );
  }

  if (config.dashboard.registrationEnabled && !config.dashboard.registrationRequireApproval) {
    logger.warn(
      "⚠️  Dashboard registration is enabled without admin approval. Any registrant gets immediate account activation.",
    );
  }
}

// ── Initialize Redis & Reconnect Sessions ───────────
(async () => {
  await initializeRedis();

  // Fail fast when the configured auth backend disagrees with where the
  // sessions actually live: starting "empty" looks like lost WhatsApp logins.
  try {
    await assertAuthStateBackendConsistency();
  } catch (error) {
    logger.error("Auth state backend check failed: %s", errorToString(error));
    process.exit(1);
  }

  if (config.media.cleanupEnabled) {
    mediaCleanup.start();
  }

  // Reap leftovers from interrupted creates/deletes; never touches valid creds.
  const janitor = cleanupOrphanSessionFiles();
  if (janitor.removed.length > 0) {
    logger.info("Cleaned %d orphan session file(s): %o", janitor.removed.length, janitor.removed);
  }
  const janitorTimer = setInterval(
    () => {
      const result = cleanupOrphanSessionFiles();
      if (result.removed.length > 0) {
        logger.info("Cleaned %d orphan session file(s): %o", result.removed.length, result.removed);
      }
    },
    24 * 60 * 60 * 1000,
  );
  janitorTimer.unref?.();

  // Reconnect saved sessions
  await connectionManager.reconnectSavedSessions().catch((error) => {
    logger.error("Failed to reconnect saved sessions: %s", errorToString(error));
  });
})();

// ── Graceful Shutdown ───────────────────────────────
const shutdown = async (signal: string) => {
  logger.info("Received %s, shutting down gracefully...", signal);
  mediaCleanup.stop();
  await connectionManager.shutdown();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
