import type { AnyMessageContent } from "@whiskeysockets/baileys";
import connectionManager from "@/baileys/connectionManager";
import type { BroadcastJob, BroadcastMessage } from "@/baileys/types";
import config from "@/config";
import logger from "@/lib/logger";
import { asyncSleep, distributedDelay } from "@/utils/asyncSleep";
import { formatPhone } from "@/utils/phone";
import { errorToString } from "@/utils/validation";

const jobs = new Map<string, BroadcastJob>();

/** Generate the next inter-message delay honoring the configured distribution. */
function nextDelayMs(customDelay: number | undefined, lo: number, hi: number): number {
  if (customDelay !== undefined) return customDelay;
  return distributedDelay(config.broadcast.delayDistribution, lo, hi);
}

/**
 * Broadcast is a background bulk operation: typing bubbles per recipient are
 * both odd (you don't type to each contact) and an extra per-message delay.
 * Off unless the operator explicitly enables BROADCAST_TYPING_SIMULATION.
 */
function broadcastSimulateTyping(): boolean {
  return config.broadcast.typingSimulation;
}

/** Maximum age of completed jobs before cleanup (1 hour) */
const MAX_JOB_AGE_MS = 3600_000;
/** Maximum total jobs stored in memory */
const MAX_JOBS = 200;
/** Cleanup interval (5 minutes) */
const CLEANUP_INTERVAL_MS = 300_000;

