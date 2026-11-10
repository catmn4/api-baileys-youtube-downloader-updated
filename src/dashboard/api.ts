/**
 * Dashboard-specific API routes — SSE events, webhook config, stats.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { proto, WAPresence } from "@whiskeysockets/baileys";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getSavedSessionsWithMetadata, updateSessionMetadata } from "@/baileys/authState";
import {
  buildWebhookHeaders,
  deliverWebhookOnce,
  resolveWebhookTarget,
} from "@/baileys/connection";
import connectionManager from "@/baileys/connectionManager";
import type { AiAgentConfig, RoutingConfig, SessionMetadata } from "@/baileys/types";
import config from "@/config";
import { dashboardAuthMiddleware, findDashboardUserById } from "@/dashboard/auth";
import eventBus, { type DashboardEvent } from "@/dashboard/eventBus";
import logger from "@/lib/logger";
import { error } from "@/lib/response";
import { isBun } from "@/lib/runtime";
import {
  encryptionConfigured,
  encryptSecret,
  isEncrypted,
  maskSecret,
  redactCredentials,
} from "@/lib/secretBox";
import { isValidSessionId } from "@/lib/sessionId";
import { activeWebhookSecrets } from "@/lib/webhookSecrets";
import { aiConfigPatchSchema, createSessionSchema } from "@/schemas/session";
import {
  parseEndpointCredentials,
  readStoredCredentials,
  serializeCredentials,
} from "@/services/aiAgent";
import { getAiMetrics, resetAiMetrics } from "@/services/aiMetrics";
import { listApiCalls } from "@/services/apiAuditLog";
import { createApiKey, listApiKeys, revokeApiKey } from "@/services/apiKeys";
import { normalizeAutoReplyConfig } from "@/services/autoReply";
import {
  clearDeadLetters,
  type DeadLetterEntry,
  getDeadLetters,
  replayDeadLetter,
} from "@/services/webhookDeadLetter";
import { addWebhookLog, clearWebhookLogs, getWebhookLogs } from "@/services/webhookLog";

const dashboardApi = new Hono();

type DashboardRole = "admin" | "manager" | "assistant";
type DashboardUserPayload = {
  sub: string;
  username: string;
  role: DashboardRole;
  exp: number;
  scope?: "stream";
};
type DashboardCapability =
  | "manageSessions"
  | "createSessions"
  | "deleteSessions"
  | "reconnectSessions"
  | "manageWebhooks"
  | "manageApiKeys"
  | "viewSettings"
  | "viewEvents"
  | "viewSessions"
  | "viewGroups"
  | "viewChats"
  | "sendOutbound"
  | "replyIncoming"
  | "manageGroups"
  | "manageEvents";

const ROLE_CAPABILITIES: Record<DashboardRole, Set<DashboardCapability>> = {
  admin: new Set([
    "manageSessions",
    "createSessions",
    "deleteSessions",
    "reconnectSessions",
    "manageWebhooks",
    "manageApiKeys",
    "viewSettings",
    "viewEvents",
    "viewSessions",
    "viewChats",
    "sendOutbound",
    "replyIncoming",
    "manageGroups",
    "viewGroups",
    "manageEvents",
  ]),
  manager: new Set([
    "manageSessions",
    "reconnectSessions",
    "manageWebhooks",
    "manageApiKeys",
    "viewSettings",
    "viewEvents",
    "viewSessions",
    "viewChats",
    "sendOutbound",
    "replyIncoming",
    "manageGroups",
    "viewGroups",
  ]),
  assistant: new Set([
    "viewSessions",
    "viewChats",
    "replyIncoming",
    "sendOutbound",
    "viewGroups",
    "viewSettings",
  ]),
};

function getDashboardUserPayload(c: Context): DashboardUserPayload {
  return c.get("dashboardUser") as DashboardUserPayload;
}

function getDashboardRole(c: Context): DashboardRole {
  const userPayload = c.get("dashboardUser") as DashboardUserPayload;
  const role = userPayload?.role;
  if (role === "admin" || role === "manager" || role === "assistant") return role;
  return "assistant";
}

function isAdminUser(c: Context): boolean {
  return getDashboardRole(c) === "admin";
}

function requireCapability(c: Context, capability: DashboardCapability) {
  const role = getDashboardRole(c);
  if (ROLE_CAPABILITIES[role].has(capability)) return null;
  return c.json({ success: false, message: "Forbidden: insufficient permissions" }, 403);
}

function normalizeChatJid(value: unknown): string {
  return String(value || "").replace(/:\d+(?=@)/, "");
}

function hasSessionAccess(c: Context, sessionId: string): boolean {
  const role = getDashboardRole(c);
  if (role === "admin") return true;

  const userPayload = c.get("dashboardUser") as DashboardUserPayload;
  const user = findDashboardUserById(String(userPayload?.sub || ""));

  // Managers may be granted every session explicitly; otherwise they follow the
  // same assignment list as assistants.
  if (role === "manager" && user?.allSessions === true) return true;

  return (user?.assignedSessions || []).includes(sessionId);
}

function requireSessionAccess(c: Context, sessionId: string) {
  if (!isValidSessionId(sessionId)) {
    return c.json({ success: false, message: "Invalid session id" }, 400);
  }

  if (hasSessionAccess(c, sessionId)) return null;
  return c.json(
    { success: false, message: "Forbidden: session is not assigned to your account" },
    403,
  );
}

// Cache package.json at module load
const pkgPath = path.join(process.cwd(), "package.json");
let cachedPkg: Record<string, unknown>;
try {
  cachedPkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
} catch {
  cachedPkg = { name: "Baileys WA API", version: "1.0.0" };
}

dashboardApi.use("*", dashboardAuthMiddleware);

/**
 * GET /dashboard/api/about
 * Project metadata context.
 */
dashboardApi.get("/about", (c) => {
  const isAdmin = isAdminUser(c);
  try {
    const pkg = cachedPkg;
    return c.json({
      success: true,
      data: {
        project: `${pkg.name || "Baileys WA API"}`,
        version: `v${pkg.version || "1.0.0"}`,
        ...(isAdmin
          ? {
              author: `${pkg.author || "KoiN CoDeveloper"}`,
              engine: `Baileys ${
                typeof pkg.dependencies === "object" && pkg.dependencies !== null
                  ? String(
                      (pkg.dependencies as Record<string, unknown>)["@whiskeysockets/baileys"] ||
                        "",
                    ).replace(/[\^~]/, "")
                  : ""
              }`,
              runtime: isBun ? "Bun + Hono" : "Node.js + Hono",
            }
          : {
              infoRestricted: true,
            }),
      },
    });
  } catch (_err) {
    return c.json({
      success: false,
      data: {
        project: "Baileys WA API",
        version: "Unknown",
        author: "KoiN CoDeveloper",
        engine: "Baileys",
        runtime: isBun ? "Bun" : "Node.js",
      },
    });
  }
});

/**
 * GET /dashboard/api/stats
 * Overview statistics.
 */
