import type { AuthenticationState } from "@whiskeysockets/baileys";
import config from "@/config";
import logger from "@/lib/logger";
import { isRedisAvailable } from "@/lib/redis";
import {
  type AuthBackend,
  type AuthBackendRecord,
  readAuthBackendRecord,
  writeAuthBackendRecord,
} from "./backendRecord";
import {
  deleteFileAuthState,
  getFileSavedSessionIds,
  getFileSavedSessionsWithMetadata,
  saveFileSessionMetadata,
  useFileAuthState,
} from "./file";
import {
  deleteRedisAuthState,
  getRedisSavedSessionIds,
  updateRedisSessionMetadata,
  useRedisAuthState,
} from "./redis";

export interface AuthStateResult {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearState?: () => Promise<void>;
}

interface BackendDecision {
  backend: AuthBackend;
  reason: string;
}

let decision: BackendDecision | null = null;
let pendingRecord: AuthBackendRecord | null = null;

const SWITCH_HINT =
  "Sessions are not migrated and the old store is kept untouched. Re-run with AUTH_STATE_SWITCH_CONFIRM=true to switch: the app then starts on the new store (empty until you re-link by QR).";

/**
 * Resolve the auth-store backend once per process.
 *
 * The first successful start records the choice in data/auth-state-backend.json
 * and later starts stick to it. That is what stops "auto" from moving the store
 * when Redis becomes reachable again: sessions written during an outage stay in
 * the recorded store instead of disappearing from view.
 */
async function resolveBackend(): Promise<AuthBackend> {
  if (decision) return decision.backend;

  const configured = config.authState.backend;
  const record = readAuthBackendRecord();

  if (record) {
    if (configured !== "auto" && configured !== record.backend) {
      if (!config.authState.switchConfirm) {
        throw new Error(
          `Auth backend switch requested (configured=${configured}, recorded=${record.backend}). ${SWITCH_HINT}`,
        );
      }

      if (configured === "redis" && !isRedisAvailable()) {
        throw new Error(
          "AUTH_STATE_BACKEND=redis but Redis is not available (check REDIS_ENABLED / REDIS_URL). Fix Redis before switching; the recorded store was left untouched.",
        );
      }

      const reason = `confirmed switch from ${record.backend} to ${configured}`;
      writeAuthBackendRecord({
        backend: configured,
        chosenAt: new Date().toISOString(),
        reason,
      });
      logger.warn(
        "[AuthState] %s — unset AUTH_STATE_SWITCH_CONFIRM. Sessions in %s were not deleted.",
        reason,
        record.backend,
      );
      decision = { backend: configured, reason };
      logger.info("[AuthState] backend=%s (%s)", configured, reason);
      return configured;
    }

    if (record.backend === "redis" && !isRedisAvailable()) {
      throw new Error(
        "Recorded auth backend is redis but Redis is unreachable. Refusing to fall back to files: sessions written while Redis is down would diverge from the recorded store. Restore Redis, or switch deliberately with AUTH_STATE_BACKEND=file and AUTH_STATE_SWITCH_CONFIRM=true.",
      );
    }

    decision = { backend: record.backend, reason: `recorded backend (chosen ${record.chosenAt})` };
    logger.info("[AuthState] backend=%s (%s)", record.backend, decision.reason);
    return record.backend;
  }

  let backend: AuthBackend;
  let reason: string;

  if (configured === "file") {
    backend = "file";
    reason = "first run: explicit AUTH_STATE_BACKEND=file";
  } else if (configured === "redis") {
    if (!isRedisAvailable()) {
      throw new Error(
        "AUTH_STATE_BACKEND=redis but Redis is not available (check REDIS_ENABLED / REDIS_URL). Refusing to start with an empty session store.",
      );
    }
    backend = "redis";
    reason = "first run: explicit AUTH_STATE_BACKEND=redis";
  } else if (!isRedisAvailable()) {
    backend = "file";
    reason = "first run: auto, Redis unreachable";
  } else {
    const redisSessions = await getRedisSavedSessionIds();
    const fileIds = getFileSavedSessionIds();

    if (redisSessions.length === 0 && fileIds.length > 0) {
      backend = "file";
      reason = `first run: auto, Redis empty but ${fileIds.length} session(s) on disk`;
      logger.warn("[AuthState] %s — pinning files so those sessions stay reachable", reason);
    } else if (redisSessions.length > 0 && fileIds.length > 0) {
      backend = "redis";
      reason = `first run: auto, sessions in both stores (redis=${redisSessions.length}, file=${fileIds.length}); pinning Redis, set AUTH_STATE_BACKEND explicitly to make it deliberate`;
      logger.warn("[AuthState] %s", reason);
    } else {
      backend = "redis";
      reason = `first run: auto, Redis reachable (${redisSessions.length} session(s))`;
    }
  }

  pendingRecord = { backend, chosenAt: new Date().toISOString(), reason };
  decision = { backend, reason };
  return backend;
}

