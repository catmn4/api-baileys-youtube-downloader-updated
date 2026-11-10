/**
 * Auto-reply defaults and normalization.
 *
 * Per-session settings may omit or blank the message. In that case the global
 * AUTO_REPLY_MESSAGE (already defaulted in config) wins; a hardcoded UI string
 * must never overwrite the operator's environment default.
 */
import type { AutoReplyConfig } from "@/baileys/types";
import config from "@/config";

export function resolveAutoReplyConfig(override?: Partial<AutoReplyConfig>): AutoReplyConfig {
  const merged = { ...config.autoReply, ...(override ?? {}) };
  if (!merged.message?.trim()) merged.message = config.autoReply.message;
  return merged;
}

/** Persist a complete config, replacing a blank message with the env default. */
export function normalizeAutoReplyConfig(
  input?: Partial<AutoReplyConfig>,
): AutoReplyConfig | undefined {
  if (!input) return undefined;
  return {
    ...config.autoReply,
    ...input,
    message: input.message?.trim() || config.autoReply.message,
  };
}