dashboardApi.get("/stats", (c) => {
  const isAdmin = isAdminUser(c);
  const pkg = cachedPkg;
  const sessions = connectionManager
    .listSessions()
    .filter((session) => hasSessionAccess(c, String(session.sessionId || "")));
  return c.json({
    success: true,
    data: {
      totalSessions: sessions.length,
      connectedSessions: sessions.filter((s) => s.connected).length,
      disconnectedSessions: sessions.filter((s) => !s.connected).length,
      version: `v${pkg.version || "1.0.0"}`,
      // Operational uptime is safe for every dashboard role; memory/env/Redis
      // details below remain admin-only.
      uptime: process.uptime(),
      ...(isAdmin
        ? {
            memoryUsage: process.memoryUsage(),
            environment: config.env,
            redisEnabled: config.redis.enabled,
          }
        : {
            infoRestricted: true,
          }),
    },
  });
});

/**
 * GET /dashboard/api/sessions
 * List all sessions with detailed status.
 */
dashboardApi.get("/sessions", (c) => {
  const denied = requireCapability(c, "viewSessions");
  if (denied) return denied;
  const sessions = connectionManager
    .listSessions()
    .filter((session) => hasSessionAccess(c, String(session.sessionId || "")));
  return c.json({ success: true, data: sessions });
});

/**
 * POST /dashboard/api/sessions/:sessionId
 * Create a new session.
 */
