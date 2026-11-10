/**
 * Time-based routing helpers.
 *
 * A conversation is handled by the AI agent while the clock is inside the
 * configured window; outside it, humans own the conversation. Windows may
 * cross midnight (e.g. 16:00 -> 08:00). Evaluation happens in the configured
 * IANA timezone, never the server's local clock.
 */
import type { RoutingConfig } from "@/baileys/types";
import config from "@/config";

export interface ResolvedRouting {
  timezone: string;
  aiWindowStart: string;
  aiWindowEnd: string;
  batchIdleMs: number;
  batchMaxWaitMs: number;
  maxBatchMessages: number;
  humanIdleMs: number;
  handoffPauseMs: number;
}

/** Merge per-number overrides over the global env defaults. */
export function resolveRoutingConfig(override?: RoutingConfig): ResolvedRouting {
  const stored = override ?? {};
  return {
    timezone: stored.timezone || config.routing.timezone,
    aiWindowStart: stored.aiWindowStart || config.routing.aiWindowStart,
    aiWindowEnd: stored.aiWindowEnd || config.routing.aiWindowEnd,
    batchIdleMs: stored.batchIdleMs ?? config.routing.batchIdleMs,
    batchMaxWaitMs: stored.batchMaxWaitMs ?? config.routing.batchMaxWaitMs,
    maxBatchMessages: stored.maxBatchMessages ?? config.routing.maxBatchMessages,
    humanIdleMs: stored.humanIdleMs ?? config.routing.humanIdleMs,
    handoffPauseMs: stored.handoffPauseMs ?? config.routing.handoffPauseMs,
  };
}

/** Current "HH:mm" in the given timezone. Falls back to UTC on a bad zone. */
export function timeInZone(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
    // Some engines render midnight as "24" in hour12:false mode.
    return `${hour === "24" ? "00" : hour}:${minute}`;
  } catch {
    return `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  }
}

/**
 * True when `now` falls inside [start, end). A window whose start equals its
 * end means "all day". Overnight windows (start > end) wrap around midnight.
 */
export function isWithinWindow(now: Date, start: string, end: string, timezone: string): boolean {
  if (start === end) return true;
  const current = timeInZone(now, timezone);
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

/** True when the AI window is active for the given routing config. */
export function isAiWindowActive(routing: ResolvedRouting, now = new Date()): boolean {
  return isWithinWindow(now, routing.aiWindowStart, routing.aiWindowEnd, routing.timezone);
}
