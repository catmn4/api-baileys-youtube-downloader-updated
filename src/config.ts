import type { LevelWithSilentOrString } from "pino";

const {
  NODE_ENV,
  HOST,
  PORT,
  LOG_LEVEL,
  AUTH_GLOBAL_TOKEN,
  REDIS_ENABLED,
  REDIS_URL,
  REDIS_PASSWORD,
  AUTH_STATE_BACKEND,
  AUTH_STATE_SWITCH_CONFIRM,
  CSP_REPORT_ONLY,
  AI_HISTORY_MAX_MESSAGES,
  AI_HISTORY_MAX_AGE_MS,
  AI_HISTORY_MAX_CHARS,
  ALLOW_GROUP_SEND,
  ALLOWED_GROUP_JIDS,
  AUDIT_LOG_ENABLED,
  AUDIT_LOG_BODY,
  AUDIT_LOG_RETENTION_DAYS,
  AUDIT_LOG_MAX_ENTRIES,
  CSP_CDN,
  DOCS_ASSETS,
  CSP_EXTRA_SCRIPT_SRC,
  CSP_EXTRA_STYLE_SRC,
  CSP_EXTRA_FONT_SRC,
  CSP_EXTRA_IMG_SRC,
  CSP_EXTRA_CONNECT_SRC,
  MEDIA_BLOCK_INTERNAL,
  RATE_LIMIT_API_KEY,
  AUTH_MAX_FAILURES,
  AUTH_FAILURE_WINDOW_MS,
  AUTH_LOCK_MS,
  SEND_TIMEOUT_MS,
  MAX_CONCURRENT_SENDS,
  BAILEYS_LOG_LEVEL,
  BAILEYS_CLIENT_VERSION,
  MAX_RETRIES,
  RECONNECT_INTERVAL,
  IGNORE_GROUP_MESSAGES,
  IGNORE_STATUS_MESSAGES,
  IGNORE_BROADCAST_MESSAGES,
  IGNORE_NEWSLETTER_MESSAGES,
  IGNORE_BOT_MESSAGES,
  IGNORE_META_AI_MESSAGES,
  WEBHOOK_URL,
  WEBHOOK_ALLOWED_EVENTS,
  WEBHOOK_RETRY_MAX,
  WEBHOOK_RETRY_INTERVAL,
  WEBHOOK_BACKOFF_FACTOR,
  WEBHOOK_SIGNATURE_MODE,
  WEBHOOK_INCLUDE_TOKEN,
  WEBHOOK_SECRET_GRACE_MS,
  WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK,
  WEBHOOK_CONCURRENCY,
  WEBHOOK_RETRY_HTTP_429,
  WEBHOOK_RETRYABLE_STATUSES,
  WEBHOOK_RATE_PER_MIN,
  WEBHOOK_RATE_MAX_WAIT_MS,
  WEBHOOK_CIRCUIT_FAILURES,
  WEBHOOK_CIRCUIT_RESET_MS,
  WEBHOOK_GZIP_THRESHOLD,
  WEBHOOK_DEAD_LETTER_ENABLED,
  WEBHOOK_DEAD_LETTER_DIR,
  WEBHOOK_BLOCK_INTERNAL,
  BROADCAST_MIN_DELAY_MS,
  BROADCAST_MAX_DELAY_MS,
  BROADCAST_BATCH_SIZE,
  BROADCAST_BATCH_PAUSE_MS,
  MEDIA_INCLUDE_BASE64,
  MEDIA_CLEANUP_ENABLED,
  MEDIA_CLEANUP_INTERVAL_MS,
  MEDIA_MAX_AGE_HOURS,
  CORS_ORIGIN,
  TRUST_PROXY,
  DASHBOARD_ENABLED,
  DASHBOARD_REGISTRATION_ENABLED,
  DASHBOARD_REGISTRATION_REQUIRE_APPROVAL,
  DASHBOARD_JWT_SECRET,
  DASHBOARD_PASSWORD_MIN_LENGTH,
  SIMULATE_TYPING_BEFORE_SEND,
  SIMULATE_TYPING_DELAY_MIN_MS,
  SIMULATE_TYPING_DELAY_MAX_MS,
  AUTO_READ_MESSAGES,
  AUTO_READ_DELAY_ENABLED,
  AUTO_READ_DELAY_MIN_MS,
  AUTO_READ_DELAY_MAX_MS,
  AUTO_MARK_ONLINE,
  MAX_SESSIONS,
  MAX_MESSAGES_PER_CHAT,
  MAX_SESSIONS_PER_USER,
  MAX_SESSIONS_PER_MANAGER,
  REJECT_CALLS,
  // Humanized interaction (WA-Web-like pacing)
  HUMANIZE_READ_BEFORE_REPLY,
  HUMANIZE_READ_DELAY_MIN_MS,
  HUMANIZE_READ_DELAY_MAX_MS,
  HUMANIZE_THINK_MIN_MS,
  HUMANIZE_THINK_MAX_MS,
  HUMANIZE_TYPING_PROPORTIONAL,
  HUMANIZE_PRESENCE_DEDUPE_MS,
  HUMANIZE_GLOBAL_PACING_MIN_MS,
  HUMANIZE_GLOBAL_PACING_MAX_MS,
  HUMANIZE_DELAY_DISTRIBUTION,
  BROADCAST_TYPING_SIMULATION,
  BROADCAST_DELAY_DISTRIBUTION,
  BROADCAST_BATCH_CHECK_WA,
  BROADCAST_CHECK_WA_BATCH_SIZE,
  // Time-based routing between human CS and the AI agent (global defaults;
  // each session can override them from the dashboard).
  ROUTING_TZ,
  AI_WINDOW_START,
  AI_WINDOW_END,
  ROUTING_BATCH_IDLE_MS,
  ROUTING_BATCH_MAX_WAIT_MS,
  ROUTING_MAX_BATCH_MESSAGES,
  ROUTING_HUMAN_IDLE_MS,
  ROUTING_HANDOFF_PAUSE_MS,
  AI_AGENT_URL,
  AI_SERVICE_TOKEN,
  AI_DRIVER,
  AI_MODE,
  AI_BASE_URL,
  AI_MODEL,
  AI_TEMPERATURE,
  AI_TOP_P,
  AI_MIN_P,
  AI_FREQUENCY_PENALTY,
  AI_PRESENCE_PENALTY,
  AI_MAX_TOKENS,
  AI_TIMEOUT_MS,
  AI_TOOL_MAX_ROUNDS,
  AI_TOOL_TIMEOUT_MS,
  AI_TOOL_MAX_RESPONSE_CHARS,
  AI_TOOL_BLOCK_INTERNAL,
  AI_GUARD_ENABLED,
  AI_GUARD_BLOCK_SCORE,
  AI_GUARD_MAX_STRIKES,
  AI_GUARD_MUTE_MS,
  AI_GUARD_MAX_INPUT_CHARS,
} = process.env;

