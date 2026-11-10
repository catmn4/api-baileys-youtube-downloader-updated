/**
 * Unified outbound sender.
 *
 * Resolves a session from its id or bound phone number, normalizes the receiver
 * into a JID, applies the group policy and forwards the built content to
 * Baileys. Every failure is a MessageSendError carrying a machine-readable code,
 * the offending field and an actionable hint, so a calling LLM can correct
 * itself instead of guessing.
 */
import type { AnyMessageContent, WAMessage } from "@whiskeysockets/baileys";
import connectionManager from "@/baileys/connectionManager";
import config from "@/config";
import { validateOutboundUrl } from "@/lib/urlGuard";
import type { UnifiedSendInput } from "@/schemas/message";
import { extractPhone, formatGroup, formatPhone } from "@/utils/phone";

export type SendErrorStatus = 400 | 403 | 404 | 409 | 429 | 504;

export type SendErrorCode =
  | "INVALID_REQUEST"
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_CONNECTED"
  | "GROUP_DISABLED"
  | "GROUP_NOT_ALLOWED"
  | "RECEIVER_NOT_ON_WHATSAPP"
  | "MEDIA_URL_BLOCKED"
  | "SESSION_BUSY"
  | "SEND_TIMEOUT";

export interface SendErrorOptions {
  status?: SendErrorStatus;
  code?: SendErrorCode;
  /** Request field the caller must fix. */
  field?: string;
  /** Actionable next step for the caller (and for an LLM). */
  hint?: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export class MessageSendError extends Error {
  readonly status: SendErrorStatus;
  readonly code: SendErrorCode;
  readonly field?: string;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;
  readonly retryable?: boolean;

  constructor(message: string, options: SendErrorOptions = {}) {
    super(message);
    this.name = "MessageSendError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "INVALID_REQUEST";
    this.field = options.field;
    this.hint = options.hint;
    this.details = options.details;
    this.retryable = options.retryable;
  }
}

/** Reject after `ms` without leaking a hanging promise (message may still arrive). */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new MessageSendError("The send operation timed out", {
              status: 504,
              code: "SEND_TIMEOUT",
              hint: "Retry after a short delay. The message may still be delivered on the server side.",
              retryable: true,
            }),
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Resolve `from` by session id first, then by the phone bound to a session. */
export function resolveSessionId(ref: string): string {
  const value = ref.trim();
  if (connectionManager.hasSession(value)) return value;

  const digits = value.replace(/\D/g, "");
  if (digits) {
    for (const session of connectionManager.listSessions()) {
      const user = session.user as { id?: string } | null;
      const phone = user?.id ? extractPhone(String(user.id)) : "";
      if (phone && (phone === digits || phone === value)) return session.sessionId;
    }
  }

  throw new MessageSendError(`Session "${ref}" not found or not connected`, {
    status: 404,
    code: "SESSION_NOT_FOUND",
    field: "from",
    hint: "Call GET /sessions with the same API key to list available session ids, then pass a session id or its bound phone number as `from`.",
    details: { from: ref },
  });
}

/**
 * Normalize the receiver and enforce the group policy.
 *
 * Group sending is disabled by default: it is the highest-risk pattern for an
 * unofficial WhatsApp client. Enabling it also narrows the targets when an
 * allowlist is configured.
 */
function resolveTarget(input: UnifiedSendInput): { jid: string; isGroup: boolean } {
  const receiver = input.receiver.trim();
  const wantsGroup = input.isGroup || receiver.endsWith("@g.us");

  if (!wantsGroup) return { jid: formatPhone(receiver), isGroup: false };

  const jid = formatGroup(receiver);
  if (!config.messaging.allowGroupSend) {
    throw new MessageSendError(
      "Group messages are disabled (set ALLOW_GROUP_SEND=true to enable)",
      {
        status: 403,
        code: "GROUP_DISABLED",
        field: "receiver",
        hint: "Send to a 1:1 number, or enable ALLOW_GROUP_SEND (and optionally ALLOWED_GROUP_JIDS) on the server and retry.",
        details: { receiver },
      },
    );
  }

  const allowed = config.messaging.allowedGroupJids;
  if (allowed.length > 0) {
    const numeric = jid.replace(/@g\.us$/, "");
    if (!allowed.includes(jid) && !allowed.includes(numeric)) {
      throw new MessageSendError("Group is not in ALLOWED_GROUP_JIDS", {
        status: 403,
        code: "GROUP_NOT_ALLOWED",
        field: "receiver",
        hint: "Ask an administrator to add this group JID to ALLOWED_GROUP_JIDS, or send to an allowlisted group.",
        details: { receiver, groupJid: jid },
      });
    }
  }

  return { jid, isGroup: true };
}

function assertMediaUrl(url: string): void {
  const invalid = validateOutboundUrl(url, { blockInternal: config.media.blockInternal });
  if (invalid) {
    throw new MessageSendError(`Media URL rejected: ${invalid}`, {
      status: 400,
      code: "MEDIA_URL_BLOCKED",
      field: "media.url",
      hint: "Use a public http(s) URL. If the media host is intentionally internal, set MEDIA_BLOCK_INTERNAL=false.",
      details: { url },
    });
  }
}

function contentFor(input: UnifiedSendInput): AnyMessageContent {
  switch (input.type) {
    case "image":
      assertMediaUrl(input.media?.url ?? "");
      return { image: { url: input.media?.url ?? "" }, caption: input.messages };
    case "document":
      assertMediaUrl(input.media?.url ?? "");
      return {
        document: { url: input.media?.url ?? "" },
        mimetype: input.media?.mimetype ?? "application/octet-stream",
        fileName: input.media?.filename ?? "document",
        caption: input.messages,
      };
    case "location": {
      const location = input.location;
      if (!location) {
        throw new MessageSendError("location is required for location messages", {
          status: 400,
          code: "INVALID_REQUEST",
          field: "location",
          hint: "Provide location.latitude and location.longitude in decimal degrees.",
        });
      }
      return {
        location: {
          degreesLatitude: location.latitude,
          degreesLongitude: location.longitude,
          name: location.name,
          address: location.address,
        },
      };
    }
    default:
      return { text: input.messages ?? "" };
  }
}

export async function sendUnifiedMessage(input: UnifiedSendInput) {
  const { jid, isGroup } = resolveTarget(input);
  const sessionId = resolveSessionId(input.from);

  const status = connectionManager.getSessionStatus(sessionId);
  if (!status.exists || !status.connected) {
    throw new MessageSendError(`Session "${sessionId}" is not connected`, {
      status: 409,
      code: "SESSION_NOT_CONNECTED",
      field: "from",
      hint: "Reconnect the session from Dashboard → Sessions (scan the QR code), then retry this request.",
      details: { session: sessionId, connected: false },
    });
  }

  const session = connectionManager.getSession(sessionId);

  if (!isGroup) {
    const exists = await session.isOnWhatsApp(jid);
    if (!exists) {
      throw new MessageSendError("The receiver number is not registered on WhatsApp", {
        status: 400,
        code: "RECEIVER_NOT_ON_WHATSAPP",
        field: "receiver",
        hint: "Use the international format with country code and digits only (e.g. 628123456789), and confirm the number has WhatsApp.",
        details: { receiver: jid },
      });
    }
  }

  const result = await session.sendMessage(jid, contentFor(input), {
    quoted: input.quoted as WAMessage | undefined,
  });

  return {
    messageId: result?.key?.id ?? null,
    to: jid,
    type: input.type,
    timestamp: Number(result?.messageTimestamp ?? Math.floor(Date.now() / 1000)),
  };
}
