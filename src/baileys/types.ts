import type { AnyMessageContent } from "@whiskeysockets/baileys";

export interface AutoReplyConfig {
  enabled: boolean;
  message: string;
  type: "always" | "time_range" | "on_webhook_fail";
  timeStart?: string; // HH:mm
  timeEnd?: string; // HH:mm
  /**
   * Role inside the responder chain:
   * - "primary"  answers when the AI is off or outside its window
   * - "fallback" answers only when the AI fails (credits, API error, guard)
   * - "both"     both of the above (default, backwards compatible)
   */
  role?: "primary" | "fallback" | "both";
}

/**
 * Time-based routing between a human CS and the AI agent.
 *
 * Every value is optional on the wire: whatever the dashboard does not set
 * falls back to the global env defaults (`config.routing`).
 */
export interface RoutingConfig {
  /** IANA timezone used to evaluate the AI window. Default: Asia/Jakarta. */
  timezone?: string;
  /** Start of the AI window (HH:mm). Supports windows crossing midnight. */
  aiWindowStart?: string;
  /** End of the AI window (HH:mm). */
  aiWindowEnd?: string;
  /** Debounce before forwarding: reset on every new inbound message. */
  batchIdleMs?: number;
  /** Hard cap so a continuously typing customer cannot delay forever. */
  batchMaxWaitMs?: number;
  /** Max messages folded into a single AI prompt. */
  maxBatchMessages?: number;
  /** How long a conversation stays human-owned after human activity. */
  humanIdleMs?: number;
  /** Pause applied when the AI asks for a human takeover. */
  handoffPauseMs?: number;
}

/**
 * One parameter of a knowledge endpoint, as exposed to the model.
 * Each endpoint declares its own parameters — nothing is hardcoded.
 */
export interface RagEndpointParam {
  name: string;
  type: "string" | "number" | "integer" | "boolean";
  description: string;
  required?: boolean;
  /** Where the value goes. Default: query for GET, body for POST. */
  in?: "query" | "body" | "path";
  enum?: string[];
  default?: string | number | boolean;
}

/**
 * A simple, non-vector knowledge endpoint the AI may call.
 * The gateway turns this into a tool schema; the URL must already be
 * allowlisted by configuration (never taken from a prompt).
 */
export interface RagEndpointConfig {
  name: string;
  description: string;
  method: "GET" | "POST";
  url: string;
  /**
   * Structured parameter list (convenience form). A raw JSON Schema may be
   * supplied instead — either here as an object or via `parameters`.
   */
  params?: RagEndpointParam[] | Record<string, unknown>;
  /** Raw JSON Schema (OpenAI tool schema), forwarded to the model unchanged. */
  parameters?: Record<string, unknown>;
  timeoutMs?: number;
  maxResponseChars?: number;
}

/**
 * Per-number AI agent configuration.
 * Credentials stay encrypted (see lib/secretBox) and are never returned raw.
 */
/** Built-in "send a WhatsApp message" tool for the OpenAI-compatible driver. */
export interface AiSendMessageConfig {
  /** Default false: the tool is not sent to the model unless enabled. */
  enabled?: boolean;
  /** allowlist = current chat plus listed recipients; any = any number/JID. */
  scope?: "allowlist" | "any";
  /** Phone numbers or JIDs allowed when scope is "allowlist". */
  allowlist?: string[];
  /** Hard cap per session, sliding one-hour window. */
  maxPerHour?: number;
}

export type OtpFilterSensitivity = "conservative" | "balanced" | "aggressive";
export type OtpFilterDetectionMode = "keywords" | "smart";

/** Optional deny-list/keyword filter for OTP and verification messages. */
export interface OtpFilterConfig {
  enabled?: boolean;
  /** Senders whose auto-replies are skipped. One number/JID per entry. */
  ignoredSenders?: string[];
  /** Detection mode; defaults to smart for new configurations. */
  detectionMode?: OtpFilterDetectionMode;
  /** @deprecated Use detectionMode. Retained for old stored configs. */
  keywordFilter?: boolean;
  /** @deprecated Use detectionMode. Retained for old stored configs. */
  smart?: boolean;
  /** Smart-mode threshold; defaults to balanced. */
  sensitivity?: OtpFilterSensitivity;
  /** Operator-maintained keywords; no built-in values. */
  keywords?: string[];
  /** If a keyword matches, do not treat the message as OTP. */
  excludeKeywords?: string[];
}