/**
 * Parse an env min/max pair into a sane numeric range.
 * - Missing/blank values fall back to the given defaults.
 * - Non-numeric (NaN) values fall back to defaults.
 * - Inverted ranges (min > max) are swapped so downstream random delays never
 *   produce an empty/negative window (e.g. MIN above MAX).
 * - An explicit 0 is preserved — several knobs treat 0 as "off/legacy" and
 *   must be reachable via env (previous truthiness parsing silently ignored 0).
 */
function rangePair(
  minRaw: string | undefined,
  maxRaw: string | undefined,
  defaultMin: number,
  defaultMax: number,
): { minMs: number; maxMs: number } {
  const parse = (v: string | undefined): number => {
    if (v === undefined || v === "") return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  let min = parse(minRaw);
  let max = parse(maxRaw);
  if (!Number.isFinite(min)) min = defaultMin;
  if (!Number.isFinite(max)) max = defaultMax;
  if (min > max) [min, max] = [max, min];
  return { minMs: min, maxMs: max };
}

// Normalized delay ranges (swap inverted env values, preserve explicit 0 = off)
const typingDelay = rangePair(
  SIMULATE_TYPING_DELAY_MIN_MS,
  SIMULATE_TYPING_DELAY_MAX_MS,
  1500,
  3000,
);
const autoReadDelay = rangePair(AUTO_READ_DELAY_MIN_MS, AUTO_READ_DELAY_MAX_MS, 1500, 4000);
const humanReadDelay = rangePair(HUMANIZE_READ_DELAY_MIN_MS, HUMANIZE_READ_DELAY_MAX_MS, 800, 2500);
const humanThinkDelay = rangePair(HUMANIZE_THINK_MIN_MS, HUMANIZE_THINK_MAX_MS, 800, 2000);
const humanPacing = rangePair(HUMANIZE_GLOBAL_PACING_MIN_MS, HUMANIZE_GLOBAL_PACING_MAX_MS, 0, 0);
const broadcastDelay = rangePair(BROADCAST_MIN_DELAY_MS, BROADCAST_MAX_DELAY_MS, 1500, 3000);

function splitSources(value?: string): string[] {
  return (value || "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const config = {
  env: (NODE_ENV || "development") as "development" | "production",
  host: HOST || "0.0.0.0",
  port: PORT ? Number(PORT) : 3000,
  logLevel: (LOG_LEVEL || "info") as LevelWithSilentOrString,

  auth: {
    globalToken: AUTH_GLOBAL_TOKEN || "",
  },

  redis: {
    enabled: REDIS_ENABLED === "true",
    url: REDIS_URL || "redis://localhost:6379",
    password: REDIS_PASSWORD || "",
  },

  /**
   * Auth-state backend: "auto" (default), "file" or "redis".
   *
   * "auto" prefers Redis when reachable, but it never abandons sessions that
   * only exist on disk: in that case it falls back to files and warns. Explicit
   * values are honoured and refuse a mismatched store at startup.
   */
  authState: {
    backend:
      AUTH_STATE_BACKEND === "file"
        ? ("file" as const)
        : AUTH_STATE_BACKEND === "redis"
          ? ("redis" as const)
          : ("auto" as const),
    /**
     * One-shot escape hatch for switching an existing installation to another
     * store. Sessions are never migrated, and the old store is kept untouched.
     */
    switchConfirm: AUTH_STATE_SWITCH_CONFIRM === "true" || AUTH_STATE_SWITCH_CONFIRM === "1",
  },

  baileys: {
    logLevel: (BAILEYS_LOG_LEVEL || "warn") as LevelWithSilentOrString,
    clientVersion: BAILEYS_CLIENT_VERSION || "default",
    maxRetries: MAX_RETRIES ? Number(MAX_RETRIES) : 5,
    reconnectInterval: RECONNECT_INTERVAL ? Number(RECONNECT_INTERVAL) : 5000,
    ignoreGroupMessages: IGNORE_GROUP_MESSAGES === "true",
    ignoreStatusMessages: IGNORE_STATUS_MESSAGES ? IGNORE_STATUS_MESSAGES === "true" : true,
    ignoreBroadcastMessages: IGNORE_BROADCAST_MESSAGES
      ? IGNORE_BROADCAST_MESSAGES === "true"
      : true,
    ignoreNewsletterMessages: IGNORE_NEWSLETTER_MESSAGES
      ? IGNORE_NEWSLETTER_MESSAGES === "true"
      : true,
    ignoreBotMessages: IGNORE_BOT_MESSAGES ? IGNORE_BOT_MESSAGES === "true" : true,
    ignoreMetaAiMessages: IGNORE_META_AI_MESSAGES ? IGNORE_META_AI_MESSAGES === "true" : true,
  },

  webhook: {
    url: WEBHOOK_URL || "",
    allowedEvents: new Set(
      WEBHOOK_ALLOWED_EVENTS ? WEBHOOK_ALLOWED_EVENTS.split(",").map((e) => e.trim()) : ["ALL"],
    ),
    signatureMode: (WEBHOOK_SIGNATURE_MODE || "optional") as "off" | "optional" | "required",
    /** Legacy static-token headers; disable once the receiver verifies HMAC. */
    includeToken: WEBHOOK_INCLUDE_TOKEN !== "false",
    /**
     * After a manual rotation the previous secret stays primary for this long,
     * so receivers keep working while they are updated. 0 = invalidate at once.
     */
    secretGraceMs: (() => {
      const raw = Number(WEBHOOK_SECRET_GRACE_MS);
      if (!Number.isFinite(raw) || raw < 0) return 24 * 60 * 60 * 1000;
      return Math.min(raw, 7 * 24 * 60 * 60 * 1000);
    })(),
    allowGlobalTokenFallback:
      WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK !== undefined
        ? WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK === "true"
        : (NODE_ENV || "development") !== "production",
    concurrency: WEBHOOK_CONCURRENCY ? Number(WEBHOOK_CONCURRENCY) : 20,
    retryPolicy: {
      maxRetries: WEBHOOK_RETRY_MAX ? Number(WEBHOOK_RETRY_MAX) : 3,
      retryInterval: WEBHOOK_RETRY_INTERVAL ? Number(WEBHOOK_RETRY_INTERVAL) : 5000,
      backoffFactor: WEBHOOK_BACKOFF_FACTOR ? Number(WEBHOOK_BACKOFF_FACTOR) : 3,
      /** Respect Retry-After on 429 (exponential backoff otherwise). */
      retryHttp429: WEBHOOK_RETRY_HTTP_429 !== "false",
      /**
       * HTTP statuses that are retryable. 4xx (bad request) is not — retrying
       * a malformed payload will never succeed and only burns quota.
       * Default: 408, 425, 429, 5xx. Can be overridden via env, e.g.
       * "408,425,429,500,502,503,504".
       */
      retryableStatuses: new Set(
        WEBHOOK_RETRYABLE_STATUSES
          ? WEBHOOK_RETRYABLE_STATUSES.split(",")
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isInteger(n))
          : [408, 425, 429, 500, 502, 503, 504],
      ),
    },
    /**
     * Outbound rate limit per receiver URL (token bucket). 0 = disabled
     * (legacy). When > 0, at most N webhook requests per minute are sent to
     * the same endpoint; extra events wait (bounded by rateMaxWaitMs) instead
     * of being dropped.
     */
    ratePerMin: WEBHOOK_RATE_PER_MIN ? Number(WEBHOOK_RATE_PER_MIN) : 0,
    /** Max ms an event waits for a free per-URL slot before proceeding anyway. */
    rateMaxWaitMs: WEBHOOK_RATE_MAX_WAIT_MS ? Number(WEBHOOK_RATE_MAX_WAIT_MS) : 30000,
    /**
     * Per-URL circuit breaker: after N consecutive failures to the same
     * receiver the circuit opens and delivery is skipped (logged, and the
     * event goes to the dead-letter buffer when enabled) for resetMs,
     * instead of hammering a dead endpoint. 0 = disabled.
     */
    circuitFailures: WEBHOOK_CIRCUIT_FAILURES !== undefined ? Number(WEBHOOK_CIRCUIT_FAILURES) : 5,
    circuitResetMs: WEBHOOK_CIRCUIT_RESET_MS ? Number(WEBHOOK_CIRCUIT_RESET_MS) : 30000,
    /**
     * Compress webhook payloads with gzip when the JSON body exceeds this
     * many bytes (media-carrying events can be large). 0 = never compress.
     * Receivers that do not send Accept-Encoding still get a compressed body
     * — they must handle Content-Encoding: gzip (most HTTP clients do); the
     * signature is computed over the uncompressed JSON so it stays verifiable
     * after decompression.
     */
    gzipThreshold: WEBHOOK_GZIP_THRESHOLD !== undefined ? Number(WEBHOOK_GZIP_THRESHOLD) : 16384,
    /**
     * Dead-letter buffer for webhooks that exhausted all retries. When
     * enabled, failed deliveries are kept (and optionally persisted to disk)
     * instead of being dropped, so operators can replay them.
     * Default: disabled = legacy behavior (failed webhooks are dropped).
     */
    deadLetterEnabled: WEBHOOK_DEAD_LETTER_ENABLED === "true",
    deadLetterDir: WEBHOOK_DEAD_LETTER_DIR || "",
    /**
     * Block webhook URLs pointing at internal/private network targets
     * (localhost, 127.0.0.0/8, 10.x, 172.16-31.x, 192.168.x, link-local,
     * cloud metadata 169.254.169.254). Default false = allowed, so local
     * testing against http://localhost/127.0.0.1 receivers keeps working.
     * Enable in production when webhook URLs may be set by untrusted users.
     */
    blockInternal: WEBHOOK_BLOCK_INTERNAL === "true",
  },

  /**
   * Time-based routing: inside the AI window every inbound message is handled
   * by the AI agent, unless a human replied recently (then it stays human for
   * humanIdleMs). Per-session values in session metadata take precedence.
   */
  routing: {
    timezone: ROUTING_TZ || "Asia/Jakarta",
    aiWindowStart: AI_WINDOW_START || "16:00",
    aiWindowEnd: AI_WINDOW_END || "08:00",
    /** Debounce before forwarding; reset on every new inbound message. */
    batchIdleMs: ROUTING_BATCH_IDLE_MS ? Number(ROUTING_BATCH_IDLE_MS) : 20000,
    batchMaxWaitMs: ROUTING_BATCH_MAX_WAIT_MS ? Number(ROUTING_BATCH_MAX_WAIT_MS) : 60000,
    maxBatchMessages: ROUTING_MAX_BATCH_MESSAGES ? Number(ROUTING_MAX_BATCH_MESSAGES) : 8,
    /** How long a conversation stays human-owned after human activity. */
    humanIdleMs: ROUTING_HUMAN_IDLE_MS ? Number(ROUTING_HUMAN_IDLE_MS) : 900000,
    /** Pause applied when the AI requests a human takeover. */
    handoffPauseMs: ROUTING_HANDOFF_PAUSE_MS ? Number(ROUTING_HANDOFF_PAUSE_MS) : 1800000,
  },

  /**
   * AI agent gateway defaults. Per-session values override these; secrets are
   * stored encrypted in session metadata, never in this global config.
   */
  ai: {
    /** "openai" calls an OpenAI-compatible API directly, "webhook" posts to a gateway. */
    driver: (AI_DRIVER === "webhook" ? "webhook" : "openai") as "openai" | "webhook",
    /** Default answering window mode; per number override: ai.mode */
    mode: (AI_MODE === "always" ? "always" : AI_MODE === "off" ? "off" : "window") as
      | "off"
      | "window"
      | "always",
    baseUrl: AI_BASE_URL || "https://openrouter.ai/api/v1",
    model: AI_MODEL || "",
    temperature: AI_TEMPERATURE ? Number(AI_TEMPERATURE) : 0.6,
    /** Nucleus sampling (standard default 1). */
    topP: AI_TOP_P ? Number(AI_TOP_P) : 0.95,
    /** Min-p sampling; 0 = disabled (only sent when > 0). */
    minP: AI_MIN_P ? Number(AI_MIN_P) : 0.05,
    frequencyPenalty: AI_FREQUENCY_PENALTY ? Number(AI_FREQUENCY_PENALTY) : 0,
    presencePenalty: AI_PRESENCE_PENALTY ? Number(AI_PRESENCE_PENALTY) : 0,
    maxTokens: AI_MAX_TOKENS ? Number(AI_MAX_TOKENS) : 1024,
    timeoutMs: AI_TIMEOUT_MS ? Number(AI_TIMEOUT_MS) : 25000,
    /** Max tool-calling rounds per reply, guards endless loops. */
    toolMaxRounds: AI_TOOL_MAX_ROUNDS !== undefined ? Number(AI_TOOL_MAX_ROUNDS) : 2,
    toolTimeoutMs: AI_TOOL_TIMEOUT_MS ? Number(AI_TOOL_TIMEOUT_MS) : 8000,
    toolMaxResponseChars: AI_TOOL_MAX_RESPONSE_CHARS ? Number(AI_TOOL_MAX_RESPONSE_CHARS) : 2000,
    /** When true, configured tool URLs pointing at private hosts are refused. */
    toolBlockInternal: AI_TOOL_BLOCK_INTERNAL === "true",
    /**
     * Prompt-injection tripwire and abuse control. Heuristics are a signal, not
     * a boundary: the real limits are allowlisted tools, no secrets in the
     * prompt, output scrubbing and this mute policy.
     */
    guard: {
      enabled: AI_GUARD_ENABLED !== "false",
      /** Score at or above this refuses the message (default 50). */
      blockScore: AI_GUARD_BLOCK_SCORE ? Number(AI_GUARD_BLOCK_SCORE) : 50,
      /** Blocked attempts before the conversation is muted (default 3). */
      maxStrikes: AI_GUARD_MAX_STRIKES ? Number(AI_GUARD_MAX_STRIKES) : 3,
      /** Mute duration; messages received meanwhile are ignored (default 15m). */
      muteMs: AI_GUARD_MUTE_MS ? Number(AI_GUARD_MUTE_MS) : 900000,
      /** Hard cap on inbound text handed to the model (default 4000 chars). */
      maxInputChars: AI_GUARD_MAX_INPUT_CHARS ? Number(AI_GUARD_MAX_INPUT_CHARS) : 4000,
    },
    agentUrl: AI_AGENT_URL || "",
    /** Service identity for gateway -> API internal calls (not per-user). */
    serviceToken: AI_SERVICE_TOKEN || "",
  },

  broadcast: {
    minDelayMs: broadcastDelay.minMs,
    maxDelayMs: broadcastDelay.maxMs,
    batchSize: BROADCAST_BATCH_SIZE ? Number(BROADCAST_BATCH_SIZE) : 10,
    batchPauseMs: BROADCAST_BATCH_PAUSE_MS ? Number(BROADCAST_BATCH_PAUSE_MS) : 5000,
    /** Show "composing…" bubble per recipient during broadcasts (default: false — safer). */
    typingSimulation:
      BROADCAST_TYPING_SIMULATION !== undefined ? BROADCAST_TYPING_SIMULATION === "true" : false,
    /** "uniform" (legacy) or "human" (mixed short/long gaps + jitter). */
    delayDistribution: (BROADCAST_DELAY_DISTRIBUTION || "uniform") as "uniform" | "human",
    /** Check WA registration in batches instead of 1-by-1 (fewer usync queries). */
    batchCheckWa: BROADCAST_BATCH_CHECK_WA === "true",
    checkWaBatchSize: BROADCAST_CHECK_WA_BATCH_SIZE ? Number(BROADCAST_CHECK_WA_BATCH_SIZE) : 50,
  },

  media: {
    includeBase64: MEDIA_INCLUDE_BASE64 === "true",
    /** Reject media URLs that resolve to private/internal hosts (SSRF guard). */
    blockInternal: MEDIA_BLOCK_INTERNAL !== "false",
    cleanupEnabled: MEDIA_CLEANUP_ENABLED ? MEDIA_CLEANUP_ENABLED === "true" : true,
    cleanupIntervalMs: MEDIA_CLEANUP_INTERVAL_MS ? Number(MEDIA_CLEANUP_INTERVAL_MS) : 3600000,
    maxAgeHours: MEDIA_MAX_AGE_HOURS ? Number(MEDIA_MAX_AGE_HOURS) : 24,
  },

  corsOrigin: (() => {
    const raw = CORS_ORIGIN || "*";
    if (raw === "*") return "*";
    const origins = raw
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    return origins.length === 1 ? origins[0] : origins;
  })(),

  /**
   * Trust proxy headers (x-forwarded-for / x-real-ip / cf-connecting-ip)
   * for client IP detection. Enable ONLY when running behind a trusted
   * reverse proxy / load balancer. When false (default), the socket remote
   * address is used — spoofed XFF headers cannot bypass rate limits.
   */
  trustProxy: TRUST_PROXY === "true",

  /** Maximum concurrent sessions allowed */
  maxSessions: MAX_SESSIONS ? Number(MAX_SESSIONS) : 50,
  /** Per-chat in-memory/snapshot message cap (AI context uses its own limit). */
  maxMessagesPerChat: MAX_MESSAGES_PER_CHAT ? Number(MAX_MESSAGES_PER_CHAT) : 50,
  /** Report violations without enforcing them (useful for a clean dev console). */
  cspReportOnly: CSP_REPORT_ONLY === "true" || CSP_REPORT_ONLY === "1",

  rateLimit: {
    /** Requests per minute allowed per API key (falls back to IP). */
    perApiKey: RATE_LIMIT_API_KEY ? Number(RATE_LIMIT_API_KEY) : 60,
  },

  loginGuard: {
    maxFailures: AUTH_MAX_FAILURES ? Number(AUTH_MAX_FAILURES) : 10,
    windowMs: AUTH_FAILURE_WINDOW_MS ? Number(AUTH_FAILURE_WINDOW_MS) : 15 * 60 * 1000,
    lockMs: AUTH_LOCK_MS ? Number(AUTH_LOCK_MS) : 15 * 60 * 1000,
  },

  send: {
    timeoutMs: SEND_TIMEOUT_MS ? Number(SEND_TIMEOUT_MS) : 30000,
    maxConcurrent: MAX_CONCURRENT_SENDS ? Number(MAX_CONCURRENT_SENDS) : 5,
  },

  /** CSP origins are configurable: self-hosting is the default, CDNs opt-in. */
  csp: {
    // CDNs are allowed by default (common practice); CSP_CDN=false locks the
    // policy down to same-origin only.
    cdn: CSP_CDN !== "false",
    docsAssets: DOCS_ASSETS === "local" ? ("local" as const) : ("cdn" as const),
    extra: {
      script: splitSources(CSP_EXTRA_SCRIPT_SRC),
      style: splitSources(CSP_EXTRA_STYLE_SRC),
      font: splitSources(CSP_EXTRA_FONT_SRC),
      img: splitSources(CSP_EXTRA_IMG_SRC),
      connect: splitSources(CSP_EXTRA_CONNECT_SRC),
    },
  },

  /** Inbound API audit log (dashboard REST API page). */
  auditLog: {
    enabled: AUDIT_LOG_ENABLED !== "false",
    body: AUDIT_LOG_BODY === "true" || AUDIT_LOG_BODY === "1",
    retentionDays: AUDIT_LOG_RETENTION_DAYS ? Number(AUDIT_LOG_RETENTION_DAYS) : 7,
    maxEntries: AUDIT_LOG_MAX_ENTRIES ? Number(AUDIT_LOG_MAX_ENTRIES) : 5000,
  },

  messaging: {
    /** Group sends are disabled by default: highest ban-risk pattern. */
    allowGroupSend: ALLOW_GROUP_SEND === "true" || ALLOW_GROUP_SEND === "1",
    /** Optional allowlist of group JIDs or numeric ids (empty = all groups). */
    allowedGroupJids: (ALLOWED_GROUP_JIDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  },

  /** Prompt history limits: count, age window and character budget. */
  aiHistory: {
    maxMessages: AI_HISTORY_MAX_MESSAGES ? Number(AI_HISTORY_MAX_MESSAGES) : 12,
    maxAgeMs: AI_HISTORY_MAX_AGE_MS ? Number(AI_HISTORY_MAX_AGE_MS) : 6 * 60 * 60 * 1000,
    maxChars: AI_HISTORY_MAX_CHARS ? Number(AI_HISTORY_MAX_CHARS) : 8000,
  },
  /** Per-role session quotas for non-admin dashboard users (0 = unlimited). */
  maxSessionsPerUser: MAX_SESSIONS_PER_USER ? Number(MAX_SESSIONS_PER_USER) : 3,
  maxSessionsPerManager: MAX_SESSIONS_PER_MANAGER ? Number(MAX_SESSIONS_PER_MANAGER) : 5,

  dashboard: {
    enabled: DASHBOARD_ENABLED ? DASHBOARD_ENABLED === "true" : true,
    registrationEnabled: DASHBOARD_REGISTRATION_ENABLED === "true",
    registrationRequireApproval: DASHBOARD_REGISTRATION_REQUIRE_APPROVAL === "true",
    /**
     * JWT secret for dashboard auth. In production a missing/default secret is
     * treated as a misconfiguration (jwtMisconfigured=true) so the dashboard
     * fails closed instead of silently signing tokens with a publicly-known
     * default. In development the built-in default stays for local convenience.
     */
    jwtSecret: DASHBOARD_JWT_SECRET || "baileys-wa-api-dashboard-secret-change-me",
    jwtMisconfigured:
      (NODE_ENV || "development") === "production" &&
      (!DASHBOARD_JWT_SECRET ||
        !DASHBOARD_JWT_SECRET.trim() ||
        DASHBOARD_JWT_SECRET.includes("change-me") ||
        DASHBOARD_JWT_SECRET.includes("change_me")),
    passwordMinLength: DASHBOARD_PASSWORD_MIN_LENGTH ? Number(DASHBOARD_PASSWORD_MIN_LENGTH) : 6,
  },

  simulation: {
    typingBeforeSend: SIMULATE_TYPING_BEFORE_SEND !== "false",
    typingDelayMinMs: typingDelay.minMs,
    typingDelayMaxMs: typingDelay.maxMs,
    autoReadMessages: AUTO_READ_MESSAGES === "true",
    /** Jeda "buka chat" sebelum mark read saat auto-read ON (0 = instan, seperti lama). */
    autoReadDelayEnabled: AUTO_READ_DELAY_ENABLED !== "false",
    autoReadDelayMinMs: autoReadDelay.minMs,
    autoReadDelayMaxMs: autoReadDelay.maxMs,
    autoMarkOnline: AUTO_MARK_ONLINE !== "false",
    rejectCalls: REJECT_CALLS === "true",
  },

  /**
   * Humanized interaction — WA-Web-like pacing before reads/replies.
   * All knobs default to the legacy behavior (0 / false) unless enabled.
   */
  humanize: {
    /** Mark incoming as read before sending an auto-reply (like opening WA Web). */
    readBeforeReply: HUMANIZE_READ_BEFORE_REPLY === "true",
    /** Random "reading" gap before read receipts (ms). */
    readDelayMinMs: humanReadDelay.minMs,
    readDelayMaxMs: humanReadDelay.maxMs,
    /** Random "thinking" gap before typing starts (ms). */
    thinkMinMs: humanThinkDelay.minMs,
    thinkMaxMs: humanThinkDelay.maxMs,
    /** Typing duration proportional to reply length when true. */
    typingProportional: HUMANIZE_TYPING_PROPORTIONAL === "true",
    /** Min gap between repeated composing/paused to same chat (0 = send every time). */
    presenceDedupeMs: HUMANIZE_PRESENCE_DEDUPE_MS ? Number(HUMANIZE_PRESENCE_DEDUPE_MS) : 0,
    /** Global min/max gap between ANY outbound action within a session (0 = off). */
    globalPacingMinMs: humanPacing.minMs,
    globalPacingMaxMs: humanPacing.maxMs,
    /** Delay pattern for read/think gaps: `uniform` (legacy) or `human`. */
    delayDistribution: (HUMANIZE_DELAY_DISTRIBUTION || "uniform") as "uniform" | "human",
  },

  autoReply: {
    enabled: process.env.AUTO_REPLY_ENABLED === "true",
    message:
      process.env.AUTO_REPLY_MESSAGE ||
      "Hello, we're currently away.\nWe'll reply to your message soon.",
    type: (process.env.AUTO_REPLY_TYPE || "always") as "always" | "time_range" | "on_webhook_fail",
    timeStart: process.env.AUTO_REPLY_TIME_START || "18:00",
    timeEnd: process.env.AUTO_REPLY_TIME_END || "08:00",
    /** Default role in the responder chain (per-session override available). */
    role: (process.env.AUTO_REPLY_ROLE === "primary" || process.env.AUTO_REPLY_ROLE === "fallback"
      ? process.env.AUTO_REPLY_ROLE
      : "both") as "primary" | "fallback" | "both",
  },
};

export default config;
export type Config = typeof config;
