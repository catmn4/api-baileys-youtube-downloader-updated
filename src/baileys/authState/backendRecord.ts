import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AuthBackend = "file" | "redis";

export interface AuthBackendRecord {
  backend: AuthBackend;
  chosenAt: string;
  reason: string;
}

/**
 * Sticky record of the backend this installation decided to use.
 *
 * Without it, "auto" would re-decide on every start: an unreachable Redis
 * selects files, then a reachable Redis with sessions wins again, and sessions
 * written during the outage silently vanish from view. The record makes the
 * choice a one-time decision; changing it requires an explicit confirmation.
 */
const RECORD_PATH = join(process.cwd(), "data", "auth-state-backend.json");

export function readAuthBackendRecord(): AuthBackendRecord | null {
  if (!existsSync(RECORD_PATH)) return null;

  try {
    const parsed = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as Partial<AuthBackendRecord>;
    if (parsed.backend !== "file" && parsed.backend !== "redis") return null;
    return {
      backend: parsed.backend,
      chosenAt: typeof parsed.chosenAt === "string" ? parsed.chosenAt : "unknown",
      reason: typeof parsed.reason === "string" ? parsed.reason : "unknown",
    };
  } catch {
    return null;
  }
}

export function writeAuthBackendRecord(record: AuthBackendRecord): void {
  mkdirSync(dirname(RECORD_PATH), { recursive: true });
  const tmp = `${RECORD_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  renameSync(tmp, RECORD_PATH);
}
