import { afterEach, expect, test } from "bun:test";
import { generateAgentReply, type ResolvedAiConfig } from "@/services/aiAgent";
import { extractMediaInfo, mediaDescriptor } from "@/services/inboundMedia";
import { collectLinkContext, extractUrls } from "@/services/linkPreview";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const baseAi: ResolvedAiConfig = {
  enabled: true,
  mode: "always",
  driver: "openai",
  baseUrl: "https://provider.example/v1",
  model: "main-model",
  apiKey: "test-key",
  temperature: 0.5,
  topP: 1,
  minP: 0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  maxTokens: 100,
  timeoutMs: 1000,
  toolMaxRounds: 0,
  agentUrl: "",
  systemInstruction: "You are helpful.",
  ragEndpoints: [],
  credentials: {},
  sendMessage: { enabled: false, scope: "allowlist", allowlist: [], maxPerHour: 10 },
  vision: { enabled: true, model: "vision-model" },
};

test("media descriptors keep captionless media eligible for the AI", () => {
  const image = extractMediaInfo({
    message: { imageMessage: { mimetype: "image/jpeg" } },
  } as never);
  expect(image).toEqual({ kind: "image", mimetype: "image/jpeg" });
  expect(mediaDescriptor(image!)).toContain("media: image");

  const video = extractMediaInfo({
    message: { videoMessage: { mimetype: "video/mp4", seconds: 12 } },
  } as never);
  expect(mediaDescriptor(video!)).toContain("duration: 12s");
  expect(mediaDescriptor(video!)).toContain("media: video");
});

test("links are extracted and private targets are refused without fetching", async () => {
  expect(extractUrls(["see https://example.com/a", "dummy"])).toEqual(["https://example.com/a"]);
  expect(await collectLinkContext(["http://127.0.0.1/private"])).toBe("");
  expect(await collectLinkContext(["no links here"])).toBe("");
});

test("vision request uses the vision model and image content", async () => {
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "Saya melihat gambarnya." } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await generateAgentReply({
    sessionId: "s",
    conversationId: "chat",
    texts: ["apa ini?"],
    history: [],
    ai: baseAi,
    images: [{ mime: "image/jpeg", data: "ZmFrZQ==" }],
  });

  expect(result.ok).toBe(true);
  expect(requests[0].model).toBe("vision-model");
  const messages = requests[0].messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((message) => message.role === "user");
  expect(Array.isArray(user?.content)).toBe(true);
  expect(JSON.stringify(user?.content)).toContain("image_url");
});

test("vision rejection retries once with the main model and no image", async () => {
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: "unsupported image" }), { status: 400 });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "Saya terima gambarnya." } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await generateAgentReply({
    sessionId: "s",
    conversationId: "chat",
    texts: ["apa ini?"],
    history: [],
    ai: baseAi,
    images: [{ mime: "image/jpeg", data: "ZmFrZQ==" }],
  });

  expect(result.ok).toBe(true);
  expect(requests).toHaveLength(2);
  expect(requests[1].model).toBe("main-model");
  const messages = requests[1].messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((message) => message.role === "user");
  expect(typeof user?.content).toBe("string");
  expect(String(user?.content)).toContain("Image omitted");
});