dashboardApi.post("/sessions/:sessionId", async (c) => {
  const denied = requireCapability(c, "createSessions");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  const userPayload = getDashboardUserPayload(c);
  const ownerId = String(userPayload?.sub || "");
  const role = getDashboardRole(c);
  if (role !== "admin") {
    const limit = role === "manager" ? config.maxSessionsPerManager : config.maxSessionsPerUser;
    if (limit > 0) {
      const owned = connectionManager
        .listSessions()
        .filter((session) => session.ownerId === ownerId).length;
      if (owned >= limit) {
        return c.json(
          {
            success: false,
            message: `Session limit reached: ${limit} for role ${role}. Delete an unused session or ask an admin to raise the limit.`,
          },
          403,
        );
      }
    }
  }

  const body = await c.req.json().catch(() => ({}));

  try {
    if (body.freshAuth === true) {
      // Force-create with new auth state when requested from dashboard.
      await connectionManager.deleteSession(sessionId);
    }

    const result = await connectionManager.createSession(sessionId, {
      ownerId,
      clientName: body.clientName,
      webhookUrl: body.webhookUrl,
      webhookSecret: body.webhookSecret,
      usePairingCode: body.usePairingCode ?? false,
      phoneNumber: body.phoneNumber,
      includeMedia: body.includeMedia,
      syncFullHistory: body.syncFullHistory ?? false,
      autoReply: normalizeAutoReplyConfig(body.autoReply),
    });

    return c.json({
      success: true,
      message: result.pairingCode ? "Pairing code generated" : "Session created — scan QR code",
      data: result,
    });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * GET /dashboard/api/sessions/:sessionId
 * Get session status.
 */
dashboardApi.get("/sessions/:sessionId", (c) => {
  const denied = requireCapability(c, "viewSessions");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;
  const status = connectionManager.getSessionStatus(sessionId);
  return c.json({ success: true, data: status });
});

/**
 * POST /dashboard/api/sessions/:sessionId/reconnect
 * Reconnect an assigned session using its saved auth state. Never deletes or
 * recreates credentials; managers use this instead of the create endpoint.
 */
dashboardApi.post("/sessions/:sessionId/reconnect", async (c) => {
  const denied = requireCapability(c, "reconnectSessions");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  try {
    const result = await connectionManager.reconnectSession(sessionId);
    return c.json({
      success: true,
      message: result.pairingCode
        ? "Pairing code generated"
        : "Session reconnecting — scan the QR code if requested",
      data: result,
    });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * DELETE /dashboard/api/sessions/:sessionId
 * Delete a session.
 */
dashboardApi.delete("/sessions/:sessionId", async (c) => {
  const denied = requireCapability(c, "deleteSessions");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;
  try {
    await connectionManager.deleteSession(sessionId);
    return c.json({ success: true, message: "Session deleted" });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * PATCH /dashboard/api/sessions/:sessionId/settings
 * Session settings modal (client name, webhook URL, auto-reply). Managers may
 * change assigned sessions; blank secret keeps the stored one. Works for
 * disconnected sessions too by updating persisted metadata.
 */
dashboardApi.patch("/sessions/:sessionId/settings", async (c) => {
  const denied = requireCapability(c, "manageSessions");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  const parsed = createSessionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const body = parsed.data ?? {};

  try {
    const live = connectionManager.hasSession(sessionId)
      ? connectionManager.getSession(sessionId)
      : null;
    const saved = live
      ? null
      : (await getSavedSessionsWithMetadata<SessionMetadata>()).find(
          (entry) => entry.id === sessionId,
        )?.metadata;
    const current: SessionMetadata | null = live?.getOptions() ?? saved ?? null;
    if (!current) return error(c, "Session not found", 404);

    const next: SessionMetadata = {
      ...current,
      clientName: body.clientName ?? current.clientName,
      webhookUrl: body.webhookUrl === undefined ? current.webhookUrl : body.webhookUrl || undefined,
      webhookSecret: body.webhookSecret?.trim() || current.webhookSecret,
      includeMedia: body.includeMedia ?? current.includeMedia,
      syncFullHistory: body.syncFullHistory ?? current.syncFullHistory,
      autoReply: body.autoReply ? normalizeAutoReplyConfig(body.autoReply) : current.autoReply,
    };

    if (live) await connectionManager.updateSessionSettings(sessionId, next);
    else await updateSessionMetadata(sessionId, next);
    return c.json({ success: true, message: "Session settings updated" });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * PUT /dashboard/api/sessions/:sessionId/webhook
 * Update webhook config for a session.
 */
dashboardApi.put("/sessions/:sessionId/webhook", async (c) => {
  const denied = requireCapability(c, "manageWebhooks");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  const body = await c.req.json().catch(() => ({}));
  const webhookUrl = String(body.webhookUrl || "").trim();
  // Use undefined (not empty string) when secret is blank so sendToWebhook
  // falls back to AUTH_GLOBAL_TOKEN.
  const rawSecret = String(body.webhookSecret ?? "").trim();
  const clearSecret = body.clearWebhookSecret === true;
  const events = Array.isArray(body.events)
    ? body.events.map((e: unknown) => String(e).trim()).filter(Boolean)
    : [];

  try {
    const session = connectionManager.getSession(sessionId);
    // Blank means "keep the stored secret": clients only receive a masked
    // value, so re-saving the form must not wipe it. Clear explicitly instead.
    const nextSecret = clearSecret ? undefined : rawSecret || session.getOptions().webhookSecret;
    const nextMetadata = {
      ...session.getSessionMetadata(),
      webhookUrl,
      webhookSecret: nextSecret,
      webhookEvents: events,
    };

    session.updateOptions({ webhookUrl, webhookSecret: nextSecret, webhookEvents: events });
    await updateSessionMetadata(sessionId, nextMetadata);

    return c.json({ success: true, message: "Webhook config updated" });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * POST /dashboard/api/sessions/:sessionId/webhook/rotate
 *
 * Generate a new webhook secret and show it once. By default the previous
 * secret stays PRIMARY for WEBHOOK_SECRET_GRACE_MS (24 h), so existing
 * receivers keep working while they are updated; the new secret is offered in
 * the -new headers. Nothing rotates or expires unless this endpoint is called.
 * Pass graceMs: 0 to invalidate the old secret immediately (e.g. after a leak).
 */
dashboardApi.post("/sessions/:sessionId/webhook/rotate", async (c) => {
  const denied = requireCapability(c, "manageWebhooks");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  try {
    const body = await c.req.json().catch(() => ({}));
    const requestedGrace = Number(body.graceMs ?? config.webhook.secretGraceMs);
    const graceMs = Number.isFinite(requestedGrace)
      ? Math.min(Math.max(requestedGrace, 0), 7 * 24 * 60 * 60 * 1000)
      : config.webhook.secretGraceMs;

    const session = connectionManager.getSession(sessionId);
    const currentSecret = session.getOptions().webhookSecret || "";
    const webhookSecret = randomBytes(32).toString("base64url");
    const previousValidUntil = currentSecret && graceMs > 0 ? Date.now() + graceMs : undefined;

    session.updateOptions({
      webhookSecret,
      webhookSecretPrevious: previousValidUntil ? currentSecret : undefined,
      webhookSecretPreviousExpiresAt: previousValidUntil,
    });
    await updateSessionMetadata(sessionId, session.getSessionMetadata());
    c.header("Cache-Control", "no-store");
    return c.json({
      success: true,
      message:
        previousValidUntil === undefined
          ? "Webhook secret rotated — the old secret is no longer valid"
          : "Webhook secret rotated — the old secret remains valid during the grace window",
      data: {
        webhookSecret,
        graceMs,
        previousValidUntil: previousValidUntil ?? null,
      },
    });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * GET /dashboard/api/sessions/:sessionId/ai-config
 *
 * Effective routing + AI settings for one number (session values merged over
 * the global env defaults). Credentials are never returned: the response only
 * tells whether they are stored and whether they are encrypted.
 */
dashboardApi.get("/sessions/:sessionId/ai-config", (c) => {
  const denied = requireCapability(c, "manageSessions");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  try {
    const options = connectionManager.getSession(sessionId).getOptions();
    const ai = options.ai ?? {};
    const stored = readStoredCredentials(ai.credentials);
    const endpointCredentials = stored.endpoints ?? {};
    return c.json({
      success: true,
      data: {
        routing: { ...config.routing, ...(options.routing ?? {}) },
        ai: {
          enabled: ai.enabled ?? false,
          mode: ai.mode ?? config.ai.mode,
          baseUrl: ai.baseUrl || config.ai.baseUrl,
          model: ai.model || config.ai.model,
          agentUrl: ai.agentUrl || config.ai.agentUrl,
          systemInstruction: ai.systemInstruction || "",
          ragEndpoints: ai.ragEndpoints ?? [],
          temperature: ai.temperature ?? config.ai.temperature,
          topP: ai.topP ?? config.ai.topP,
          minP: ai.minP ?? config.ai.minP,
          frequencyPenalty: ai.frequencyPenalty ?? config.ai.frequencyPenalty,
          presencePenalty: ai.presencePenalty ?? config.ai.presencePenalty,
          maxTokens: ai.maxTokens ?? config.ai.maxTokens,
          apiKeySet: Boolean(stored.apiKey),
          apiKeyHint: stored.apiKey ? maskSecret(stored.apiKey) : "",
          credentialsSet: Object.keys(endpointCredentials).length > 0,
          credentialsEncrypted: isEncrypted(ai.credentials),
          sendMessage: {
            enabled: ai.sendMessage?.enabled ?? false,
            scope: ai.sendMessage?.scope === "any" ? "any" : "allowlist",
            allowlist: ai.sendMessage?.allowlist ?? [],
            maxPerHour: ai.sendMessage?.maxPerHour ?? 10,
          },
          vision: {
            enabled: ai.vision?.enabled ?? false,
            model: ai.vision?.model ?? "",
          },
          otpFilter: {
            enabled: ai.otpFilter?.enabled ?? false,
            ignoredSenders: ai.otpFilter?.ignoredSenders ?? [],
            detectionMode:
              ai.otpFilter?.detectionMode ??
              (ai.otpFilter?.smart ? "smart" : ai.otpFilter?.keywordFilter ? "keywords" : "smart"),
            keywordFilter: ai.otpFilter?.keywordFilter ?? false,
            smart: ai.otpFilter?.smart ?? false,
            sensitivity: ai.otpFilter?.sensitivity ?? "balanced",
            keywords: ai.otpFilter?.keywords ?? [],
            excludeKeywords: ai.otpFilter?.excludeKeywords ?? [],
          },
        },
        defaults: {
          routing: config.routing,
          baseUrl: config.ai.baseUrl,
          agentUrl: config.ai.agentUrl,
        },
      },
    });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 404);
  }
});

/**
 * PATCH /dashboard/api/sessions/:sessionId/ai-config
 *
 * Update routing overrides and AI settings for one number. Credentials
 * (`ai.credentialsJson`, plaintext on the wire) are encrypted before they are
 * persisted and are never echoed back.
 */
dashboardApi.patch("/sessions/:sessionId/ai-config", async (c) => {
  const denied = requireCapability(c, "manageSessions");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  const parsed = aiConfigPatchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join(".") : "payload";
    return c.json(
      {
        success: false,
        message: issue ? `${where}: ${issue.message}` : "Invalid payload",
        issues: parsed.error.issues.slice(0, 10).map((entry) => ({
          path: entry.path.join("."),
          message: entry.message,
        })),
      },
      400,
    );
  }

  try {
    const session = connectionManager.getSession(sessionId);
    const current = session.getOptions();

    const routing: RoutingConfig = { ...(current.routing ?? {}), ...(parsed.data.routing ?? {}) };
    const {
      credentialsJson,
      apiKey,
      sendMessage: sendMessagePatch,
      vision: visionPatch,
      otpFilter: otpFilterPatch,
      ...aiFields
    } = parsed.data.ai ?? {};
    const ai: AiAgentConfig = { ...(current.ai ?? {}), ...aiFields };
    if (sendMessagePatch) {
      // Nested merge: a partial patch must not drop scope/allowlist/maxPerHour.
      ai.sendMessage = { ...(current.ai?.sendMessage ?? {}), ...sendMessagePatch };
    }
    if (visionPatch) {
      ai.vision = { ...(current.ai?.vision ?? {}), ...visionPatch };
    }
    if (otpFilterPatch) {
      ai.otpFilter = { ...(current.ai?.otpFilter ?? {}), ...otpFilterPatch };
    }

    if (credentialsJson !== undefined || apiKey !== undefined) {
      const stored = readStoredCredentials(current.ai?.credentials);
      let endpoints = stored.endpoints ?? {};
      if (credentialsJson !== undefined) {
        const parsedEndpoints = parseEndpointCredentials(credentialsJson);
        if (parsedEndpoints === null) {
          return c.json(
            { success: false, message: "Endpoint credentials must be a JSON object" },
            400,
          );
        }
        endpoints = parsedEndpoints;
      }
      const nextKey = apiKey !== undefined ? apiKey.trim() : (stored.apiKey ?? "");
      const encrypted = encryptSecret(serializeCredentials(nextKey, endpoints));
      if (encrypted) {
        ai.credentials = encrypted;
        if (!encryptionConfigured()) {
          logger.warn(
            "[Dashboard] CONFIG_ENC_KEY is not set — AI credentials for %s are stored unencrypted",
            sessionId,
          );
        }
      } else {
        delete ai.credentials;
      }
    }

    session.updateOptions({ routing, ai });
    await updateSessionMetadata(sessionId, { ...session.getSessionMetadata(), routing, ai });

    // Never log raw credentials — redactCredentials strips them by key name.
    logger.info(
      "[Dashboard] AI config updated for %s: %s",
      sessionId,
      JSON.stringify(redactCredentials({ routing, ai })),
    );

    const saved = readStoredCredentials(ai.credentials);
    return c.json({
      success: true,
      message: "AI configuration updated",
      data: {
        routing,
        ai: {
          enabled: ai.enabled ?? false,
          mode: ai.mode ?? config.ai.mode,
          baseUrl: ai.baseUrl || config.ai.baseUrl,
          model: ai.model || config.ai.model,
          agentUrl: ai.agentUrl || "",
          systemInstruction: ai.systemInstruction || "",
          ragEndpoints: ai.ragEndpoints ?? [],
          temperature: ai.temperature ?? config.ai.temperature,
          topP: ai.topP ?? config.ai.topP,
          minP: ai.minP ?? config.ai.minP,
          frequencyPenalty: ai.frequencyPenalty ?? config.ai.frequencyPenalty,
          presencePenalty: ai.presencePenalty ?? config.ai.presencePenalty,
          maxTokens: ai.maxTokens ?? config.ai.maxTokens,
          apiKeySet: Boolean(saved.apiKey),
          credentialsSet: Object.keys(saved.endpoints ?? {}).length > 0,
          credentialsEncrypted: isEncrypted(ai.credentials),
        },
      },
    });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * GET /dashboard/api/ai/metrics
 *
 * In-memory routing metrics: AI vs human vs static, hourly buckets, latency,
 * token usage and the most recent decisions. No database: counters live in
 * this process and reset on restart.
 */
dashboardApi.get("/ai/metrics", (c) => {
  const denied = requireCapability(c, "manageSessions");
  if (denied) return denied;
  const sessionId = c.req.query("sessionId") || undefined;
  if (sessionId) {
    const sessionDenied = requireSessionAccess(c, sessionId);
    if (sessionDenied) return sessionDenied;
  } else if (getDashboardRole(c) !== "admin") {
    return c.json({ success: false, message: "sessionId is required for non-admin users" }, 403);
  }
  return c.json({ success: true, data: getAiMetrics(sessionId) });
});

/** POST /dashboard/api/ai/metrics/reset — clear all AI routing counters. */
dashboardApi.post("/ai/metrics/reset", (c) => {
  if (!isAdminUser(c)) return c.json({ success: false, message: "Forbidden: admin only" }, 403);
  resetAiMetrics();
  return c.json({ success: true, message: "AI metrics reset" });
});

/**
 * POST /dashboard/api/sessions/:sessionId/webhook/test
 * Send a test ping to target webhook URL.
 */
dashboardApi.post("/sessions/:sessionId/webhook/test", async (c) => {
  const denied = requireCapability(c, "manageWebhooks");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  const body = await c.req.json().catch(() => ({}));

  try {
    const session = connectionManager.getSession(sessionId);
    const options = session.getOptions();
    const configuredUrl = options.webhookUrl || "";
    const activeSecrets = activeWebhookSecrets(options);
    const configuredSecret = activeSecrets.primary || config.auth.globalToken || "";
    const webhookUrl = String(body.webhookUrl || configuredUrl).trim();
    const bodySecret = String(body.webhookSecret || "").trim();
    const webhookSecret = bodySecret || configuredSecret;
    const secondarySecret = bodySecret ? undefined : activeSecrets.secondary;

    if (!webhookUrl) {
      return c.json({ success: false, message: "Webhook URL is empty" }, 400);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch {
      return c.json(
        {
          success: false,
          message: "Webhook URL is invalid. Use a full URL such as http://127.0.0.1:3001/webhook",
        },
        400,
      );
    }

    // SSRF guard (same DNS-aware policy as live webhook delivery).
    const targetError = await resolveWebhookTarget(webhookUrl);
    if (targetError) {
      return c.json({ success: false, message: targetError }, 400);
    }

    const payload = {
      type: "dashboard.webhook.test",
      sessionId,
      timestamp: Date.now(),
      connected: session.isConnected,
      user: session.user,
      source: "dashboard",
    };

    const startedAt = Date.now();
    try {
      const rawBody = JSON.stringify(payload);
      const { headers, error: headerError } = buildWebhookHeaders(
        webhookSecret,
        rawBody,
        secondarySecret,
      );
      if (headerError) {
        return c.json(
          {
            success: false,
            message:
              "Webhook signature mode is required, but no secret is available (session secret or AUTH_GLOBAL_TOKEN)",
          },
          400,
        );
      }

      // pi-lens-ignore: ts-ssrf -- validateWebhookTarget() above checked scheme and the optional internal-host block; the URL is operator-configured
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: rawBody,
        redirect: "manual",
        signal: AbortSignal.timeout(15000), // 15s timeout for test
      });

      if (response.status >= 300 && response.status < 400) {
        return c.json(
          {
            success: false,
            message: `Receiver returned HTTP ${response.status} redirect (not followed)`,
          },
          400,
        );
      }

      if (!response.ok) {
        const latencyMs = Date.now() - startedAt;
        addWebhookLog({
          sessionId,
          event: "dashboard.webhook.test",
          webhookUrl,
          status: "test-fail",
          attempt: 1,
          httpStatus: response.status,
          latencyMs,
          error: `HTTP ${response.status}`,
        });
        return c.json(
          {
            success: false,
            message: `Webhook test failed: HTTP ${response.status} from ${parsedUrl.origin}${parsedUrl.pathname}`,
          },
          502,
        );
      }

      const latencyMs = Date.now() - startedAt;
      addWebhookLog({
        sessionId,
        event: "dashboard.webhook.test",
        webhookUrl,
        status: "test-success",
        attempt: 1,
        httpStatus: response.status,
        latencyMs,
      });

      return c.json({
        success: true,
        message: "Webhook test succeeded",
        data: { status: response.status },
      });
    } catch (err) {
      const errMessage = (err as Error).message;
      const looksLikeTlsCertIssue = /certificate|tls|ssl/i.test(errMessage);
      const looksLikeSocketClosed =
        /socket connection was closed unexpectedly|socket.*closed/i.test(errMessage);

      const hints: string[] = [];
      if (looksLikeTlsCertIssue) {
        hints.push(
          "TLS certificate issue detected. Use a valid certificate chain or HTTP on trusted local network.",
        );
      }
      if (looksLikeSocketClosed) {
        hints.push(
          "Target endpoint closed the connection. Check protocol mismatch (http vs https), server listener, and reverse-proxy upstream settings.",
        );
      }
      if (
        parsedUrl.protocol === "https:" &&
        (parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost")
      ) {
        hints.push(
          "For local testing, verify your local server actually serves HTTPS. If not, switch URL to http://...",
        );
      }

      const latencyMs = Date.now() - startedAt;
      const hintText = hints.length ? ` ${hints.join(" ")}` : "";

      addWebhookLog({
        sessionId,
        event: "dashboard.webhook.test",
        webhookUrl,
        status: "test-fail",
        attempt: 1,
        latencyMs,
        error: errMessage,
      });
      return c.json(
        {
          success: false,
          message:
            `Webhook test failed: ${errMessage}. Target: ${parsedUrl.origin}${parsedUrl.pathname}.${hintText}`.trim(),
        },
        502,
      );
    }
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * GET /dashboard/api/webhooks/logs
 * Read webhook delivery logs.
 */
dashboardApi.get("/webhooks/logs", (c) => {
  const denied = requireCapability(c, "manageWebhooks");
  if (denied) return denied;
  const limit = Number(c.req.query("limit") || "100");
  const sessionId = c.req.query("sessionId") || undefined;
  if (sessionId && !hasSessionAccess(c, sessionId)) {
    return c.json(
      { success: false, message: "Forbidden: session is not assigned to your account" },
      403,
    );
  }
  const logs = getWebhookLogs(limit, sessionId);
  if (getDashboardRole(c) === "admin") return c.json({ success: true, data: logs });
  return c.json({
    success: true,
    data: logs.filter((entry) => hasSessionAccess(c, entry.sessionId)),
  });
});

/**
 * GET /dashboard/api/webhooks/meta
 * Read-only webhook delivery metadata for admin UI.
 */
dashboardApi.get("/webhooks/meta", (c) => {
  const denied = requireCapability(c, "manageWebhooks");
  if (denied) return denied;

  return c.json({
    success: true,
    data: {
      signatureMode: config.webhook.signatureMode,
      authFallback: ["session webhook secret", "AUTH_GLOBAL_TOKEN"],
    },
  });
});

/**
 * POST /dashboard/api/webhooks/logs/clear
 * Clear webhook delivery logs.
 */
dashboardApi.post("/webhooks/logs/clear", (c) => {
  if (!isAdminUser(c)) return c.json({ success: false, message: "Forbidden: admin only" }, 403);
  clearWebhookLogs();
  return c.json({ success: true, message: "Webhook logs cleared" });
});

/** Resolve the secret pair currently valid for a dead-letter replay. */
function deadLetterSecrets(entry: { sessionId: string; webhookSecret?: string }): {
  primary: string;
  secondary?: string;
} {
  try {
    const active = activeWebhookSecrets(connectionManager.getSession(entry.sessionId).getOptions());
    return { primary: active.primary || entry.webhookSecret || "", secondary: active.secondary };
  } catch {
    return { primary: entry.webhookSecret || "" };
  }
}

/**
 * GET /dashboard/api/webhooks/dead-letter
 * Read dead-letter entries (webhooks that exhausted all retries).
 */
dashboardApi.get("/webhooks/dead-letter", (c) => {
  const denied = requireCapability(c, "manageWebhooks");
  if (denied) return denied;
  const limit = Number(c.req.query("limit") || "50");
  const sessionId = c.req.query("sessionId") || undefined;
  if (sessionId && !hasSessionAccess(c, sessionId)) {
    return c.json(
      { success: false, message: "Forbidden: session is not assigned to your account" },
      403,
    );
  }
  // Replay reads the secret internally; never expose it through the API.
  const entries = getDeadLetters(limit, sessionId)
    .filter(
      (entry) =>
        getDashboardRole(c) === "admin" || hasSessionAccess(c, String(entry.sessionId || "")),
    )
    .map(({ webhookSecret, ...entry }) => ({
      ...entry,
      hasWebhookSecret: Boolean(webhookSecret),
    }));
  return c.json({ success: true, data: entries });
});

/**
 * POST /dashboard/api/webhooks/dead-letter/:id/retry
 * Replay a single dead-letter delivery.
 */
dashboardApi.post("/webhooks/dead-letter/:id/retry", async (c) => {
  const denied = requireCapability(c, "manageWebhooks");
  if (denied) return denied;
  const id = c.req.param("id");
  const entry = getDeadLetters(500).find((item) => item.id === id);
  if (!entry) return c.json({ success: false, message: "Dead-letter entry not found" }, 404);
  if (getDashboardRole(c) !== "admin" && !hasSessionAccess(c, entry.sessionId)) {
    return c.json(
      { success: false, message: "Forbidden: session is not assigned to your account" },
      403,
    );
  }
  const deliver = async (entry: DeadLetterEntry) => {
    const secrets = deadLetterSecrets(entry);
    const res = await deliverWebhookOnce(
      entry.webhookUrl,
      entry.payload,
      secrets.primary,
      15000,
      secrets.secondary,
    );
    return res.ok ? "success" : "failed";
  };
  const result = await replayDeadLetter(id, deliver);
  if (result === "not-found") {
    return c.json({ success: false, message: "Dead-letter entry not found" }, 404);
  }
  return c.json({
    success: result === "success",
    message: result === "success" ? "Dead-letter replayed successfully" : "Replay failed",
  });
});

/**
 * POST /dashboard/api/webhooks/dead-letter/retry-all
 * Replay all queued dead-letters (best-effort).
 */
dashboardApi.post("/webhooks/dead-letter/retry-all", async (c) => {
  const denied = requireCapability(c, "manageWebhooks");
  if (denied) return denied;
  const entries = getDeadLetters(500).filter(
    (entry) => getDashboardRole(c) === "admin" || hasSessionAccess(c, entry.sessionId),
  );
  let replayed = 0;
  let succeeded = 0;
  for (const entry of entries) {
    const secrets = deadLetterSecrets(entry);
    const res = await deliverWebhookOnce(
      entry.webhookUrl,
      entry.payload,
      secrets.primary,
      15000,
      secrets.secondary,
    );
    replayed += 1;
    if (res.ok) succeeded += 1;
  }
  return c.json({
    success: true,
    data: { replayed, succeeded },
    message: `Replayed ${succeeded}/${replayed} dead-letter entries`,
  });
});

/**
 * POST /dashboard/api/webhooks/dead-letter/clear
 * Clear the dead-letter buffer.
 */
dashboardApi.post("/webhooks/dead-letter/clear", (c) => {
  if (!isAdminUser(c)) return c.json({ success: false, message: "Forbidden: admin only" }, 403);
  clearDeadLetters();
  return c.json({ success: true, message: "Dead-letter buffer cleared" });
});

/**
 * POST /dashboard/api/sessions/:sessionId/send
 * Send a message from dashboard.
 */
dashboardApi.post("/sessions/:sessionId/send", async (c) => {
  const denied = requireCapability(c, "sendOutbound");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;
  const body = await c.req.json();
  const { receiver, message, isGroup } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const { formatPhone, formatGroup } = await import("@/utils/phone");
    const jid = isGroup ? formatGroup(receiver) : formatPhone(receiver);
    const result = await session.sendMessage(jid, message);
    return c.json({
      success: true,
      message: "Message sent",
      data: { key: result?.key },
    });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * GET /dashboard/api/sessions/:sessionId/chats
 * Get chat list from store (default: 1-on-1 only).
 */
dashboardApi.get("/sessions/:sessionId/chats", async (c) => {
  const denied = requireCapability(c, "viewChats");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;
  const isGroup = c.req.query("isGroup") === "true";

  try {
    const session = connectionManager.getSession(sessionId);
    await session.reconcileLidRooms();
    const self = session.user as { id?: string; lid?: string } | null;
    const selfIds = new Set(
      [self?.id, self?.lid].filter(Boolean).map((value) => normalizeChatJid(value)),
    );
    const chats = session
      .getStore()
      .getChatList(isGroup)
      .filter((chat) => !selfIds.has(normalizeChatJid(chat.id)));
    return c.json({ success: true, data: chats });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * GET /dashboard/api/sessions/:sessionId/chats/:jid/messages
 * Get messages from specific chat conversation.
 */
dashboardApi.get("/sessions/:sessionId/chats/:jid/messages", (c) => {
  const denied = requireCapability(c, "viewChats");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;
  const encodedJid = c.req.param("jid");
  const jid = decodeURIComponent(encodedJid);
  const limit = Math.min(Math.max(Number(c.req.query("limit") || "50"), 1), 500);

  try {
    const session = connectionManager.getSession(sessionId);
    const messages = session.getStore().loadMessages(jid, limit);
    return c.json({ success: true, data: messages });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * POST /dashboard/api/sessions/:sessionId/chats/send-text
 * Send a text message to 1-on-1 chat.
 */
dashboardApi.post("/sessions/:sessionId/chats/send-text", async (c) => {
  const denied = requireCapability(c, "replyIncoming");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;
  const role = getDashboardRole(c);
  const body = await c.req.json().catch(() => ({}));
  const receiver = String(body.receiver || "").trim();
  const text = String(body.text || "").trim();
  const isGroup = body.isGroup === true;
  const mentions = Array.isArray(body.mentions)
    ? body.mentions.filter((m: unknown) => typeof m === "string")
    : [];

  if (!receiver) {
    return c.json({ success: false, message: "Receiver is required" }, 400);
  }
  if (!text) {
    return c.json({ success: false, message: "Text message is required" }, 400);
  }

  try {
    const session = connectionManager.getSession(sessionId);
    const { formatPhone, formatGroup } = await import("@/utils/phone");
    const jid = receiver.includes("@")
      ? receiver
      : isGroup
        ? formatGroup(receiver)
        : formatPhone(receiver);

    if (role === "assistant") {
      if (isGroup) {
        return c.json(
          {
            success: false,
            message: "Forbidden: assistant role is limited to reply-only 1-on-1 chats",
          },
          403,
        );
      }

      const recentMessages = session.getStore().loadMessages(jid, 50);
      const hasInboundContext = recentMessages.some((message) => !message.key.fromMe);
      if (!hasInboundContext) {
        return c.json(
          {
            success: false,
            message: "Forbidden: assistant role may only reply to an existing inbound conversation",
          },
          403,
        );
      }
    }

    const result = await session.sendMessage(
      jid,
      {
        text,
        mentions: mentions.length > 0 ? mentions : undefined,
      },
      {
        simulateTyping: false,
      },
    );
    return c.json({
      success: true,
      message: "Message sent",
      data: { key: result?.key, messageTimestamp: result?.messageTimestamp },
    });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * POST /dashboard/api/sessions/:sessionId/chats/presence
 * Send presence update for a chat target (typing, recording, paused, etc.).
 */
dashboardApi.post("/sessions/:sessionId/chats/presence", async (c) => {
  const denied = requireCapability(c, "replyIncoming");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  const body = await c.req.json().catch(() => ({}));
  const type = String(body.type || "").trim();
  const rawJid = String(body.jid || "").trim();

  const allowedTypes = new Set(["available", "unavailable", "composing", "recording", "paused"]);
  if (!allowedTypes.has(type)) {
    return c.json({ success: false, message: "Invalid presence type" }, 400);
  }

  if (["composing", "recording", "paused"].includes(type) && !rawJid) {
    return c.json({ success: false, message: "jid is required for chat presence type" }, 400);
  }

  try {
    const session = connectionManager.getSession(sessionId);
    let targetJid: string | undefined;
    if (rawJid) {
      const { formatPhone, formatGroup } = await import("@/utils/phone");
      targetJid = rawJid.includes("@")
        ? rawJid
        : body.isGroup === true
          ? formatGroup(rawJid)
          : formatPhone(rawJid);
    }

    await session.sendPresenceUpdate(type as WAPresence, targetJid);
    return c.json({ success: true, message: "Presence updated" });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * POST /dashboard/api/sessions/:sessionId/chats/delete
 *
 * Deletes ONE chat on WhatsApp (chatModify { delete: true }) and removes it from
 * the dashboard. Unlike clear, the room itself is gone. Per-chat only: bulk
 * deletion would be the same spam pattern as bulk clearing.
 */
dashboardApi.post("/sessions/:sessionId/chats/delete", async (c) => {
  const denied = requireCapability(c, "manageSessions");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  const body = await c.req.json().catch(() => ({}));
  const jid = typeof body.jid === "string" ? body.jid.trim() : "";
  if (!jid) {
    return c.json({ success: false, message: "Provide the jid of the open chat" }, 400);
  }

  try {
    const session = connectionManager.getSession(sessionId);
    const status = connectionManager.getSessionStatus(sessionId);
    if (!status.connected) {
      return c.json(
        {
          success: false,
          message: "Session is not connected; reconnect it before deleting this chat",
          retryable: true,
        },
        409,
      );
    }

    const store = session.getStore();
    const lastMessages = store
      .loadMessages(jid, 5)
      .map((message) => ({ key: message.key, messageTimestamp: message.messageTimestamp ?? 0 }));

    if (lastMessages.length > 0) {
      await session.chatModify({ delete: true, lastMessages }, jid);
    }

    const local = store.deleteChat(jid);

    return c.json({
      success: true,
      message: "Chat deleted on WhatsApp and in the dashboard",
      data: { jid, ...local, remote: lastMessages.length > 0 },
    });
  } catch (err) {
    return c.json(
      {
        success: false,
        message: `Failed to delete this chat: ${(err as Error).message}`,
        retryable: true,
      },
      502,
    );
  }
});

/**
 * POST /dashboard/api/sessions/:sessionId/chats/clear
 *
 * Clears the history of ONE chat, in both directions: chatModify({ clear }) on
 * WhatsApp and the cached messages locally. A single request for a single JID is
 * safe; there is deliberately no bulk "clear every chat" endpoint because that
 * would be a spam pattern.
 */
dashboardApi.post("/sessions/:sessionId/chats/clear", async (c) => {
  const denied = requireCapability(c, "manageSessions");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  const body = await c.req.json().catch(() => ({}));
  const jid = typeof body.jid === "string" ? body.jid.trim() : "";
  if (!jid) {
    return c.json({ success: false, message: "Provide the jid of the open chat" }, 400);
  }

  try {
    const session = connectionManager.getSession(sessionId);
    const status = connectionManager.getSessionStatus(sessionId);
    if (!status.connected) {
      return c.json(
        {
          success: false,
          message: "Session is not connected; reconnect it before clearing this chat",
          retryable: true,
        },
        409,
      );
    }

    const store = session.getStore();
    const lastMessages = store
      .loadMessages(jid, 5)
      .map((message) => ({ key: message.key, messageTimestamp: message.messageTimestamp ?? 0 }));

    // Clear on WhatsApp first: if it fails, the local copy stays so the two
    // sides never diverge silently.
    if (lastMessages.length > 0) {
      await session.chatModify({ clear: true, lastMessages }, jid);
    }

    const clearedMessages = store.clearChat(jid);

    return c.json({
      success: true,
      message: "Chat history cleared on WhatsApp and in the dashboard",
      data: { jid, clearedMessages, remote: lastMessages.length > 0 },
    });
  } catch (err) {
    return c.json(
      {
        success: false,
        message: `Failed to clear this chat: ${(err as Error).message}`,
        retryable: true,
      },
      502,
    );
  }
});

/**
 * POST /dashboard/api/sessions/:sessionId/chats/:jid/read
 * Mark unread messages in the chat as read (dashboard safety helper).
 */
dashboardApi.post("/sessions/:sessionId/chats/:jid/read", async (c) => {
  const denied = requireCapability(c, "viewChats");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;
  const jid = decodeURIComponent(c.req.param("jid"));
  const limit = Math.min(Math.max(Number(c.req.query("limit") || "120"), 1), 500);

  try {
    const session = connectionManager.getSession(sessionId);
    const messages = session.getStore().loadMessages(jid, limit);
    const unreadKeys = messages
      .filter((m) => !m.key.fromMe && m.key.id)
      .map((m) => ({
        remoteJid: m.key.remoteJid,
        id: m.key.id,
        participant: m.key.participant,
        fromMe: false,
      }));

    if (unreadKeys.length > 0) {
      await session.readMessages(unreadKeys as proto.IMessageKey[]);
    }
    // Persist the reset: otherwise a page refresh restores the old badge.
    session.getStore().markChatRead(jid);

    return c.json({
      success: true,
      message: unreadKeys.length > 0 ? "Messages marked as read" : "No unread messages",
      data: { readCount: unreadKeys.length },
    });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * GET /dashboard/api/sessions/:sessionId/groups/:jid/members
 * Get basic group members metadata.
 */
dashboardApi.get("/sessions/:sessionId/groups/:jid/members", async (c) => {
  const denied = requireCapability(c, "viewChats");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;
  const jid = decodeURIComponent(c.req.param("jid"));

  try {
    const session = connectionManager.getSession(sessionId);
    const metadata = await session.groupMetadata(jid);

    return c.json({
      success: true,
      data: {
        id: metadata.id,
        subject: metadata.subject,
        participants: (metadata.participants || []).map((p) => ({
          id: p.id,
          admin: p.admin || null,
        })),
      },
    });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * GET /dashboard/api/groups/:sessionId/list
 * List groups for dashboard Groups page.
 */
dashboardApi.get("/groups/:sessionId/list", async (c) => {
  const denied = requireCapability(c, "viewChats");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  try {
    const session = connectionManager.getSession(sessionId);
    const groups = await session.groupFetchAllParticipating();
    const groupList = Object.values(groups || {}).map((group) => {
      const g = group as { id?: string; subject?: string; participants?: unknown[] };
      return {
        id: g.id,
        subject: g.subject,
        participants: g.participants || [],
        size: Array.isArray(g.participants) ? g.participants.length : undefined,
      };
    });

    return c.json({ success: true, data: groupList });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * POST /dashboard/api/groups/:sessionId/create
 * Create a group for dashboard Groups page.
 */
dashboardApi.post("/groups/:sessionId/create", async (c) => {
  const denied = requireCapability(c, "manageGroups");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  const body = await c.req.json().catch(() => ({}));
  const groupName = String(body.groupName || "").trim();
  const participants = Array.isArray(body.participants)
    ? body.participants.map((p: unknown) => String(p).trim()).filter(Boolean)
    : [];

  if (!groupName) {
    return c.json({ success: false, message: "Group name is required" }, 400);
  }
  if (participants.length === 0) {
    return c.json({ success: false, message: "At least one participant is required" }, 400);
  }

  try {
    const session = connectionManager.getSession(sessionId);
    const { formatPhone } = await import("@/utils/phone");
    const normalizedParticipants = participants.map((p: string) => formatPhone(p));
    const result = await session.groupCreate(groupName, normalizedParticipants);

    return c.json({
      success: true,
      message: "Group created",
      data: {
        id: result.id,
        subject: result.subject,
        participants: result.participants || [],
      },
    });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * POST /dashboard/api/groups/:sessionId/leave-and-delete/:jid
 * Leave a group and remove its chat locally and on WhatsApp.
 */
dashboardApi.post("/groups/:sessionId/leave-and-delete/:jid", async (c) => {
  const denied = requireCapability(c, "manageGroups");
  if (denied) return denied;
  const sessionId = c.req.param("sessionId");
  const sessionDenied = requireSessionAccess(c, sessionId);
  if (sessionDenied) return sessionDenied;

  const rawJid = decodeURIComponent(c.req.param("jid"));
  try {
    const { formatGroup } = await import("@/utils/phone");
    const jid = formatGroup(rawJid);
    const session = connectionManager.getSession(sessionId);
    const store = session.getStore();
    const lastMessages = store
      .loadMessages(jid, 5)
      .map((message) => ({ key: message.key, messageTimestamp: message.messageTimestamp ?? 0 }));

    if (lastMessages.length > 0) {
      try {
        await session.chatModify({ delete: true, lastMessages }, jid);
      } catch {
        // Leaving still proceeds; local cleanup is below.
      }
    }

    await session.groupLeave(jid);
    store.deleteChat(jid);
    return c.json({ success: true, message: "Left and deleted the group", data: { jid } });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * GET /dashboard/api/events/stream
 * SSE endpoint for real-time event monitoring.
 */
dashboardApi.get("/events/stream", (c) => {
  const denied = requireCapability(c, "viewChats");
  if (denied) return denied;
  const requestedSession = c.req.query("session") || "";
  if (requestedSession && !hasSessionAccess(c, requestedSession)) {
    return c.json(
      { success: false, message: "Forbidden: session is not assigned to your account" },
      403,
    );
  }
  return streamSSE(c, async (stream) => {
    const sessionFilter = requestedSession;
    const eventFilter = c.req.query("event");

    const handler = (ev: DashboardEvent) => {
      if (sessionFilter && ev.sessionId !== sessionFilter) return;
      if (getDashboardRole(c) !== "admin" && !hasSessionAccess(c, ev.sessionId)) return;
      if (eventFilter && !ev.event.includes(eventFilter)) return;

      stream.writeSSE({
        event: "baileys-event",
        data: JSON.stringify(ev),
        id: `${ev.timestamp}`,
      });
    };

    eventBus.on("baileys-event", handler);

    // Send heartbeat
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "heartbeat", data: new Date().toISOString() });
    }, 30000);

    // Keep alive until client disconnects
    stream.onAbort(() => {
      eventBus.off("baileys-event", handler);
      clearInterval(heartbeat);
    });

    // Wait indefinitely (stream stays open)
    await new Promise(() => {});
  });
});

/**
 * GET /dashboard/api/events/recent
 * Get recent events (non-SSE).
 */
dashboardApi.get("/events/recent", (c) => {
  const denied = requireCapability(c, "viewChats");
  if (denied) return denied;
  const limit = Number(c.req.query("limit") || 50);
  const events = eventBus.getRecentEvents(limit);
  return c.json({ success: true, data: events });
});

/**
 * POST /dashboard/api/events/clear
 * Clear event buffer.
 */
dashboardApi.post("/events/clear", (c) => {
  const denied = requireCapability(c, "manageEvents");
  if (denied) return denied;
  eventBus.clearEvents();
  return c.json({ success: true, message: "Events cleared" });
});

/**
 * GET /dashboard/api/config/simulation
 * Get WA Web behavior simulation settings (read-only).
 */
dashboardApi.get("/config/simulation", (c) => {
  if (!isAdminUser(c)) {
    return c.json({ success: false, message: "Forbidden: admin access required" }, 403);
  }
  return c.json({
    success: true,
    data: {
      typingBeforeSend: config.simulation.typingBeforeSend,
      typingDelayMinMs: config.simulation.typingDelayMinMs,
      typingDelayMaxMs: config.simulation.typingDelayMaxMs,
      autoReadMessages: config.simulation.autoReadMessages,
      autoMarkOnline: config.simulation.autoMarkOnline,
      rejectCalls: config.simulation.rejectCalls,
    },
  });
});

/**
 * GET /dashboard/api/api-keys
 * List managed API keys. Only the short id and label are returned, never tokens.
 */
dashboardApi.get("/api-keys", async (c) => {
  const denied = requireCapability(c, "manageApiKeys");
  if (denied) return denied;
  try {
    const keys = await listApiKeys();
    if (getDashboardRole(c) === "admin") return c.json({ success: true, data: keys });
    // Managers only see keys fully scoped to sessions they can access; an
    // all-session key must never be visible outside admin.
    const visible = keys.filter(
      (key) =>
        key.sessions.length > 0 &&
        key.sessions.every((session) => session !== "*" && hasSessionAccess(c, session)),
    );
    return c.json({ success: true, data: visible });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * POST /dashboard/api/api-keys
 * Create a key. The token is returned once and never stored in plaintext.
 */
dashboardApi.post("/api-keys", async (c) => {
  const denied = requireCapability(c, "manageApiKeys");
  if (denied) return denied;

  const body = await c.req.json().catch(() => ({}));
  const label = String(body.label ?? "").trim();
  if (label.length < 2 || label.length > 64) {
    return c.json({ success: false, message: "label must be 2-64 characters" }, 400);
  }

  const session = String(body.session ?? "").trim();
  if (!session) {
    return c.json(
      {
        success: false,
        message: "session is required",
        field: "session",
        hint: "Pick the connected session this key may send from.",
      },
      400,
    );
  }
  if (!hasSessionAccess(c, session)) {
    return c.json(
      { success: false, message: "Forbidden: session is not assigned to your account" },
      403,
    );
  }
  if (!connectionManager.listSessions().some((entry) => entry.sessionId === session)) {
    return c.json(
      {
        success: false,
        message: `Session "${session}" is not connected`,
        field: "session",
        hint: "Connect the session first (Dashboard → Sessions), then create the key.",
      },
      400,
    );
  }

  try {
    const created = await createApiKey({ label, session, role: "user" });
    return c.json(
      {
        success: true,
        data: created,
        message: "API key created. Copy it now: it is not shown again.",
      },
      201,
    );
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * DELETE /dashboard/api/api-keys/:id
 * Revoke a key by its short id.
 */
dashboardApi.delete("/api-keys/:id", async (c) => {
  const denied = requireCapability(c, "manageApiKeys");
  if (denied) return denied;
  const id = c.req.param("id");
  try {
    const keys = await listApiKeys();
    const key = keys.find((entry) => entry.id === id);
    if (!key) return c.json({ success: false, message: "API key not found" }, 404);
    if (
      getDashboardRole(c) !== "admin" &&
      (key.sessions.includes("*") || !key.sessions.every((session) => hasSessionAccess(c, session)))
    ) {
      return c.json(
        { success: false, message: "Forbidden: key is not scoped to your sessions" },
        403,
      );
    }
    const revoked = await revokeApiKey(id);
    if (!revoked) return c.json({ success: false, message: "API key not found" }, 404);
    return c.json({ success: true, message: "API key revoked" });
  } catch (err) {
    return error(c, (err as Error).message, 500);
  }
});

/**
 * GET /dashboard/api/api-logs
 * Recent inbound API calls (audit). Supports limit/session/status/keyId filters.
 */
dashboardApi.get("/api-logs", (c) => {
  const denied = requireCapability(c, "manageApiKeys");
  if (denied) return denied;

  const limit = Number(c.req.query("limit") ?? 100);
  const statusRaw = c.req.query("status");
  const status = statusRaw ? Number(statusRaw) : undefined;
  const calls = listApiCalls({
    limit: Number.isFinite(limit) ? limit : 100,
    session: c.req.query("session") || undefined,
    keyId: c.req.query("keyId") || undefined,
    status: Number.isFinite(status) ? status : undefined,
  });
  if (getDashboardRole(c) === "admin") return c.json({ success: true, data: calls });
  const visible = calls.filter((entry) => hasSessionAccess(c, String(entry.session || "")));
  return c.json({ success: true, data: visible });
});

export default dashboardApi;
