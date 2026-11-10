/**
 * Zod Validation Schemas — Session Routes
 */
import { z } from "zod";

export const autoReplySchema = z
  .object({
    enabled: z.boolean(),
    message: z.string().max(4000).optional(),
    type: z.enum(["always", "time_range", "on_webhook_fail"]),
    role: z.enum(["primary", "fallback", "both"]).optional(),
    timeStart: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid start time format (HH:mm)")
      .optional(),
    timeEnd: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid end time format (HH:mm)")
      .optional(),
  })
  .optional();

export const createSessionSchema = z
  .object({
    clientName: z.string().optional(),
    webhookUrl: z.string().url("Invalid webhook URL").optional().or(z.literal("")),
    webhookSecret: z.string().optional(),
    freshAuth: z.boolean().optional().default(false),
    usePairingCode: z.boolean().optional().default(false),
    phoneNumber: z.string().optional(),
    includeMedia: z.boolean().optional(),
    syncFullHistory: z.boolean().optional().default(false),
    autoReply: autoReplySchema,
  })
  .optional()
  .default(() => ({
    freshAuth: false,
    usePairingCode: false,
    syncFullHistory: false,
  }));

/** Session ID must be alphanumeric with hyphens/underscores, 1-64 chars */
import { SESSION_ID_PATTERN } from "@/lib/sessionId";

export const SESSION_ID_REGEX = SESSION_ID_PATTERN;

/** HH:mm (00:00 - 23:59) */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:mm)");

/** Only http(s) targets may be configured for knowledge endpoints. */
const httpUrl = z
  .string()
  .url("Invalid URL")
  .refine((value) => /^https?:\/\//i.test(value), "Only http(s) URLs are allowed");

/**
 * Time-based routing overrides for one session.
 * Every field is optional: unset values fall back to the global env defaults.
 */
export const routingConfigSchema = z
  .object({
    timezone: z.string().min(1).max(64).optional(),
    aiWindowStart: timeOfDay.optional(),
    aiWindowEnd: timeOfDay.optional(),
    batchIdleMs: z.number().int().min(3000).max(120000).optional(),
    batchMaxWaitMs: z.number().int().min(5000).max(600000).optional(),
    maxBatchMessages: z.number().int().min(1).max(50).optional(),
    humanIdleMs: z.number().int().min(60000).max(86400000).optional(),
    handoffPauseMs: z.number().int().min(60000).max(86400000).optional(),
  })
  .strict();

/** One declared parameter of a knowledge endpoint (nothing hardcoded). */
export const ragParamSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_.-]+$/, "Use letters, digits, dot, dash or underscore"),
    type: z.enum(["string", "number", "integer", "boolean"]),
    description: z.string().min(1).max(300),
    required: z.boolean().optional(),
    in: z.enum(["query", "body", "path"]).optional(),
    enum: z.array(z.string().max(100)).max(50).optional(),
    default: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
  })
  .strict();

/** One simple (non-vector) knowledge endpoint exposed to the AI as a tool. */
export const ragEndpointSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_.-]+$/, "Use letters, digits, dot, dash or underscore"),
    description: z.string().min(1).max(500),
    method: z.enum(["GET", "POST"]),
    url: httpUrl,
    params: z
      .union([z.array(ragParamSchema).max(20), z.record(z.string(), z.unknown())])
      .optional(),
    /** Raw JSON Schema, forwarded to the model unchanged. */
    parameters: z.record(z.string(), z.unknown()).optional(),
    timeoutMs: z.number().int().min(500).max(30000).optional(),
    maxResponseChars: z.number().int().min(100).max(8000).optional(),
  })
  .strict();

/**
 * Per-number AI agent config accepted from the dashboard.
 * `credentialsJson` is plaintext on the wire only; it is encrypted before it
 * is written to session metadata and is never returned by the API.
 */
export const aiSendMessageSchema = z
  .object({
    enabled: z.boolean().optional(),
    scope: z.enum(["allowlist", "any"]).optional(),
    allowlist: z.array(z.string().trim().min(3).max(64)).max(100).optional(),
    maxPerHour: z.number().int().min(1).max(200).optional(),
  })
  .strict();

export const aiVisionSchema = z
  .object({
    enabled: z.boolean().optional(),
    model: z.string().max(128).optional(),
  })
  .strict();

export const otpFilterSchema = z
  .object({
    enabled: z.boolean().optional(),
    ignoredSenders: z.array(z.string().trim().min(3).max(64)).max(200).optional(),
    detectionMode: z.enum(["keywords", "smart"]).optional(),
    keywordFilter: z.boolean().optional(),
    smart: z.boolean().optional(),
    sensitivity: z.enum(["conservative", "balanced", "aggressive"]).optional(),
    keywords: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
    excludeKeywords: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  })
  .strict();

export const aiConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["off", "window", "always"]).optional(),
    driver: z.enum(["openai", "webhook"]).optional(),
    baseUrl: httpUrl.optional().or(z.literal("")),
    model: z.string().max(128).optional(),
    apiKey: z.string().max(400).optional(),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    minP: z.number().min(0).max(1).optional(),
    frequencyPenalty: z.number().min(-2).max(2).optional(),
    presencePenalty: z.number().min(-2).max(2).optional(),
    maxTokens: z.number().int().min(64).max(8192).optional(),
    toolMaxRounds: z.number().int().min(0).max(5).optional(),
    timeoutMs: z.number().int().min(2000).max(120000).optional(),
    agentUrl: httpUrl.optional().or(z.literal("")),
    systemInstruction: z.string().max(8000).optional(),
    ragEndpoints: z.array(ragEndpointSchema).max(20).optional(),
    credentialsJson: z.string().max(8000).optional(),
    sendMessage: aiSendMessageSchema.optional(),
    vision: aiVisionSchema.optional(),
    otpFilter: otpFilterSchema.optional(),
  })
  .strict();

/** Payload for PATCH /dashboard/api/sessions/:sessionId/ai-config */
export const aiConfigPatchSchema = z
  .object({
    routing: routingConfigSchema.optional(),
    ai: aiConfigSchema.optional(),
  })
  .strict();
