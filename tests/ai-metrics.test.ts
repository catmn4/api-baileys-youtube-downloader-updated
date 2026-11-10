import { afterAll, expect, test } from "bun:test";
import { getAiMetrics, recordDecision, recordUsage, resetAiMetrics } from "@/services/aiMetrics";

afterAll(() => resetAiMetrics());

test("session-scoped metrics never include another session's activity", () => {
  resetAiMetrics();
  recordDecision({ sessionId: "a", conversationId: "chat-a", route: "ai", tools: ["tool"] });
  recordUsage({ promptTokens: 10, completionTokens: 5 }, 100, "a");
  recordDecision({ sessionId: "b", conversationId: "chat-b", route: "human" });
  recordUsage({ promptTokens: 99, completionTokens: 1 }, 200, "b");

  const scoped = getAiMetrics("a");
  expect(scoped.counters.aiReplies).toBe(1);
  expect(scoped.counters.humanSkips).toBe(0);
  expect(scoped.counters.tokensIn).toBe(10);
  expect(scoped.counters.tokensOut).toBe(5);
  expect(scoped.counters.toolCalls).toBe(1);
  expect(scoped.latency.samples).toBe(1);
  expect(scoped.hourly.reduce((total, bucket) => total + bucket.human, 0)).toBe(0);
  expect(scoped.recent.every((entry) => entry.sessionId === "a")).toBe(true);

  const global = getAiMetrics();
  expect(global.counters.aiReplies).toBe(1);
  expect(global.counters.humanSkips).toBe(1);
  expect(global.counters.tokensIn).toBe(109);
  expect(global.recent).toHaveLength(2);
});
