/**
 * Inbound API audit log.
 *
 * Records who called the send API, for which session, with what outcome. The
 * message body is not stored unless explicitly enabled, and tokens are never
 * written: only the key's short id and label.
 *
 * Entries live in a bounded in-memory ring for fast reads and are appended to a
 * daily JSONL file under logs/ for auditability across restarts.
 */
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import config from "@/config";
import logger from "@/lib/logger";

export interface ApiAuditEntry {
  timestamp: string;
  requestId: string;
  keyId: string | null;
  keyLabel: string | null;
  session: string | null;
  receiver: string | null;
  type: string;
  status: number;
  latencyMs: number;
  ip: string;
  body?: string;
}

export interface ApiAuditFilter {
  limit?: number;
  session?: string;
  status?: number;
  keyId?: string;
}

const LOG_DIR = join(process.cwd(), "logs");
const MAX_RING = config.auditLog.maxEntries;
const ring: ApiAuditEntry[] = [];

function fileFor(date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return join(LOG_DIR, `api-audit-${day}.jsonl`);
}

function pruneOldFiles(): void {
  if (!existsSync(LOG_DIR)) return;
  const cutoff = Date.now() - config.auditLog.retentionDays * 24 * 60 * 60 * 1000;

  for (const name of readdirSync(LOG_DIR)) {
    const match = /^api-audit-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!match?.[1]) continue;
    const stamp = Date.parse(`${match[1]}T00:00:00Z`);
    if (Number.isFinite(stamp) && stamp < cutoff) {
      try {
        unlinkSync(join(LOG_DIR, name));
      } catch {
        // A file being read by an external tool can fail to delete; ignore.
      }
    }
  }
}

let lastPrune = 0;

/** Mask a phone number or JID, keeping enough to recognise it in an audit. */
export function maskReceiver(receiver: string): string {
  const [local, domain] = receiver.split("@");
  if (!local) return receiver;
  const visibleHead = local.slice(0, 4);
  const visibleTail = local.length > 6 ? local.slice(-2) : "";
  return `${visibleHead}${"*".repeat(Math.max(2, local.length - visibleHead.length - visibleTail.length))}${visibleTail}${domain ? `@${domain}` : ""}`;
}

export function recordApiCall(entry: ApiAuditEntry): void {
  if (!config.auditLog.enabled) return;

  const record: ApiAuditEntry = config.auditLog.body ? entry : { ...entry, body: undefined };

  ring.push(record);
  if (ring.length > MAX_RING) ring.splice(0, ring.length - MAX_RING);

  try {
    mkdirSync(LOG_DIR, { recursive: true });
    // Fire-and-forget: a slow disk must not block an API response.
    void appendFile(fileFor(new Date()), `${JSON.stringify(record)}\n`, "utf8").catch((error) => {
      logger.warn("[Audit] Failed to persist API call: %s", (error as Error).message);
    });

    const now = Date.now();
    if (now - lastPrune > 60 * 60 * 1000) {
      lastPrune = now;
      pruneOldFiles();
    }
  } catch (error) {
    logger.warn("[Audit] Failed to persist API call: %s", (error as Error).message);
  }
}

export function listApiCalls(filter: ApiAuditFilter = {}): ApiAuditEntry[] {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
  return ring
    .filter((entry) => {
      if (filter.session && entry.session !== filter.session) return false;
      if (typeof filter.status === "number" && entry.status !== filter.status) return false;
      if (filter.keyId && entry.keyId !== filter.keyId) return false;
      return true;
    })
    .slice(-limit)
    .reverse();
}