function generateJobId(): string {
  return `bc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Create and start a broadcast job.
 */
export async function createBroadcastJob(
  sessionId: string,
  messages: BroadcastMessage[],
): Promise<BroadcastJob> {
  // Enforce max per-job limit
  if (messages.length > 1000) {
    throw new Error("Maximum 1000 messages per broadcast job");
  }

  // Clean up old jobs before creating new ones
  cleanupOldJobs();

  const jobId = generateJobId();
  const job: BroadcastJob = {
    id: jobId,
    sessionId,
    messages,
    status: "pending",
    progress: 0,
    total: messages.length,
    errors: [],
    createdAt: Date.now(),
  };

  jobs.set(jobId, job);

  // Start processing in background
  processBroadcastJob(job).catch((err) => {
    logger.error("[Broadcast:%s] Fatal error: %s", jobId, errorToString(err));
    job.status = "failed";
  });

  return job;
}

async function processBroadcastJob(job: BroadcastJob): Promise<void> {
  job.status = "running";
  const session = connectionManager.getSession(job.sessionId);
  const { minDelayMs, maxDelayMs, batchSize, batchPauseMs, batchCheckWa, checkWaBatchSize } =
    config.broadcast;

  // Batch pre-check of recipient WA registration (fewer usync queries than
  // 1-by-1) when enabled. Default (false) keeps the legacy per-recipient check.
  const validJids = new Set<string>();
  const invalidByIndex = new Map<number, string>(); // index -> receiver
  if (batchCheckWa) {
    const chunkSize = checkWaBatchSize > 0 ? checkWaBatchSize : 50;
    for (let i = 0; i < job.messages.length; i += chunkSize) {
      const chunk = job.messages.slice(i, i + chunkSize);
      const chunkJids = chunk.map((m) => formatPhone(m.receiver));
      const registered = await session.checkOnWhatsAppBatch(chunkJids);
      chunk.forEach((m, offset) => {
        const jid = chunkJids[offset];
        if (registered.has(jid)) {
          validJids.add(jid);
        } else {
          invalidByIndex.set(i + offset, m.receiver);
        }
      });
    }
  }

  for (let i = 0; i < job.messages.length; i++) {
    if ((job.status as string) === "cancelled") {
      logger.info("[Broadcast:%s] Cancelled at %d/%d", job.id, i, job.total);
      job.messages = []; // Free memory immediately
      return;
    }

    const { receiver, message, delay: customDelay } = job.messages[i];
    const jid = formatPhone(receiver);

    try {
      // When batch-checking, skip jids already known invalid (skip re-check).
      if (batchCheckWa && invalidByIndex.has(i)) {
        job.errors.push({
          index: i,
          receiver,
          error: "Number not registered on WhatsApp",
        });
        job.progress = i + 1;
        job.messages[i].message = {} as any;

        // Still honor inter-message delay for a human cadence
        if (i < job.messages.length - 1) {
          const d = nextDelayMs(customDelay, minDelayMs, maxDelayMs);
          await asyncSleep(d);
          if ((i + 1) % batchSize === 0) await asyncSleep(batchPauseMs);
        }
        continue;
      }

      // Check if number exists (1-by-1 unless already batch-verified valid)
      const exists = batchCheckWa ? validJids.has(jid) : await session.isOnWhatsApp(jid);
      if (!exists) {
        job.errors.push({
          index: i,
          receiver,
          error: "Number not registered on WhatsApp",
        });
        job.progress = i + 1;
      } else {
        // Send message — no typing bubble per recipient unless explicitly enabled
        await session.sendMessage(jid, message as AnyMessageContent, {
          simulateTyping: broadcastSimulateTyping(),
        });
        job.progress = i + 1;
        logger.debug("[Broadcast:%s] Sent %d/%d to %s", job.id, i + 1, job.total, receiver);
      }

      // Free message payload memory immediately after sending/failing (critical for base64 media)
      job.messages[i].message = {} as any;

      // Delay between messages
      if (i < job.messages.length - 1) {
        const delayMs = nextDelayMs(customDelay, minDelayMs, maxDelayMs);
        await asyncSleep(delayMs);

        // Batch pause
        if ((i + 1) % batchSize === 0) {
          logger.info(
            "[Broadcast:%s] Batch pause at %d/%d (%dms)",
            job.id,
            i + 1,
            job.total,
            batchPauseMs,
          );
          await asyncSleep(batchPauseMs);
        }
      }
    } catch (error) {
      job.errors.push({
        index: i,
        receiver,
        error: errorToString(error),
      });
      job.progress = i + 1;

      // Free memory even on error
      job.messages[i].message = {} as any;

      logger.error(
        "[Broadcast:%s] Error sending to %s: %s",
        job.id,
        receiver,
        errorToString(error),
      );
    }
  }

  job.status = job.errors.length === job.total ? "failed" : "completed";

  // Clear message references to free memory after completion
  job.messages = [];

  logger.info(
    "[Broadcast:%s] Completed (%d/%d sent, %d errors)",
    job.id,
    job.total - job.errors.length,
    job.total,
    job.errors.length,
  );
}

/**
 * Clean up old completed/failed/cancelled jobs to prevent memory leaks.
 */
function cleanupOldJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (
      job.status !== "running" &&
      job.status !== "pending" &&
      now - job.createdAt > MAX_JOB_AGE_MS
    ) {
      jobs.delete(id);
    }
  }

  // Hard cap: remove oldest completed jobs if over limit
  if (jobs.size > MAX_JOBS) {
    const completedJobs = [...jobs.entries()]
      .filter(([, j]) => j.status !== "running" && j.status !== "pending")
      .sort(([, a], [, b]) => a.createdAt - b.createdAt);

    for (const [id] of completedJobs.slice(0, jobs.size - MAX_JOBS)) {
      jobs.delete(id);
    }
  }
}

// Periodic cleanup every 5 minutes
setInterval(cleanupOldJobs, CLEANUP_INTERVAL_MS);

export function getBroadcastJob(jobId: string): BroadcastJob | undefined {
  return jobs.get(jobId);
}

export function cancelBroadcastJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (job && job.status === "running") {
    job.status = "cancelled";
    return true;
  }
  return false;
}

export function listBroadcastJobs(sessionId?: string): BroadcastJob[] {
  const all = [...jobs.values()];
  return sessionId ? all.filter((j) => j.sessionId === sessionId) : all;
}