/** Opt-in image understanding for the OpenAI-compatible driver. */
export interface AiVisionConfig {
  enabled?: boolean;
  /** Optional vision-capable model slug; empty means the main model. */
  model?: string;
}

export interface AiAgentConfig {
  enabled?: boolean;
  /**
   * When the AI may answer:
   * - "off"     — never (use the static auto-reply instead)
   * - "window"  — only inside aiWindowStart..aiWindowEnd (default)
   * - "always"  — 24/7 full handling; a human reply still pauses it
   */
  mode?: "off" | "window" | "always";
  /** "openai" = OpenAI-compatible (OpenRouter/OpenAI/Groq/Ollama); "webhook" = external gateway. */
  driver?: "openai" | "webhook";
  /** OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1 */
  baseUrl?: string;
  /** Model slug, e.g. openai/gpt-4o-mini */
  model?: string;
  temperature?: number;
  /** Nucleus sampling; standard default 1. */
  topP?: number;
  /** Min-p sampling (OpenRouter / llama.cpp style); 0 = off. */
  minP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxTokens?: number;
  /** Max tool-calling rounds per reply (guards loops). */
  toolMaxRounds?: number;
  timeoutMs?: number;
  /** Gateway URL for the webhook driver; falls back to AI_AGENT_URL. */
  agentUrl?: string;
  /** Per-number system instruction (persona + tool guidance). */
  systemInstruction?: string;
  ragEndpoints?: RagEndpointConfig[];
  /** Encrypted JSON blob with per-endpoint credentials and the provider key. */
  credentials?: string;
  /** Optional built-in send-message tool (default off). */
  sendMessage?: AiSendMessageConfig;
  /** Optional image understanding (default off). */
  vision?: AiVisionConfig;
  /** Optional OTP/verification auto-reply filter (default off). */
  otpFilter?: OtpFilterConfig;
}

export interface SessionOptions {
  /** Dashboard user that created this session. */
  ownerId?: string;
  /** Display name for the client browser */
  clientName?: string;
  /** Webhook URL for this session */
  webhookUrl?: string;
  /** Optional per-session webhook secret header value */
  webhookSecret?: string;
  /** Secret kept during a rotation grace window (still accepted until expiry). */
  webhookSecretPrevious?: string;
  /** Epoch ms when webhookSecretPrevious stops being accepted. */
  webhookSecretPreviousExpiresAt?: number;
  /** Whether to use pairing code instead of QR */
  usePairingCode?: boolean;
  /** Phone number for pairing code */
  phoneNumber?: string;
  /** Include media as base64 in webhook events */
  includeMedia?: boolean;
  /** Session-level webhook events */
  webhookEvents?: string[];
  /** Sync full message history */
  syncFullHistory?: boolean;
  /** Callback when connection closes */
  onConnectionClose?: () => void;
  /** Whether this is a reconnection */
  isReconnect?: boolean;
  /** Override: simulate typing before send (per-session) */
  simulateTyping?: boolean;
  /** Override: auto-read incoming messages (per-session) */
  autoReadMessages?: boolean;
  /** Auto-reply configuration */
  autoReply?: AutoReplyConfig;
  /** Time-based routing between human CS and AI agent */
  routing?: RoutingConfig;
  /** Per-number AI agent settings */
  ai?: AiAgentConfig;
}

export interface SessionMetadata {
  /** Dashboard user that created this session (absent for legacy sessions). */
  ownerId?: string;
  clientName?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookSecretPrevious?: string;
  webhookSecretPreviousExpiresAt?: number;
  webhookEvents?: string[];
  includeMedia?: boolean;
  syncFullHistory?: boolean;
  autoReply?: AutoReplyConfig;
  routing?: RoutingConfig;
  ai?: AiAgentConfig;
}

export interface WebhookPayload {
  sessionId: string;
  event: string;
  data: unknown;
  extra?: Record<string, unknown>;
  /**
   * Responder-chain context, so an external system knows the AI/static setup
   * and does not reply a second time.
   */
  routing?: {
    aiEnabled: boolean;
    aiMode: "off" | "window" | "always";
    window: string;
    timezone: string;
    staticRole: "primary" | "fallback" | "both";
  };
}

export interface BroadcastMessage {
  receiver: string;
  message: AnyMessageContent;
  delay?: number;
}

export interface BroadcastJob {
  id: string;
  sessionId: string;
  messages: BroadcastMessage[];
  status: "pending" | "running" | "completed" | "cancelled" | "failed";
  progress: number;
  total: number;
  errors: Array<{ index: number; receiver: string; error: string }>;
  createdAt: number;
}
