import { Hono } from "hono";
import connectionManager from "@/baileys/connectionManager";
import { error, success } from "@/lib/response";
import { authAllowsSession, authMiddleware, isAdminApiAuth } from "@/middleware/auth";
import { sessionRateLimit } from "@/middleware/rateLimit";
import { createSessionSchema, SESSION_ID_REGEX } from "@/schemas/session";
import { normalizeAutoReplyConfig } from "@/services/autoReply";

const sessionRoutes = new Hono();

sessionRoutes.use("*", authMiddleware);

/**
 * POST /sessions/:sessionId
 * Create a new session (QR code or pairing code).
 */
sessionRoutes.post("/:sessionId", sessionRateLimit, async (c) => {
  if (!isAdminApiAuth(c)) {
    return error(c, "Forbidden: only an admin key may create sessions", 403);
  }
  const sessionId = c.req.param("sessionId") ?? "";

  // Validate session ID format
  if (!SESSION_ID_REGEX.test(sessionId)) {
    return error(
      c,
      "Invalid session ID format (alphanumeric, hyphens, underscores, max 64 chars)",
      400,
    );
  }

  const parsed = createSessionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const body = parsed.data;

  try {
    if (body.freshAuth) {
      // Force a clean auth state so QR/pairing starts from a fresh login.
      await connectionManager.deleteSession(sessionId);
    }

    const result = await connectionManager.createSession(sessionId, {
      clientName: body.clientName,
      webhookUrl: body.webhookUrl || undefined,
      webhookSecret: body.webhookSecret || undefined,
      usePairingCode: body.usePairingCode ?? false,
      phoneNumber: body.phoneNumber,
      includeMedia: body.includeMedia,
      syncFullHistory: body.syncFullHistory ?? false,
    });

    if (result.pairingCode) {
      return success(
        c,
        { pairingCode: result.pairingCode },
        "Pairing code generated. Enter it on your phone.",
      );
    }

    return success(c, { qrCode: result.qrCode }, "Session created. Scan the QR code to connect.");
  } catch (err) {
    return error(c, `Failed to create session: ${(err as Error).message}`);
  }
});

/**
 * GET /sessions
 * List all active sessions.
 */
sessionRoutes.get("/", (c) => {
  const sessions = connectionManager
    .listSessions()
    .filter((session) => authAllowsSession(c, String(session.sessionId || "")));
  return success(c, sessions);
});

/**
 * GET /sessions/:sessionId
 * Get session status.
 */
sessionRoutes.get("/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  if (!authAllowsSession(c, sessionId)) {
    return error(c, `API key is not scoped to session "${sessionId}"`, 403);
  }
  const status = connectionManager.getSessionStatus(sessionId);
  return success(c, status);
});

/**
 * GET /sessions/:sessionId/qr
 * Get current QR code for a pending session.
 */
sessionRoutes.get("/:sessionId/qr", (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  if (!authAllowsSession(c, sessionId)) {
    return error(c, `API key is not scoped to session "${sessionId}"`, 403);
  }
  const status = connectionManager.getSessionStatus(sessionId);

  if (!status.exists) {
    return error(c, "Session not found", 404);
  }

  if (status.connected) {
    return success(c, { connected: true }, "Session is already connected");
  }

  return success(
    c,
    { qrCode: status.qrCode },
    status.qrCode ? "QR code available" : "QR code not yet generated",
  );
});

/**
 * PATCH /sessions/:sessionId/settings
 * Update settings for an active session.
 */
sessionRoutes.patch("/:sessionId/settings", async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  if (!authAllowsSession(c, sessionId)) {
    return error(c, `API key is not scoped to session "${sessionId}"`, 403);
  }
  const parsed = createSessionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const body = parsed.data;

  try {
    const currentSecret = connectionManager.getSession(sessionId).getOptions().webhookSecret;
    await connectionManager.updateSessionSettings(sessionId, {
      clientName: body.clientName,
      webhookUrl: body.webhookUrl || undefined,
      // Blank keeps the existing secret; there is no secret in list responses.
      webhookSecret: body.webhookSecret?.trim() || currentSecret,
      includeMedia: body.includeMedia,
      syncFullHistory: body.syncFullHistory,
      autoReply: normalizeAutoReplyConfig(body.autoReply),
    });
    return success(c, null, "Session settings updated successfully");
  } catch (err) {
    return error(c, `Failed to update settings: ${(err as Error).message}`);
  }
});

/**
 * DELETE /sessions/:sessionId
 * Logout and delete a session.
 */
sessionRoutes.delete("/:sessionId", async (c) => {
  if (!isAdminApiAuth(c)) {
    return error(c, "Forbidden: only an admin key may delete sessions", 403);
  }
  const sessionId = c.req.param("sessionId") ?? "";

  try {
    await connectionManager.deleteSession(sessionId);
    return success(c, null, "Session deleted successfully");
  } catch (err) {
    return error(c, `Failed to delete session: ${(err as Error).message}`);
  }
});

export default sessionRoutes;
