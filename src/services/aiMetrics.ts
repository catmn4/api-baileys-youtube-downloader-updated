/**
 * In-memory AI routing metrics.
 *
 * Deliberately dependency-free: counters live in the running process, so they
 * are visible while the app is up (manual testing, debugging) and reset on
 * restart. Nothing is written to disk. When Redis-backed multi-instance
 * aggregation is needed, this module is the single place to swap the store.
 *
 * Hourly buckets use the routing timezone, so "AI vs human per hour" matches the
 * business window rather than the server clock.
 */
import { timeInZone } from "@/services/routing";

export type AiRoute = "ai" | "static" | "human" | "paused" | "failed" | "blocked" | "muted";

export interface AiDecision {
  at: number;
  sessionId: string;
  conversationId: string;
  route: AiRoute;
  reason?: string;
  latencyMs?: number;
  tools?: string[];
}

interface SessionCounters {
  ai: number;
  human: number;
  paused: number;
  static: number;
  failures: number;
  blocked: number;
  muted: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  latencySamples: number;
  latencyTotalMs: number;
  latencyMaxMs: number;
}

export interface AiMetricsSnapshot {
  since: number;
  counters: {
    aiReplies: number;
    staticReplies: number;
    humanSkips: number;
    pausedSkips: number;
    failures: number;
    blocked: number;
    muted: number;
    toolCalls: number;
    tokensIn: number;
    tokensOut: number;
  };
  latency: { samples: number; avgMs: number; maxMs: number };
  hourly: Array<{ hour: number; ai: number; human: number }>;
  bySession: Record<string, SessionCounters>;
  recent: AiDecision[];
}

const MAX_RECENT = 100;

let startedAt = Date.now();
let dayKey = "";
let hourly = createHourlyBuckets();
const bySession: Record<string, SessionCounters> = {};
const hourlyBySession: Record<string, Array<{ hour: number; ai: number; human: number }>> = {};
const recent: AiDecision[] = [];

const counters = {
  aiReplies: 0,
  staticReplies: 0,
  humanSkips: 0,
  pausedSkips: 0,
  failures: 0,
  blocked: 0,
  muted: 0,
  toolCalls: 0,
  tokensIn: 0,
  tokensOut: 0,
};

const latency = { samples: 0, totalMs: 0, maxMs: 0 };

function createHourlyBuckets(): Array<{ hour: number; ai: number; human: number }> {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, ai: 0, human: 0 }));
}

function ensureDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today === dayKey) return;
  dayKey = today;
  hourly = createHourlyBuckets();
}

function currentHour(): number {
  // timeInZone returns "HH:mm"; fall back to 0 on an unexpected value.
  const hour = Number(timeInZone(new Date(), "Asia/Jakarta").slice(0, 2));
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 0;
}

function sessionCounters(sessionId: string): SessionCounters {
  const existing = bySession[sessionId];
  if (existing) return existing;
  const created: SessionCounters = {
    ai: 0,
    human: 0,
    paused: 0,
    static: 0,
    failures: 0,
    blocked: 0,
    muted: 0,
    toolCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    latencySamples: 0,
    latencyTotalMs: 0,
    latencyMaxMs: 0,
  };
  bySession[sessionId] = created;
  return created;
}

function sessionHourly(sessionId: string): Array<{ hour: number; ai: number; human: number }> {
  const existing = hourlyBySession[sessionId];
  if (existing) return existing;
  const created = createHourlyBuckets();
  hourlyBySession[sessionId] = created;
  return created;
}

