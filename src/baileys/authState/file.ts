import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type AuthenticationState, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { decodeMetadataSecrets, encodeMetadataSecrets } from "@/baileys/authState/metadataSecrets";
import config from "@/config";
import logger from "@/lib/logger";
import { isRedisAvailable } from "@/lib/redis";
import { assertValidSessionId } from "@/lib/sessionId";

const SESSIONS_DIR = join(process.cwd(), "sessions");

function ensureSessionsDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function getSessionDir(sessionId: string): string {
  assertValidSessionId(sessionId);
  return join(SESSIONS_DIR, `md_${sessionId}`);
}

function getMetadataFile(sessionId: string): string {
  return join(getSessionDir(sessionId), "metadata.json");
}

export async function useFileAuthState(
  sessionId: string,
  metadata?: unknown,
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  ensureSessionsDir();
  const sessionDir = getSessionDir(sessionId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  if (metadata) {
    saveFileSessionMetadata(sessionId, metadata);
  }
  logger.debug("[File Auth] Using file auth state for session: %s", sessionId);
  return { state, saveCreds };
}

/**
 * Get all saved session IDs from file system.
 */
export function getFileSavedSessionIds(): string[] {
  ensureSessionsDir();
  try {
    return (
      readdirSync(SESSIONS_DIR)
        .filter((name) => name.startsWith("md_"))
        .map((name) => name.slice(3))
        // A directory without creds.json is an interrupted create, not a session.
        .filter((id) => existsSync(join(SESSIONS_DIR, `md_${id}`, "creds.json")))
    );
  } catch {
    return [];
  }
}

export function saveFileSessionMetadata(sessionId: string, metadata: unknown): void {
  ensureSessionsDir();
  const sessionDir = getSessionDir(sessionId);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  const metadataFile = getMetadataFile(sessionId);
  writeFileSync(metadataFile, JSON.stringify(encodeMetadataSecrets(metadata)), "utf-8");
}

export function getFileSavedSessionsWithMetadata<T>(): Array<{ id: string; metadata: T | null }> {
  const ids = getFileSavedSessionIds();
  return ids.map((id) => {
    const metadataFile = getMetadataFile(id);
    if (!existsSync(metadataFile)) {
      return { id, metadata: null };
    }
    try {
      const raw = readFileSync(metadataFile, "utf-8");
      const parsed = JSON.parse(raw) as T;
      return { id, metadata: decodeMetadataSecrets(parsed) };
    } catch {
      return { id, metadata: null };
    }
  });
}

/**
 * Delete file auth state and store for a session.
 * Cleans up: auth folder (sessions/md_<id>/) + store file (sessions/<id>_store.json)
 */
export function deleteFileAuthState(sessionId: string): void {
  // Delete auth state folder
  const sessionDir = getSessionDir(sessionId);
  rmSync(sessionDir, { force: true, recursive: true });

  // Delete store JSON file
  assertValidSessionId(sessionId);
  const storeFile = join(SESSIONS_DIR, `${sessionId}_store.json`);
  rmSync(storeFile, { force: true });

  logger.info("[File Auth] Deleted auth state + store for session: %s", sessionId);
}

const ORPHAN_STORE_AGE_MS = 60 * 60 * 1000;
const INCOMPLETE_DIR_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Remove leftovers that deletion/reconnect can leave behind:
 * - temp files older than an hour;
 * - store JSON with no matching md_<id> directory older than an hour;
 * - md_<id> directories without creds.json older than a day (interrupted creates).
 *
 * Directories that still hold creds.json are never removed: they are sessions.
 */
export function cleanupOrphanSessionFiles(): { removed: string[] } {
  ensureSessionsDir();
  const removed: string[] = [];
  const now = Date.now();
  const entries = readdirSync(SESSIONS_DIR, { withFileTypes: true });
  const sessionDirs = new Set<string>();
  const fileBackend =
    config.authState.backend === "file" ||
    (config.authState.backend === "auto" && !isRedisAvailable());

  for (const entry of entries) {
    if (!fileBackend) break;
    if (!entry.isDirectory() || !entry.name.startsWith("md_")) continue;
    const id = entry.name.slice(3);
    sessionDirs.add(id);
    if (existsSync(join(SESSIONS_DIR, entry.name, "creds.json"))) continue;

    try {
      const stats = statSync(join(SESSIONS_DIR, entry.name));
      if (now - stats.mtimeMs > INCOMPLETE_DIR_AGE_MS) {
        rmSync(join(SESSIONS_DIR, entry.name), { recursive: true, force: true });
        sessionDirs.delete(id);
        removed.push(entry.name);
      }
    } catch {
      // Best effort.
    }
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const isTemp = entry.name.includes(".tmp");
    const isStore = entry.name.endsWith("_store.json");
    if (!isTemp && !isStore) continue;
    // Stores can belong to Redis-backed sessions, so only reap them on files.
    if (isStore && !fileBackend) continue;
    if (isStore && sessionDirs.has(entry.name.replace(/_store\.json$/, ""))) continue;

    try {
      const stats = statSync(join(SESSIONS_DIR, entry.name));
      if (now - stats.mtimeMs > ORPHAN_STORE_AGE_MS) {
        rmSync(join(SESSIONS_DIR, entry.name), { force: true });
        removed.push(entry.name);
      }
    } catch {
      // Best effort.
    }
  }

  return { removed };
}
