/**
 * Built-in send-message tool for the OpenAI-compatible agent.
 *
 * Kept separate from the generic RAG tools: the URL/session is never chosen by
 * the model, and the caller executes it against the same service the REST API
 * uses. Scope, allowlist and the hourly bucket are enforced before sending.
 */
import type { AiSendMessageConfig } from "@/baileys/types";
import type { OpenAiToolSchema } from "@/services/ragTools";

export const SEND_MESSAGE_TOOL_NAME = "send_whatsapp_message";

export type AiSendScope = "allowlist" | "any";

export interface ResolvedSendMessageConfig {
  enabled: boolean;
  scope: AiSendScope;
  allowlist: string[];
  maxPerHour: number;
}

export function buildSendMessageToolSchema(scope: AiSendScope): OpenAiToolSchema {
  const properties: Record<string, unknown> = {
    text: {
      type: "string",
      maxLength: 4000,
      description: "Message body. Plain text only.",
    },
  };
  properties.receiver = {
    type: "string",
    description:
      scope === "allowlist"
        ? "Phone number or JID from the allowed list; omit to use the current chat."
        : "Phone number or JID; omit to use the current chat.",
  };

  return {
    type: "function",
    function: {
      name: SEND_MESSAGE_TOOL_NAME,
      description:
        "Send a WhatsApp text message from this connected session. Use only when the customer explicitly asks you to send something.",
      parameters: {
        type: "object",
        required: ["text"],
        additionalProperties: false,
        properties,
      },
    },
  };
}

export function buildSendMessageGuidance(config: ResolvedSendMessageConfig): string {
  const scope =
    config.scope === "allowlist"
      ? "You may send to the current conversation or an allowlisted recipient."
      : "You may send to any recipient the customer names.";
  return [
    `Tool ${SEND_MESSAGE_TOOL_NAME} sends a WhatsApp text message from this session.`,
    "Call it only when the customer explicitly asks you to send a message; never invent a recipient.",
    scope,
    `At most ${config.maxPerHour} sends per hour are allowed; a rejected send must be reported to the customer.`,
  ].join(" ");
}

/** Compare a receiver against phone/JID allowlist entries. */
export function isReceiverAllowed(receiver: string, allowlist: string[]): boolean {
  const target = receiver.trim();
  if (!target) return false;
  const targetDigits = target.replace(/\D/g, "");
  return allowlist.some((entry) => {
    const value = entry.trim();
    if (!value) return false;
    if (value === target) return true;
    // A JID is exact; a phone entry compares digits only.
    if (/@(lid|s\.whatsapp\.net|g\.us)$/i.test(value)) return value === target;
    const digits = value.replace(/\D/g, "");
    return digits.length > 0 && digits === targetDigits;
  });
}

/**
 * Sliding one-hour bucket. Returns false without recording when the cap is hit.
 * The array is mutated in place; callers keep one per session.
 */
export function consumeSendQuota(bucket: number[], maxPerHour: number, now = Date.now()): boolean {
  const max = Math.max(1, Math.floor(maxPerHour));
  const cutoff = now - 60 * 60 * 1000;
  while (bucket.length > 0 && bucket[0] <= cutoff) bucket.shift();
  if (bucket.length >= max) return false;
  bucket.push(now);
  return true;
}
