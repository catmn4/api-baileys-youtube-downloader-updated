import { afterEach, describe, expect, test } from "bun:test";
import type { ResolvedAiConfig } from "@/services/aiAgent";
import { generateAgentReply } from "@/services/aiAgent";
import {
  buildSendMessageGuidance,
  buildSendMessageToolSchema,
  consumeSendQuota,
  isReceiverAllowed,
  SEND_MESSAGE_TOOL_NAME,
} from "@/services/aiSendTool";
import { buildRuntimeContext } from "@/services/runtimeContext";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("runtime date/time context", () => {
  test("renders full local date, time, timezone and ISO", () => {
    const block = buildRuntimeContext(new Date("2026-11-04T02:02:25.356Z"), "Asia/Jakarta");
    expect(block).toContain("<get_info");
    expect(block).toContain("Wednesday, 4 November 2026");
    expect(block).toContain("09:02:25");
    expect(block).toContain("Asia/Jakarta");
    expect(block).toContain("UTC+07:00");
    expect(block).toContain("2026-11-04T02:02:25.356Z");
    expect(block).not.toContain("priority=");
  });

  test("invalid timezone degrades to UTC instead of throwing", () => {
    const block = buildRuntimeContext(new Date("2026-01-01T00:00:00.000Z"), "Not/AZone");
    expect(block).toContain("Timezone: UTC");
  });
});

describe("built-in send tool schema", () => {
  test("allowlist/any expose receiver and guidance", () => {
    const tool = buildSendMessageToolSchema("allowlist");
    const properties = tool.function.parameters.properties as Record<string, unknown>;
    expect(properties.receiver).toBeDefined();
    expect(
      buildSendMessageGuidance({
        enabled: true,
        scope: "allowlist",
        allowlist: [],
        maxPerHour: 5,
      }),
    ).toContain("allowlisted");
  });

  test("allowlist matches numbers by digits and JIDs exactly", () => {
    expect(isReceiverAllowed("+62 812-3456-789", ["628123456789"])).toBe(true);
    expect(isReceiverAllowed("628123456789@s.whatsapp.net", ["628123456789"])).toBe(true);
    expect(isReceiverAllowed("628000000000", ["628123456789"])).toBe(false);
    expect(isReceiverAllowed("123@lid", ["123@lid"])).toBe(true);
    expect(isReceiverAllowed("123@lid", ["456@lid"])).toBe(false);
  });

  test("hourly bucket rejects over the cap and recovers after the window", () => {
    const bucket: number[] = [];
    const t = 1_000_000;
    expect(consumeSendQuota(bucket, 2, t)).toBe(true);
    expect(consumeSendQuota(bucket, 2, t + 1)).toBe(true);
    expect(consumeSendQuota(bucket, 2, t + 2)).toBe(false);
    expect(consumeSendQuota(bucket, 2, t + 60 * 60 * 1000 + 1)).toBe(true);
  });
});

describe("generateAgentReply runtime integration", () => {
  test("sends the date block and built-in tool, and executes a tool call", async () => {
    const requests: Array<Record<string, unknown>> = [];
    let sendInput: { receiver?: string; text: string } | undefined;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: SEND_MESSAGE_TOOL_NAME,
                        arguments: JSON.stringify({ text: "Halo dari AI" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Pesan terkirim." } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const ai: ResolvedAiConfig = {
      enabled: true,
      mode: "always",
      driver: "openai",
      baseUrl: "https://provider.example/v1",
      model: "test-model",
      apiKey: "test-key",
      temperature: 0.5,
      topP: 1,
      minP: 0,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxTokens: 100,
      timeoutMs: 1000,
      toolMaxRounds: 2,
      agentUrl: "",
      systemInstruction: "You are a helpful assistant.",
      ragEndpoints: [],
      credentials: {},
      sendMessage: {
        enabled: true,
        scope: "allowlist",
        allowlist: [],
        maxPerHour: 5,
      },
      vision: { enabled: false, model: "" },
    };

    const result = await generateAgentReply({
      sessionId: "session",
      conversationId: "628123456789@s.whatsapp.net",
      texts: ["hello"],
      history: [],
      ai,
      timezone: "Asia/Jakarta",
      now: new Date("2026-11-04T02:02:25.356Z"),
      sendMessage: async (input) => {
        sendInput = input;
        return { ok: true, content: JSON.stringify({ ok: true, messageId: "msg-1" }) };
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.toolsUsed).toContain(SEND_MESSAGE_TOOL_NAME);
    expect(sendInput).toEqual({ receiver: undefined, text: "Halo dari AI" });

    const first = requests[0];
    const system = (first.messages as Array<{ role: string; content: string }>)[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("<get_info");
    expect(system.content).toContain("Wednesday, 4 November 2026");
    // The runtime fact block is appended after the operator instruction.
    expect(system.content.indexOf("<get_info")).toBeGreaterThan(
      system.content.indexOf("You are a helpful assistant."),
    );
    const tools = first.tools as Array<{ function: { name: string } }>;
    expect(tools.some((tool) => tool.function.name === SEND_MESSAGE_TOOL_NAME)).toBe(true);
  });
});
