import fs from "node:fs";
import path from "node:path";
import config from "@/config";
import logger from "@/lib/logger";

/**
 * Dead-letter buffer for webhook deliveries that exhausted all retries.
 *
 * Without this, an event that fails permanently (receiver down for a long
 * stretch, persistent 5xx, ...) is only logged and then LOST. For important
 * third-party integrations (payments, notifications, CRM sync) that silent
 * drop is data loss.
 *
 * Design:
 * - In-memory ring buffer, capped at MAX_ENTRIES.
 * - Optional disk persistence (JSONL append) when WEBHOOK_DEAD_LETTER_ENABLED
 *   and WEBHOOK_DEAD_LETTER_DIR are set — survives process restarts.
 * - Replay re-sends a stored payload through the normal delivery path.
 *
 * Default: DISABLED (buffer empty, nothing persisted) = legacy behavior where
 * failed webhooks are simply dropped after retries.
 */

export interface DeadLetterEntry {
  id: string;
  sessionId: string;
  event: string;
  webhookUrl: string;
  webhookSecret?: string;
  payload: unknown;
  failedAt: number;
  attempts: number;
  lastError: string;
  status: "queued" | "retrying";
}

const MAX_ENTRIES = 500;
const entries: DeadLetterEntry[] = [];

function deadLetterDir(): string | null {
  const dir = config.webhook.deadLetterDir;
  return config.webhook.deadLetterEnabled && dir ? dir : null;
}

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore — persistence is best-effort */
  }
}

function persistAppend(entry: DeadLetterEntry): void {
  const dir = deadLetterDir();
  if (!dir) return;
  try {
    ensureDir(dir);
    // Do not persist the signing secret: replay resolves the current one from
    // the session, and an on-disk JSONL must not become a credential leak.
    fs.appendFileSync(
      path.join(dir, "webhook-dead-letter.jsonl"),
      `${JSON.stringify({ ...entry, webhookSecret: undefined })}\n`,
      "utf8",
    );
  } catch (err) {
    logger.warn("webhook-dead-letter: persist failed: %s", (err as Error).message);
  }
}

export function addToDeadLetter(input: {
  sessionId: string;
  event: string;
  webhookUrl: string;
  webhookSecret?: string;
  payload: unknown;
  attempts: number;
  lastError: string;
}): DeadLetterEntry | null {
  if (!config.webhook.deadLetterEnabled) return null;
  const entry: DeadLetterEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
    failedAt: Date.now(),
    status: "queued",
  };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }
  persistAppend(entry);
  return entry;
}

export function getDeadLetters(limit = 50, sessionId?: string): DeadLetterEntry[] {
  const safe = Math.min(Math.max(limit, 1), MAX_ENTRIES);
  const filtered = sessionId ? entries.filter((e) => e.sessionId === sessionId) : entries;
  return filtered.slice(0, safe);
}

export function clearDeadLetters(): void {
  entries.length = 0;
}

/** Replay a single stored dead-letter via a caller-supplied delivery fn. */
export async function replayDeadLetter(
  id: string,
  deliver: (entry: DeadLetterEntry) => Promise<"success" | "failed">,
): Promise<"success" | "failed" | "not-found"> {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return "not-found";
  entry.status = "retrying";
  try {
    const result = await deliver(entry);
    if (result === "success") {
      const idx = entries.findIndex((e) => e.id === id);
      if (idx >= 0) entries.splice(idx, 1);
    } else {
      entry.status = "queued";
    }
    return result;
  } catch (err) {
    entry.status = "queued";
    logger.error("webhook-dead-letter: replay error: %s", (err as Error).message);
    // Best-effort by design: a replay failure must not crash the dashboard
    // request — report "failed" to the caller instead of throwing.
    return "failed";
  }
}

/** Replay all queued dead-letters (best-effort, sequential). */
export async function replayAllDeadLetters(
  deliver: (entry: DeadLetterEntry) => Promise<"success" | "failed">,
): Promise<{ replayed: number; succeeded: number }> {
  const targets = [...entries];
  let succeeded = 0;
  for (const entry of targets) {
    const result = await replayDeadLetter(entry.id, deliver);
    if (result === "success") succeeded++;
  }
  return { replayed: targets.length, succeeded };
}