/**
 * Persist a first-run decision only after the consistency guard passed, so a
 * refused start cannot leave a record that lets the next start through.
 */
function persistBackendDecision(): void {
  if (!pendingRecord) return;
  writeAuthBackendRecord(pendingRecord);
  logger.info(
    "[AuthState] backend=%s recorded for future starts (%s)",
    pendingRecord.backend,
    pendingRecord.reason,
  );
  pendingRecord = null;
}

/**
 * Guard for first-run explicit choices: refuse to start when the configured
 * store disagrees with where sessions already live. Recorded installations are
 * skipped because their backend is deliberate; switching them needs the
 * confirmed override.
 */
export async function assertAuthStateBackendConsistency(): Promise<void> {
  const hadRecord = readAuthBackendRecord() !== null;
  const backend = await resolveBackend();

  if (!hadRecord && config.authState.backend !== "auto") {
    const fileIds = getFileSavedSessionIds();
    const redisSessions = backend === "redis" ? await getRedisSavedSessionIds() : [];
    const redisIds = redisSessions.map((row) => row.id);

    if (backend === "redis" && redisIds.length === 0 && fileIds.length > 0) {
      throw new Error(
        `Auth backend mismatch: AUTH_STATE_BACKEND=redis, but ${fileIds.length} session(s) exist on disk and Redis holds none. ${SWITCH_HINT}`,
      );
    }

    if (backend === "file" && fileIds.length === 0 && isRedisAvailable()) {
      const redisList = await getRedisSavedSessionIds();
      if (redisList.length > 0) {
        throw new Error(
          `Auth backend mismatch: AUTH_STATE_BACKEND=file, but Redis holds ${redisList.length} session(s) and the filesystem has none. ${SWITCH_HINT}`,
        );
      }
    }
  }

  persistBackendDecision();
}

/**
 * Factory: auto-select auth state based on Redis availability.
 */
export async function useAuthState(
  sessionId: string,
  metadata?: unknown,
): Promise<AuthStateResult> {
  if ((await resolveBackend()) === "redis") {
    logger.info("[AuthState] Using Redis auth state for session: %s", sessionId);
    const { state, saveCreds } = await useRedisAuthState(sessionId, metadata);
    return {
      state,
      saveCreds,
      clearState: state.keys.clear as () => Promise<void>,
    };
  }

  logger.info("[AuthState] Using file auth state for session: %s", sessionId);
  const { state, saveCreds } = await useFileAuthState(sessionId, metadata);
  return { state, saveCreds };
}

/**
 * Get all saved session IDs from whichever store is active.
 */
export async function getSavedSessionIds(): Promise<string[]> {
  if ((await resolveBackend()) === "redis") {
    const sessions = await getRedisSavedSessionIds();
    return sessions.map((s) => s.id);
  }
  return getFileSavedSessionIds();
}

/**
 * Get saved session IDs with metadata (Redis only; file returns empty metadata).
 */
export async function getSavedSessionsWithMetadata<T>(): Promise<
  Array<{ id: string; metadata: T | null }>
> {
  if ((await resolveBackend()) === "redis") {
    return getRedisSavedSessionIds<T>();
  }
  return getFileSavedSessionsWithMetadata<T>();
}

export async function updateSessionMetadata(sessionId: string, metadata: unknown): Promise<void> {
  if ((await resolveBackend()) === "redis") {
    await updateRedisSessionMetadata(sessionId, metadata);
    return;
  }
  saveFileSessionMetadata(sessionId, metadata);
}

/**
 * Delete auth state for a session.
 * Also cleans up the store JSON file regardless of auth backend.
 */
export async function deleteAuthState(sessionId: string): Promise<void> {
  if ((await resolveBackend()) === "redis") {
    await deleteRedisAuthState(sessionId);
  }
  // Always clean up file-based data (auth folder + store JSON)
  // Store file lives on filesystem even when using Redis auth
  deleteFileAuthState(sessionId);
}
