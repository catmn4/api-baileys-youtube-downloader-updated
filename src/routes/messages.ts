/**
 * Unified send endpoint for third-party integrations.
 *
 * POST /messages — one request shape for text, image, document and location.
 * Authentication uses the API key middleware; keys can be scoped to sessions.
 *
 * Failures are never silent: every rejection returns a machine-readable `code`,
 * the offending `field`, an actionable `hint`, a `retryable` flag and the same
 * `requestId` recorded in the audit log. That lets a calling LLM correct itself
 * instead of retrying blindly.
 */
import { type Context, Hono } from "hono";
import connectionManager from "@/baileys/connectionManager";
import config from "@/config";
import { success } from "@/lib/response";
import { type AuthData, authMiddleware } from "@/middleware/auth";
import { apiKeyRateLimit, sendRateLimit } from "@/middleware/rateLimit";
import { unifiedSendJsonSchema, unifiedSendSchema } from "@/schemas/message";
import { maskReceiver, recordApiCall } from "@/services/apiAuditLog";
import { keyAllowsSession } from "@/services/apiKeys";
import {
  MessageSendError,
  resolveSessionId,
  sendUnifiedMessage,
  withTimeout,
} from "@/services/messageSender";

const messageRoutes = new Hono();

// Public schema discovery for LLM tool definitions. Registered before the auth
// middleware so an integrator can fetch the contract without a key.
messageRoutes.get("/schema", (c) => c.json(unifiedSendJsonSchema));

/** Context accessor keeps the route independent of Hono env generics. */
function authPayload(c: Context): AuthData | undefined {
  return c.get("auth") as AuthData | undefined;
}

interface FailureExtra {
  status: number;
  code: string;
  message: string;
  requestId: string;
  field?: string;
  hint?: string;
  details?: Record<string, unknown>;
}

function failure(c: Context, extra: FailureExtra) {
  c.header("x-request-id", extra.requestId);
  return c.json(
    {
      success: false,
      code: extra.code,
      message: extra.message,
      field: extra.field,
      hint: extra.hint,
      details: extra.details,
      retryable: extra.status === 409 || extra.status >= 500,
      requestId: extra.requestId,
    },
    extra.status as 400,
  );
}

messageRoutes.use("*", authMiddleware);

const inFlight = new Map<string, number>();

function acquireSlot(session: string): boolean {
  const current = inFlight.get(session) ?? 0;
  if (current >= config.send.maxConcurrent) return false;
  inFlight.set(session, current + 1);
  return true;
}

function releaseSlot(session: string): void {
  const current = inFlight.get(session) ?? 0;
  if (current <= 1) inFlight.delete(session);
  else inFlight.set(session, current - 1);
}

messageRoutes.post("/", apiKeyRateLimit, sendRateLimit, async (c) => {
  const startedAt = Date.now();
  const auth = authPayload(c);
  const requestId =
    c.req.header("x-request-id") ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const body = await c.req.json().catch(() => ({}));

  const audit = (
    status: number,
    info: { session?: string | null; receiver?: string | null; type: string },
  ) => {
    recordApiCall({
      timestamp: new Date().toISOString(),
      requestId,
      keyId: auth?.keyId ?? null,
      keyLabel: auth?.label ?? null,
      session: info.session ?? null,
      receiver: info.receiver ? maskReceiver(String(info.receiver)) : null,
      type: info.type,
      status,
      latencyMs: Date.now() - startedAt,
      ip:
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        c.req.header("x-real-ip") ??
        "unknown",
      body: config.auditLog.body ? JSON.stringify(body).slice(0, 2000) : undefined,
    });
  };

  const parsed = unifiedSendSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    }));
    const first = issues[0];
    audit(400, { type: "unknown" });

    return failure(c, {
      status: 400,
      code: "INVALID_REQUEST",
      message: first?.message ?? "Invalid request body",
      field: first?.field,
      hint: "Required fields depend on `type`: text → messages; image/document → media.url; location → location.latitude and location.longitude. See the README section 'Unified send'.",
      details: { issues },
      requestId,
    });
  }

  const input = parsed.data;
  let session: string | null = null;

  try {
    session = resolveSessionId(input.from);

    if (!keyAllowsSession(auth?.sessions, session)) {
      audit(403, { session, receiver: input.receiver, type: input.type });
      return failure(c, {
        status: 403,
        code: "KEY_NOT_SCOPED",
        message: `API key is not scoped to session "${session}"`,
        field: "from",
        hint: "Use a `from` that this key allows, or ask an administrator to create a key scoped to this session.",
        details: { allowed: auth?.sessions ?? ["*"], requested: session },
        requestId,
      });
    }

    if (!acquireSlot(session)) {
      audit(429, { session, receiver: input.receiver, type: input.type });
      return failure(c, {
        status: 429,
        code: "SESSION_BUSY",
        message: `Session "${session}" already has ${config.send.maxConcurrent} sends in flight`,
        field: "from",
        hint: "Retry after a short delay; consider queueing sends on your side instead of firing them concurrently.",
        details: { session, maxConcurrent: config.send.maxConcurrent },
        requestId,
      });
    }

    try {
      const data = await withTimeout(sendUnifiedMessage(input), config.send.timeoutMs);
      audit(200, { session, receiver: data.to, type: input.type });
      return success(c, data, "Message sent successfully");
    } finally {
      releaseSlot(session);
    }
  } catch (err) {
    if (err instanceof MessageSendError) {
      audit(err.status, { session, receiver: input.receiver, type: input.type });

      const details =
        err.code === "SESSION_NOT_FOUND"
          ? {
              ...err.details,
              available: connectionManager
                .listSessions()
                .map((entry) => entry.sessionId)
                .filter((id) => keyAllowsSession(auth?.sessions, id)),
            }
          : err.details;

      return failure(c, {
        status: err.status,
        code: err.code,
        message: err.message,
        field: err.field,
        hint: err.hint,
        details,
        requestId,
      });
    }

    audit(500, { session, receiver: input.receiver, type: input.type });
    const message = (err as Error).message;
    return failure(c, {
      status: 500,
      code: "SEND_FAILED",
      message: `Failed to send message: ${message}`,
      hint: "Retry once; if it keeps failing, share this requestId with the administrator to check the server logs.",
      details: { session, type: input.type },
      requestId,
    });
  }
});

export default messageRoutes;
