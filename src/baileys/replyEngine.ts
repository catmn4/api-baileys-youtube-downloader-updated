/**
 * Humanized reply engine.
 *
 * Reproduces the natural WA Web interaction sequence for automated replies
 * instead of answering instantly (which reads as bot-like):
 *
 *   1. (optional) wait a "human read" delay   — time to open the chat
 *   2. (optional) send read receipts           — mark as read once
 *   3. (optional) wait a random "thinking" gap — time to compose
 *   4. send presence (available) + composing   — show typing bubble
 *   5. wait a typing duration (~ length-based)  — time "spent typing"
 *   6. clear composing (paused) and send
 *
 * All steps are gated behind explicit configuration; with defaults it is a
 * no-op passthrough so existing behavior is preserved exactly.
 */
import type { AnyRegularMessageContent, WAMessage } from "@whiskeysockets/baileys";
import config from "@/config";
import logger from "@/lib/logger";
import { asyncSleep, distributedDelay, randomDelay } from "@/utils/asyncSleep";

/** Extract the human-readable text length from any message content. */
function textLengthOf(content: unknown): number {
  if (content && typeof content === "object") {
    const msg = content as Record<string, unknown>;
    if (typeof msg.text === "string") return msg.text.length;
    if (typeof msg.caption === "string") return msg.caption.length;
    const inner = msg.message as Record<string, unknown> | undefined;
    if (inner && typeof inner.conversation === "string") return inner.conversation.length;
    const ext = inner?.extendedTextMessage as Record<string, unknown> | undefined;
    if (ext && typeof ext.text === "string") return ext.text.length;
  }
  return 0;
}

export interface HumanizeStepOptions {
  enabled: boolean;
  /** Min/max "thinking" gap before typing starts (ms). */
  thinkMinMs?: number;
  thinkMaxMs?: number;
  /** Min/max "human read" delay before read receipts (ms). */
  readMinMs?: number;
  readMaxMs?: number;
  /** Approximate human reading speed (chars per second). */
  readingCps?: number;
  /** Approximate human typing speed (chars per second). */
  typingCps?: number;
  /** Mark as read before replying. */
  readBeforeReply?: boolean;
}

export interface HumanizeContext {
  /** Caller-supplied function that performs the mark-as-read. */
  markRead: () => Promise<void>;
  /** Caller-supplied function that performs presence (composing/paused). */
  setPresence: (type: "available" | "composing" | "paused") => Promise<void>;
}

/**
 * Resolve the "composing" duration from message length.
 * Falls back to configured typing delay range when text length is unknown.
 */
export function resolveTypingDurationMs(
  message: AnyRegularMessageContent,
  opts: HumanizeStepOptions,
) {
  const textLen = textLengthOf(message);
  if (textLen > 0 && opts.typingCps) {
    // Rough: base reaction time + chars typed at ~human speed, then bounded.
    const base = 600;
    const typed = (textLen / opts.typingCps) * 1000;
    return Math.min(Math.max(base + typed, 800), 6000);
  }
  // No text (media/long) → bounded random within configured range.
  const lo = config.simulation.typingDelayMinMs;
  const hi = config.simulation.typingDelayMaxMs;
  return randomDelay(lo, hi);
}

/**
 * Run the humanized read step (delay then read) — best-effort, never throws.
 */
export async function humanizeReadBeforeReply(opts: HumanizeStepOptions, ctx: HumanizeContext) {
  if (!opts.enabled || !opts.readBeforeReply) return;
  try {
    const lo = opts.readMinMs ?? config.humanize.readDelayMinMs;
    const hi = opts.readMaxMs ?? config.humanize.readDelayMaxMs;
    await asyncSleep(distributedDelay(config.humanize.delayDistribution, lo, hi));
    await ctx.markRead();
  } catch (err) {
    logger.warn("[Humanize] read-before-reply skipped: %s", (err as Error).message);
  }
}

/**
 * Run the full humanized typing sequence before a send.
 * Caller still performs the actual send after this resolves.
 */
export async function humanizeTypingSequence(
  message: AnyRegularMessageContent,
  opts: HumanizeStepOptions,
  ctx: HumanizeContext,
) {
  if (!opts.enabled) return;
  try {
    // thinking gap before starting to type
    const thinkLo = opts.thinkMinMs ?? config.humanize.thinkMinMs;
    const thinkHi = opts.thinkMaxMs ?? config.humanize.thinkMaxMs;
    await asyncSleep(distributedDelay(config.humanize.delayDistribution, thinkLo, thinkHi));

    await ctx.setPresence("available");
    await ctx.setPresence("composing");
    const typingMs = resolveTypingDurationMs(message, opts);
    await asyncSleep(typingMs);
    await ctx.setPresence("paused");
  } catch (err) {
    logger.warn("[Humanize] typing sequence skipped: %s", (err as Error).message);
  }
}

/**
 * Compute the effective humanize options from a raw incoming message.
 * @returns resolved option set, or null when humanization is disabled.
 */
export function resolveHumanizeOptions(incoming: WAMessage): HumanizeStepOptions | null {
  const humanize = config.humanize;
  const enabled =
    humanize.readBeforeReply ||
    (humanize.thinkMinMs > 0 && humanize.thinkMaxMs >= humanize.thinkMinMs);
  if (!enabled) return null;

  // Rough reading-time estimate: scale by incoming text length.
  const incomingLen = textLengthOf(incoming);

  return {
    enabled: true,
    thinkMinMs: humanize.thinkMinMs,
    thinkMaxMs: humanize.thinkMaxMs,
    // read delay scales with message length, bounded by config range
    readMinMs: Math.min(humanize.readDelayMinMs, 400 + incomingLen * 3),
    readMaxMs: Math.min(humanize.readDelayMaxMs, 800 + incomingLen * 5),
    readingCps: 12,
    typingCps: 4,
    readBeforeReply: humanize.readBeforeReply,
  };
}

export type { AnyRegularMessageContent };
