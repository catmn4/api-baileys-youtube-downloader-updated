import type { Context, Next } from "hono";
import connectionManager from "@/baileys/connectionManager";
import { error } from "@/lib/response";
import { authAllowsSession } from "@/middleware/auth";
import { SESSION_ID_REGEX } from "@/schemas/session";

/**
 * Middleware to validate that a session exists and is connected.
 * Expects `sessionId` in route params.
 * Validates sessionId format to prevent path traversal attacks.
 */
export async function sessionValidator(c: Context, next: Next) {
  const sessionId = c.req.param("sessionId");

  if (!sessionId) {
    return error(c, "Session ID is required", 400);
  }

  if (!SESSION_ID_REGEX.test(sessionId)) {
    return error(
      c,
      "Invalid session ID format (alphanumeric, hyphens, underscores, max 64 chars)",
      400,
    );
  }

  if (!authAllowsSession(c, sessionId)) {
    return error(c, `API key is not scoped to session "${sessionId}"`, 403, undefined, {
      hint: "Use a key scoped to this session, or ask an administrator for access.",
      retryable: false,
    });
  }

  if (!connectionManager.hasSession(sessionId)) {
    return error(c, `Session '${sessionId}' not found`, 404);
  }

  return next();
}