/** Record one routing decision (one inbound event handled by a responder). */
export function recordDecision(input: Omit<AiDecision, "at"> & { at?: number }): void {
  ensureDay();
  const decision: AiDecision = { at: input.at ?? Date.now(), ...input };
  recent.push(decision);
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);

  const perSession = sessionCounters(decision.sessionId);
  const perHourly = sessionHourly(decision.sessionId);
  const hour = currentHour();

  switch (decision.route) {
    case "ai":
      counters.aiReplies += 1;
      perSession.ai += 1;
      hourly[hour]!.ai += 1;
      perHourly[hour]!.ai += 1;
      if (decision.tools && decision.tools.length > 0) {
        counters.toolCalls += decision.tools.length;
        perSession.toolCalls += decision.tools.length;
      }
      break;
    case "static":
      counters.staticReplies += 1;
      perSession.static += 1;
      break;
    case "human":
      counters.humanSkips += 1;
      perSession.human += 1;
      hourly[hour]!.human += 1;
      perHourly[hour]!.human += 1;
      break;
    case "paused":
      counters.pausedSkips += 1;
      perSession.human += 1;
      perSession.paused += 1;
      hourly[hour]!.human += 1;
      perHourly[hour]!.human += 1;
      break;
    case "failed":
      counters.failures += 1;
      perSession.failures += 1;
      break;
    case "blocked":
      counters.blocked += 1;
      perSession.blocked += 1;
      break;
    case "muted":
      counters.muted += 1;
      perSession.muted += 1;
      break;
  }
}

/** Record provider token usage and call latency for one AI reply. */
export function recordUsage(
  usage: { promptTokens?: number; completionTokens?: number } | undefined,
  latencyMs: number,
  sessionId?: string,
): void {
  const prompt = usage?.promptTokens ?? 0;
  const completion = usage?.completionTokens ?? 0;
  const elapsed = Math.max(0, latencyMs);
  counters.tokensIn += prompt;
  counters.tokensOut += completion;
  latency.samples += 1;
  latency.totalMs += elapsed;
  latency.maxMs = Math.max(latency.maxMs, elapsed);

  if (sessionId) {
    const perSession = sessionCounters(sessionId);
    perSession.tokensIn += prompt;
    perSession.tokensOut += completion;
    perSession.latencySamples += 1;
    perSession.latencyTotalMs += elapsed;
    perSession.latencyMaxMs = Math.max(perSession.latencyMaxMs, elapsed);
  }
}

/** Snapshot for the dashboard; optionally filtered to one session. */
export function getAiMetrics(sessionId?: string): AiMetricsSnapshot {
  ensureDay();
  const scoped = sessionId ? recent.filter((entry) => entry.sessionId === sessionId) : recent;
  const per = sessionId ? sessionCounters(sessionId) : null;
  return {
    since: startedAt,
    counters: per
      ? {
          aiReplies: per.ai,
          staticReplies: per.static,
          humanSkips: per.human,
          pausedSkips: per.paused,
          failures: per.failures,
          blocked: per.blocked,
          muted: per.muted,
          toolCalls: per.toolCalls,
          tokensIn: per.tokensIn,
          tokensOut: per.tokensOut,
        }
      : { ...counters },
    latency: per
      ? {
          samples: per.latencySamples,
          avgMs: per.latencySamples > 0 ? Math.round(per.latencyTotalMs / per.latencySamples) : 0,
          maxMs: Math.round(per.latencyMaxMs),
        }
      : {
          samples: latency.samples,
          avgMs: latency.samples > 0 ? Math.round(latency.totalMs / latency.samples) : 0,
          maxMs: Math.round(latency.maxMs),
        },
    hourly: (sessionId ? sessionHourly(sessionId) : hourly).map((bucket) => ({ ...bucket })),
    bySession: sessionId
      ? { [sessionId]: { ...(per ?? sessionCounters(sessionId)) } }
      : Object.fromEntries(Object.entries(bySession).map(([key, value]) => [key, { ...value }])),
    recent: scoped.slice(-50).reverse(),
  };
}

/** Clear every counter (dashboard action). */
export function resetAiMetrics(): void {
  startedAt = Date.now();
  hourly = createHourlyBuckets();
  recent.length = 0;
  for (const key of Object.keys(bySession)) delete bySession[key];
  for (const key of Object.keys(hourlyBySession)) delete hourlyBySession[key];
  counters.aiReplies = 0;
  counters.staticReplies = 0;
  counters.humanSkips = 0;
  counters.pausedSkips = 0;
  counters.failures = 0;
  counters.blocked = 0;
  counters.muted = 0;
  counters.toolCalls = 0;
  counters.tokensIn = 0;
  counters.tokensOut = 0;
  latency.samples = 0;
  latency.totalMs = 0;
  latency.maxMs = 0;
}
