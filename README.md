# API Baileys WA Socket

**WhatsApp REST API** powered by [Baileys WA Sockets](https://github.com/WhiskeySockets/Baileys). Built with **Hono + TypeScript** and features **Dual-Runtime Support** (runs natively on **Bun** or **Node.js**). Includes a built-in Visual Dashboard for easy management, keep clean simple and avoid heavy over-engineering.

> [!NOTE]
> This project is not meant to be a full-fledged WhatsApp server. It is a wrapper around the Baileys library, providing an HTTP interface for easier integration with other applications, don't use it for spamming or any activities that's prohibited by **WhatsApp META**.
>
> **Disclaimer:** This project is 100% AI-assisted and intended for educational purposes only. It will be maintained as a side project in spare time only, with no guarantees of ongoing support, updates, or production readiness.
>
> Thus, we do not store WhatsApp messages or any other data (aside from credentials for auto-reconnecting).

Release history lives in [CHANGELOG.md](CHANGELOG.md); this README stays version-agnostic.

---

## ✨ Features

| Feature                     | Description                                                       |
| --------------------------- | ----------------------------------------------------------------- |
| **Dual Runtime Support**    | Run on ultra-fast Bun or standard Node.js (cPanel/VPS compatible) |
| **Visual Dashboard**        | Built-in UI to manage sessions, webhooks, and send messages       |
| **Dashboard RBAC**          | Role-based access (`admin`, `manager`, `assistant`) + approvals   |
| **Session Assignment ACL**  | Optional per-user assigned sessions (dashboard scope only)        |
| **Multi-Session**           | Manage multiple WhatsApp accounts simultaneously                  |
| **QR Code & Pairing Code**  | Connect via QR scan or 8-digit pairing code                       |
| **Complete Chat API**       | Send text, media, forward, delete, read messages                  |
| **Broadcast Queue**         | Bulk message sending with anti-spam delays                        |
| **Group & Profile**         | Full management (create, participants, status, picture)           |
| **Media Handling**          | Download, process, retrieve, and auto-cleanup old media           |
| **Webhook System**          | Retries, exponential backoff, and signature modes                 |
| **Dual Auth State**         | Save session data to Files (dev) or Redis (production)            |
| **API Authentication**      | Bearer token or Redis-stored API keys with roles                  |
| **Hardened Dashboard Auth** | JWT auth, stream token for SSE, password policy, approval flow    |
| **Swagger/OpenAPI**         | Built-in interactive API documentation at `/docs`                 |
| **Docker Support**          | Ready-to-use Dockerfiles for both Bun and Node.js                 |

---


## تنزيل فيديو YouTube عبر واتساب

بعد ربط جلسة واتساب، أرسل إلى الرقم المرتبط:

- `/y https://youtu.be/VIDEO_ID` لعرض جودات الفيديو والصوت.
- `/y 2 0` لتنزيل ثاني جودة فيديو بدون صوت. استخدم `0` في موضع الصوت لاستبعاده؛ عند اختيار جودة صوت يُرسل الصوت والفيديو كملفين منفصلين.
- `/y 2 3` لتنزيل ثاني جودة فيديو والثالثة صوت كملفين منفصلين دون ffmpeg.

تعرض القائمة حجم كل صيغة عندما يوفره `yt-dlp` كحجم فعلي (`filesize`). لا يستخدم البوت `filesize_approx`، ويعرض «الحجم الدقيق غير متاح من المصدر» بدلًا من إظهار قيمة تقريبية. يرسل الناتج كمستند واتساب. يحتفظ البوت بقائمة الاختيارات لكل محادثة في الذاكرة، لذا أعد إرسال رابط `/y` بعد إعادة تشغيل الخدمة.

يستخدم التنزيل `vendor/yt-dlp` ولا يضمّن المشروع ffmpeg أو ffprobe. لتجنب الحاجة إلى دمج خارجي، ينزّل البوت الفيديو إلى القرص، ويرفعه من مساره كـ stream، ثم يحذف ملفه المؤقت بعد اكتمال الإرسال. بعد ذلك ينزّل الصوت ويرفعه بالطريقة نفسها كملف منفصل. لا تُحمّل الملفات كاملة إلى RAM ولا تُدمج المسارات، ولا يحتاج ذلك إلى ffmpeg. يوجّه البوت ملفات Baileys المشفرة المؤقتة أيضًا إلى مجلد `YOUTUBE_OUTPUT_DIR` (أو `youtube-downloads`) أثناء الرفع، ويحذف كل ملف بعد اكتمال إرساله. تعرض القائمة معدل بت الصوت وحجم كل صيغة عندما يوفره `yt-dlp` كحجم دقيق. التشغيل مدعوم على Linux x86_64 عبر Bun. يمكن تغيير موقع yt-dlp ومجلد المخرجات باستخدام `YTDLP_PATH` و`YOUTUBE_OUTPUT_DIR`.

لتشخيص الذاكرة، يطبع سجل الخدمة رسائل `[YouTube RAM]` عند أحداث yt-dlp الداخلية (صفحة الفيديو، إعداد العميل وAPI، player script، تحدي JavaScript، واستخراج الصيغ)، وكل ثانية أثناء yt-dlp وإرسال Baileys. تتضمن `memoryMiB` ذاكرة التطبيق (`processRss`)، ومجموع شجرة yt-dlp وعملياته الفرعية (`ytDlpTreeRss`, `ytDlpTreePss`)، واستخدام الحاوية (`containerUsed`) وتقسيمه إلى ذاكرة مجهولة ومخبأ ملفات (`containerAnon`, `containerFileCache`) إذا أتاح الخادم هذه المقاييس. ويعرض الحقل `ytDlpProcesses` لكل عملية اسمها وPID وPID الأب وRSS/PSS الفرديين، إن كانت معلومات `/proc` متاحة. لا تُسجّل وسائط سطر الأوامر أو قيم cookies. تأكد من أن `LOG_LEVEL=info` أو مستوى أكثر تفصيلًا كي تظهر الرسائل.

إذا أعاد YouTube رسالة `Sign in to confirm you’re not a bot`، يمكنك تزويد `yt-dlp` بملف cookies بصيغة Netscape/Mozilla محفوظ على الخادم، وضبط `YOUTUBE_COOKIES_FILE=/مسار/آمن/youtube-cookies.txt`. سيمرر البوت الملف إلى كل من فحص الجودات والتنزيل. كما يفعّل تلقائيًا JavaScript runtime الخاص بالتشغيل الحالي (Bun أو Node.js) عبر `--js-runtimes`؛ وهذا مطلوب لإكمال تحديات YouTube الحديثة واستخراج روابط الصيغ. لا ترفع ملف cookies إلى GitHub ولا ترسله في واتساب؛ فهو يمنح وصولًا إلى جلسة حسابك. قد تتوقف cookies عن العمل أو يقيّد YouTube الحساب، لذا استخدمها عند الضرورة فقط. تحجب ملفات `.gitignore` و`.dockerignore` الملفات الشائعة `cookies.txt` و`youtube-cookies.txt` كحماية إضافية.

## 🚀 Quick Start

### 1. Prerequisite (Choose One Runtime)

- **Bun**: Ultra-fast, ideal for VPS or Home Servers (Recommended).
- **Node.js**: Standard, portable, ideal for cPanel VPS or traditional Node.js hosting.
- **Docker**: Containerized deployment. Ensure you have Docker Compose installed.

### 2. Local Setup (Bun OR Node.js)

```bash
# Clone the repository
git clone <repository-url>
cd baileys-wa-api

# Configure Environment
cp .env.example .env
# Edit .env and configure DASHBOARD_JWT_SECRET
```

#### Running with Bun (Fastest)

```bash
bun install

# Development (Auto-reload)
bun run dev

# Production Build
bun run start
```

#### Running with Node.js (Highest Compatibility)

```bash
npm install

# Development (via tsx watch)
npm run dev:node

# Production Build
npm run start:node
```

The API will start at `http://localhost:3000`. Access the following default routes:

- 🖥️ **Dashboard**: `http://localhost:3000/dashboard/`
- 📖 **Swagger Docs**: `http://localhost:3000/docs`
- 💚 **Health Check**: `http://localhost:3000/status`

---

## 🤖 AI Auto-Response (time-based routing + RAG tools)

Inside a configured window the AI answers; outside it humans do. Per-number
settings live in the session metadata (dashboard), so every WhatsApp number has
its own window, model, instruction and knowledge endpoints.

#### Built-in send tool (optional)

**AI & Routing → Send message tool** adds `send_whatsapp_message` to the tool
list on every request when enabled. It is off by default and text-only.

- **Scope** — `allowlist` (default: the current chat plus listed
  numbers/JIDs) or `any`. The originating chat is always allowed; `receiver`
  is optional and defaults to it.
- **Rate limit** — `maxPerHour` sliding window per session, enforced before the
  send; the model cannot bypass it.
- **Groups** — still governed by `ALLOW_GROUP_SEND` / `ALLOWED_GROUP_JIDS`.
- **Execution** — the tool calls the same service as `POST /api/v1/messages`;
  it does not make an internal HTTP request or carry an API key.

#### Media and link context

- Captionless images, videos, audio and documents are described with metadata
  (`[media: image, mime: ...]`) so they still reach the AI instead of falling
  straight to the static reply. Video/audio contents are not processed.
- Optional **image understanding** is a per-session toggle in AI & Routing.
  Inbound images are downloaded in memory, bounded and re-encoded to JPEG, sent
  as `image_url` parts, then discarded. Nothing is stored in the chat history or
  media directory; history keeps a text placeholder only. The optional vision
  model uses the same base URL/API key; empty means the main model, and a
  rejection falls back once to a text-only descriptor.
- Customer links get bounded title/description previews through a DNS/private-IP
  checked, redirect-rejecting, size-capped fetch. Previews are untrusted data in
  the user prompt; the model cannot fetch arbitrary URLs.

#### OTP / verification auto-reply filter

**AI & Routing → Message Filters** is an optional deny-list for messages that
should not receive an automatic reply (OTP, login codes, verification notices).

- **Ignored Senders (Ignore List)** — one phone number or JID per line. Sender
  matching also checks group participants.
- **Filter by Keywords** — off by default. Keywords and Exclude Keywords are
  operator-maintained, one phrase per line; no keyword is built in.
- A sender match, or a keyword match without an exclude match, skips both the AI
  and static auto-reply. Messages are still stored and webhooks still fire.
- OTP content is never written to the filter log; only the match reason/JID is
  logged. The filter is disabled by default.

#### Runtime date/time context

Every OpenAI-compatible request carries a server-generated `<get_info>` block
with the full weekday/date, local time, timezone and UTC offset, ISO timestamp
and Unix milliseconds. It is rebuilt for each request and placed after the
operator system instruction. The block contains facts only: no priority
attribute, no override demand, and no claim over operator instructions. No tool
call is needed; it simply keeps the model aware of the current clock.

**Routing rule** — the AI only replies when all are true:

1. `ai.enabled` is on for that number (dashboard).
2. The current time is inside `AI_WINDOW_START`–`AI_WINDOW_END`, evaluated in
   `ROUTING_TZ` (cross-midnight supported: `16:00`→`08:00`).
3. **No human replied recently** in that conversation. A reply typed on the
   phone, WhatsApp Web or the dashboard counts; messages sent through this API
   do not. Silence lasts `ROUTING_HUMAN_IDLE_MS` (default 15 min).

If a call fails, the static away message (`AUTO_REPLY_*`) is used instead, so
the customer is never left without an answer.

#### Responder chain (one owner per message)

Replies are decided by a single chain, not three independent switches:

1. **AI & Routing** — answers when enabled and eligible (`mode`: window/always),
   unless a human is active or the conversation is muted.
2. **Static auto-reply** — its `role` decides when it steps in:

   | `role` | Behaviour |
   |---|---|
   | `both` (default) | primary when the AI is off/outside its window, fallback when the AI call fails |
   | `primary` | answers whenever it is enabled; the AI only runs when static is off |
   | `fallback` | answers only when the AI fails (no credit, API error, guard block) |

3. **Webhook** — never answers; it delivers events. Every `messages.upsert`
   payload carries a `routing` block (`aiEnabled`, `aiMode`, `window`,
   `timezone`, `staticRole`) so an external system can skip replying.

The ordering is intentional: the AI is the most capable but most fragile layer,
static is the cheap always-available net, and the webhook observes rather than
competes.

#### Response modes: static vs LLM

The static auto-reply and the LLM coexist; the mode decides who answers.

| Setting | Behaviour |
|---|---|
| `ai.mode = "off"` (or `ai.enabled = false`) | Static rules (`AUTO_REPLY_*`) own the conversation |
| `ai.mode = "window"` (default) | LLM inside the window; outside it the static rules apply |
| `ai.mode = "always"` | LLM answers 24/7 — “full handle” |

Humans win in every mode: a reply typed from the phone, WhatsApp Web or the
dashboard pauses the AI for `ROUTING_HUMAN_IDLE_MS`, and
`POST /chats/:id/handoff` pauses it longer — including in `always` mode.

Precedence: **AI path → static rules → nothing**. If the AI call fails, the
static away message is sent instead, so the customer always gets an answer.

#### Tuning (env defaults, overridable per number in the UI)

| Variable | Default | Meaning |
|---|---|---|
| `AI_MODE` | `window` | `off` / `window` / `always` |
| `AI_TEMPERATURE` | `0.6` | Sampling temperature |
| `AI_TOP_P` | `0.95` | Nucleus sampling |
| `AI_MIN_P` | `0.05` | Min-p (sent only to OpenRouter bases) |
| `AI_MAX_TOKENS` | `1024` | Reply budget |
| `AI_TIMEOUT_MS` | `25000` | Provider request timeout |
| `AI_TOOL_MAX_ROUNDS` | `2` | Tool-call rounds per reply |
| `AI_HISTORY_MAX_MESSAGES` | `12` | Prior messages sent as context |
| `AI_HISTORY_MAX_AGE_MS` | `21600000` | Ignore history older than 6 hours |
| `AI_HISTORY_MAX_CHARS` | `8000` | Character budget for the history block |
| `AI_GUARD_ENABLED` | `true` | Prompt-injection guard on/off |
| `AI_GUARD_MAX_INPUT_CHARS` | `4000` | Input cap before refusal |
| `ROUTING_BATCH_IDLE_MS` | `20000` | Debounce window per conversation |
| `ROUTING_BATCH_MAX_WAIT_MS` | `60000` | Hard cap from the first message |
| `ROUTING_HUMAN_IDLE_MS` | `900000` | Human-activity pause |

Precedence: **session metadata overrides env**, and the dashboard UI writes
session metadata. Nothing requires a database.

#### Drivers

| `AI_DRIVER` | Talks to | Needs |
|---|---|---|
| `openai` (default) | any OpenAI-compatible `/chat/completions` — OpenRouter, OpenAI, Groq, Together, Ollama | `AI_BASE_URL`, `AI_MODEL`, per-number key |
| `webhook` | your own agent gateway (e.g. `apiLLM`) | `AI_AGENT_URL` |

Both drivers produce the same output (one reply text), so switching later is a
configuration change.

The dashboard exposes the OpenAI-compatible driver only. The `webhook` driver is
an advanced/env-only option for gateways that speak the custom event contract
instead of OpenAI's; if your gateway is OpenAI-compatible, point `Base URL` at
it and keep the default driver.

Default sampling values: `temperature 0.6`, `top_p 0.95`, `min_p 0.05`
(sent only when the base URL is OpenRouter), penalties `0`, `max_tokens 1024`.
Empty fields fall back to these, so a provider's own defaults apply only when
you clear a value on purpose.

#### Per-number configuration

```http
GET   /dashboard/api/sessions/:sessionId/ai-config
PATCH /dashboard/api/sessions/:sessionId/ai-config
```

`PATCH` body (every field optional, merged):

```jsonc
{
  "routing": { "aiWindowStart": "16:00", "aiWindowEnd": "08:00", "timezone": "Asia/Jakarta",
               "humanIdleMs": 900000, "handoffPauseMs": 1800000 },
  "ai": {
    "enabled": true,
    "driver": "openai",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "openai/gpt-4o-mini",
    "systemInstruction": "You are a professional assistant. Answer clearly, concisely and politely in the customer's language. Never invent facts; use the available tools when data is required.",
    "ragEndpoints": [],
    "credentialsJson": "{\"apiKey\":\"sk-or-...\",\"endpoints\":{}}"
  }
}
```

Credentials are **encrypted before persisting** (AES-256-GCM) using
`CONFIG_ENC_KEY` and are never returned by the API — reads only report
`credentialsSet` / `credentialsEncrypted`. Logs redact them by key name.

#### Knowledge endpoints (simple RAG, no vector DB)

Each endpoint declares **its own parameters** — nothing is hardcoded. They are
converted into tool schemas, so the model decides when to call them.

```jsonc
{
  "name": "web_search",
  "description": "Search the web for general information.",
  "method": "GET",
  "url": "https://api.duckduckgo.com/",
  "params": [
    { "name": "q", "type": "string", "description": "Search query", "required": true },
    { "name": "format", "type": "string", "description": "Response format", "default": "json" }
  ],
  "timeoutMs": 6000,
  "maxResponseChars": 1500
}
```

```jsonc
{
  "name": "check_weather",
  "description": "Get the current weather for a location (no API key required).",
  "method": "GET",
  "url": "https://api.open-meteo.com/v1/forecast",
  "params": [
    { "name": "latitude", "type": "number", "description": "Latitude", "required": true },
    { "name": "longitude", "type": "number", "description": "Longitude", "required": true },
    { "name": "current_weather", "type": "string", "description": "Return current weather", "default": "true" }
  ]
}
```

Parameter can target `query`, `body` or `path` (`in`). Path placeholders use
`{name}`, e.g. `/api/members/{member_number}/detail`.

Prefer the provider's own contract? Pass a raw JSON Schema instead of the
`params` list — it is forwarded to the model untouched:

```jsonc
{
  "name": "search_users",
  "method": "GET",
  "url": "https://api.example.com/v1/users/search",
  "parameters": {
    "type": "object",
    "properties": {
      "q": { "type": "string", "description": "Name, email or member id" }
    },
    "required": ["q"]
  }
}
```

With `parameters`, every argument the model produces is sent as a query string
for GET and as the JSON body otherwise — no per-parameter metadata is needed.

Credentials per endpoint live in the encrypted blob, never in the prompt:

```jsonc
{ "apiKey": "sk-or-...", "endpoints": { "web_search": { "headers": { "X-API-Key": "..." } } } }
```

Safety limits: URL always comes from configuration (never from the model),
optional private-host block (`AI_TOOL_BLOCK_INTERNAL`), per-endpoint timeout,
response truncation (`AI_TOOL_MAX_RESPONSE_CHARS`) and `AI_TOOL_MAX_ROUNDS` to
stop tool loops.

> **Status:** routing window, human-activity detection, idle **debounce**,
> provider call, tool-calling and AI→human handoff are implemented.
>
> - Messages are collected until the chat is idle for `ROUTING_BATCH_IDLE_MS`
>   (reset on every new message), capped by `ROUTING_BATCH_MAX_WAIT_MS` from the
>   first message and by `ROUTING_MAX_BATCH_MESSAGES`. One idle window → one
>   prompt → one reply.
> - After human activity the conversation stays human-owned for
>   `ROUTING_HUMAN_IDLE_MS`; the backlog that arrived meanwhile is answered in a
>   single prompt when the pause expires.
> - Exactly one timer is armed per conversation; a stale timer can never fire a
>   reply (epoch guard), so there is no periodic polling.

#### AI → human takeover

The model (or your gateway) can stop the bot for one conversation:

```http
POST /chats/:sessionId/handoff
{ "conversationId": "628xxx@s.whatsapp.net", "reason": "customer_minta_manusia", "pauseMinutes": 30 }
```

While paused, inbound messages accumulate but the AI stays silent; when the
pause expires the backlog is answered once. A human reply in the meantime
extends the pause automatically. `pauseMinutes` is clamped to 1..1440 (default
30).

#### Prompt-injection & abuse control

Layers, weakest to strongest:

1. **Tripwire (heuristics)** — obvious override / jailbreak / secret-probe
   patterns are refused before any provider call (`AI_GUARD_BLOCK_SCORE`,
   default 50). Heuristics are a signal, not a boundary.
2. **Instruction hierarchy** — customer text is wrapped in
   `<pesan_pengguna>…</pesan_pengguna>` and the system prompt states that this
   is data, never instructions.
3. **Least privilege** — tools only come from the configured allowlist, the URL
   is never model-controlled, credentials never enter the prompt, and tool
   rounds plus response size are bounded.
4. **Output scrubbing** — credential-shaped strings (API keys, bearer tokens,
   private keys) are redacted from the reply before it is sent.
5. **Abuse control** — after `AI_GUARD_MAX_STRIKES` blocked messages the
   conversation is muted for `AI_GUARD_MUTE_MS`. Messages received during a
   mute are ignored and **not queued**, so nothing stale is answered when the
   mute expires; the next genuine message resumes normal handling.

Honest limit: heuristics can be rephrased, so layers 3–5 carry the real
protection — the tripwire mainly stops scripted abuse and produces the signal
used for muting.

#### Dashboard page

A dedicated **AI & Routing** page (`#ai`, requires `manageSessions`) configures
everything per number — responder mode, window, model/credentials, system
instruction and knowledge endpoints — and shows live routing metrics. It reuses
the existing dashboard components (cards, form groups, badges, tables), so it
looks and behaves like the rest of the dashboard.

#### Routing metrics

```http
GET  /dashboard/api/ai/metrics?sessionId=<optional>
POST /dashboard/api/ai/metrics/reset
```

Counters are kept **in memory** (no database): AI replies, human-handled,
static replies, failures, tool calls, tokens and latency, plus 24 hourly
buckets and the most recent decisions. They are visible while the app is
running and reset on restart. Redis-backed persistence can be added later
without changing the endpoints.

### Brute force & rate limits

| Layer | Default | Env |
|---|---|---|
| Dashboard login per IP | 5 requests/min | (built-in) |
| Login lockout per account and per IP | 10 failures in 15 min → 15 min lock | `AUTH_MAX_FAILURES`, `AUTH_FAILURE_WINDOW_MS`, `AUTH_LOCK_MS` |
| REST API per key | 60 requests/min | `RATE_LIMIT_API_KEY` |
| Send per session+IP | 30 requests/min | (built-in) |
| Concurrent sends per session | 5 | `MAX_CONCURRENT_SENDS` |
| Send timeout | 30 s | `SEND_TIMEOUT_MS` |

Lockout responses are generic (`ACCOUNT_LOCKED`) and unknown usernames are
tracked too, so locking does not reveal whether an account exists. Rate-limited
responses carry `Retry-After`, a stable `code` (`RATE_LIMITED`,
`SESSION_BUSY`) and `retryable: true`.

For a public deployment, also put a limiter in front: nginx
`limit_req_zone`/`limit_conn_zone`, Cloudflare rate limiting or fail2ban for
repeated 401/429s. In-process limits protect one instance; the proxy protects
the whole fleet.

### Clearing vs deleting a chat

Both actions live in the **⋯ menu** attached to a chat — either in the chat header
or on each row of the chat list — so they apply to that chat only. They stay in
sync with WhatsApp and are never bulk operations, so they do not create a spam
pattern. The same menu offers Reload and Mark Read.

| Action | WhatsApp | Dashboard |
|---|---|---|
| **Clear Chat** | `chatModify({ clear: true })` — history removed, chat stays | messages removed, room stays open and empty |
| **Delete Chat** | `chatModify({ delete: true })` — chat removed | room and messages removed from the list |

One request per action. If the remote call fails the dashboard keeps its local
copy and returns `502`, so the two sides never diverge silently. A disconnected
session returns `409`. There is deliberately no "clear/delete every chat"
button: doing that through the socket would mean hundreds of requests and a real
ban risk. To clean another chat, open it and act on it individually.

The **Groups** page offers the same pair per group: **Clear Chat** (clears the
group chat on WhatsApp and locally) and **Exit & Delete** (`POST
/groups/:sessionId/leave-and-delete/:jid`, which deletes the chat, leaves the
group and removes it locally). Both use the dashboard confirmation modal — the
same dialog as chat clear/delete — instead of a native browser prompt.

Changes made on the phone are mirrored back automatically: `messages.delete`
with `{ jid, all: true }` empties the cache for a cleared chat, and
`chats.delete` removes the room locally.

### Session config persistence & cleanup

Per-number settings (webhook, AI/routing, autoReply, owner) are written to
`sessions/md_<id>/metadata.json` (file backend) or the Redis auth hash, so a
restart reconnects the session with the same configuration. Deleting a session
removes its auth folder, metadata and store file, and revokes every API key
scoped to that session so a recreated session with the same id cannot reuse an
old key.

### Session janitor, snapshots and error messages

- **Startup janitor** removes leftovers deletion/reconnect can leave behind:
  temp files older than an hour, store JSON without an auth directory (file
  backend only) older than an hour, and `md_<id>` directories without
  `creds.json` older than a day. Valid sessions (creds present) are never
  touched. It runs at startup and daily; run it manually with
  `bun run cleanup-sessions`.
- **Snapshots only write when state changed** (dirty flag) instead of rewriting
  the JSON every 60 s. `MAX_MESSAGES_PER_CHAT` (default 50) caps messages kept
  per chat; it is per chat, so other chats are never skipped — only older
  messages in each chat are dropped (AI context has its own limit).
- **5xx messages are sanitized in production**: callers get
  "Internal server error" while the original message is logged. 4xx validation
  messages and development output stay detailed.

### Storage, SSRF and credential handling

- **Session ids are validated at every storage boundary** (`^[A-Za-z0-9_-]{1,64}$`):
  routes, connection manager, auth-state files and Redis keys. A malformed id
  cannot escape `sessions/`, so delete/metadata operations cannot touch other
  files.
- **Media URLs are checked before sending** (`MEDIA_BLOCK_INTERNAL`, default
  true): a `/messages` request that points at localhost, a private range or a
  link-local host returns `400 MEDIA_URL_BLOCKED` instead of making the server
  fetch it.
- **API keys are stored hashed** and resolved with a single Redis `HGET` (or the
  cached file store) plus one legacy `GET`; the auth path no longer runs
  `KEYS`/full scans, and `lastUsedAt` is written at most once per minute per key.
- Media file downloads resolve inside `media/` with a separator-aware check.
- Audit JSONL appends are asynchronous, so disk latency never delays a response.

## 🔐 Deployment security (TLS & reverse proxy)

The API speaks plain HTTP; **terminate TLS in front of it** (Caddy, nginx,
Cloudflare, an ALB). Never publish port 3000 to the internet.

> **Subpath hosting is not supported.** The dashboard, REST API, docs, SSE and
> session cookie use absolute root paths (`/dashboard`, `/api/v1`, `/docs`,
> `Path=/dashboard`). Mounting the gateway under an arbitrary subpath (for
> example `/gateway`), with or without prefix stripping, breaks assets, cookies
> and API calls. Run it at the root of its host. Subpath support would require a
> `BASE_PATH` implementation across routes, assets, cookies, CSP and clients.

```
Internet ──HTTPS──> proxy (TLS) ──HTTP──> api:3000 (compose network only)
```

**Required settings behind a proxy**

| Variable | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | enables fail-closed JWT and rate limits |
| `TRUST_PROXY` | `true` | per-IP rate limiting from `X-Forwarded-For`; enables HTTPS detection (`X-Forwarded-Proto`) for the Secure cookie, HSTS and the HTTP→HTTPS redirect for `/dashboard` |
| `DASHBOARD_JWT_SECRET` | long random value | dashboard auth is disabled when this is missing/default |
| `CORS_ORIGIN` | explicit origin(s) | with `*` only same-origin browser requests are reflected |

**What the app enforces once TLS is in front**

- Dashboard session lives in an **HttpOnly, SameSite=Strict, Path=/dashboard**
  cookie (plus `Secure` over HTTPS). Nothing is stored in localStorage, so XSS
  cannot read the token. Bearer auth is still accepted for API/agent clients.
- SSE (`/dashboard/api/events/stream`) authenticates by cookie; no token in the
  query string (those end up in proxy access logs).
- `Content-Security-Policy` (same-origin scripts and `<style>` elements; inline
  style attributes are allowed because WebKit attaches one to native `<select>`),
  HSTS over
  HTTPS, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, restrictive
  `Permissions-Policy`.
- Cross-origin requests to `/dashboard/*` are rejected with 403.
- Plain-HTTP dashboard requests are redirected to HTTPS when `TRUST_PROXY=true`
  in production.

Optional hardening: restrict the dashboard to a VPN/Tailscale network or an IP
allowlist at the proxy, and expose only `/status` + the REST API publicly.

## 🧱 Auth-state backend, Redis limits and broadcast persistence

**Backend selection is sticky.** `AUTH_STATE_BACKEND` accepts `auto` (default),
`file` or `redis`. The first successful start records the choice in
`data/auth-state-backend.json`; later starts reuse it. That is what stops `auto`
from moving the store when Redis comes back: sessions written during an outage
stay where they were written. If the recorded backend is `redis` and Redis is
unreachable, startup fails instead of falling back to files.

**Switching backends requires confirmation.** Change `AUTH_STATE_BACKEND` to the
new value and set `AUTH_STATE_SWITCH_CONFIRM=true` for one start. The app then
records the new backend and starts with the (empty) new store so you can re-link
by QR; the old store is left untouched and nothing is deleted. Remove the
confirmation afterwards — it is a one-shot override, not a setting.

**Session ownership and quotas.** Sessions created from the dashboard record the
creating user in `ownerId`. Non-admin users see their own sessions plus any
assigned by an admin; legacy sessions without an owner keep the old assignment
semantics. `MAX_SESSIONS_PER_USER` (default 3) and `MAX_SESSIONS_PER_MANAGER`
(default 5) cap how many sessions a non-admin may create; admins are unlimited.
Deleting a user can revoke every session they own (logout + credentials).

**Dashboard markup is sanitized before insertion.** The dashboard never assigns
`innerHTML`; `UI.setHtml` runs markup through DOMPurify loaded from jsdelivr (pinned
3.4.17 with SRI) and fails closed to text when the sanitizer is absent. Because
the asset comes from a CDN, keep `CSP_CDN` enabled (the default); with
`CSP_CDN=false` the script is blocked and the dashboard renders text only. A
devDependency on `dompurify` records the pinned version used for the SRI hash.

**CSP and CDNs.** The policy allows common CDNs by default
(`cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`, Google Fonts), because
pinning a version and loading it from a CDN is normal practice. `CSP_CDN=false`
locks the policy back to same-origin. Additional origins can be appended per
directive with `CSP_EXTRA_SCRIPT_SRC`, `CSP_EXTRA_STYLE_SRC`,
`CSP_EXTRA_FONT_SRC`, `CSP_EXTRA_IMG_SRC` and `CSP_EXTRA_CONNECT_SRC`
(space-separated), so a specific CDN never requires disabling CSP.

> Honest trade-off: an allowed CDN origin can serve any code the browser will
> execute. Pin exact versions and add `integrity` (SRI) for third-party scripts —
> CSP does not replace SRI. The built-in Swagger UI page does this already.

**Swagger UI assets.** `DOCS_ASSETS=cdn` (default) loads a version-pinned
Swagger UI bundle from jsdelivr with SRI, and `DOCS_ASSETS=local` serves the copy
from `node_modules/swagger-ui-dist` for offline installs. Both work under the
same CSP.

**CSP mode.** `CSP_REPORT_ONLY=true` switches the header to
`Content-Security-Policy-Report-Only`: violations are still posted to
`/dashboard/csp-report` and `are still printed in the browser console`; the
difference is that resources are not blocked. It is a staged-rollout tool, not a
way to silence the console — keep enforcement (the default) in production and
fix the violations. The console text is "Content Security Policy" (with spaces),
so to hide only the diagnostics during development use the DevTools console
filter `-/Content Security Policy/i` (leading `-` negates, matching is regex).
On builds without regex negation, `/Content Security Policy/` shows just those
messages so they can be read or collapsed. The report endpoint accepts the
opaque `Origin: null` that browsers send with reports.

**Redis must not evict.** The bundled Redis runs with
`--maxmemory-policy noeviction`. With an eviction policy, hitting the memory cap
silently drops arbitrary keys, including session credentials, which logs the
WhatsApp session out. Failing writes loudly is the safer failure mode; raise
`--maxmemory` / the container limit when you outgrow it.

**Broadcast queues are in-memory.** `broadcastQueue` is a plain in-process
`Map`: enabling Redis does **not** make broadcasts survive a restart. Redis is
used for auth state, API keys and the broadcast *result* cache only. If restart
durability for broadcasts matters, it has to be implemented separately.

## 🏷️ Versioning & releases

Versions follow [Semantic Versioning](https://semver.org/), decided by the
Conventional Commit that introduced the change:

| Commit | Bump |
|---|---|
| `feat:` | minor |
| `fix:`, `perf:`, `security:` | patch |
| `feat!:`, `refactor!:`, `BREAKING CHANGE` | major |

Every release is tagged `vX.Y.Z` and recorded in [CHANGELOG.md](CHANGELOG.md).
Create the next one with:

```bash
bun run release:patch   # or release:minor / release:major
git push origin HEAD --follow-tags
```

The helper refuses a dirty tree, generates the changelog entry from commits
since the previous tag, bumps `package.json`, commits `chore(release): x.y.z`
and creates the annotated tag. It never pushes; the command above is the final
manual step. Use `node scripts/release.mjs patch --dry-run` to preview.

## 🐳 Docker Deployment

The project provides configurations for both runtimes. Everything runs in a single
API container; Redis is optional and never published to the host.

First, create your environment file:

```bash
cp .env.example .env
# edit .env (secrets, dashboard JWT, webhook flags, …)
```

#### Option A: Docker with Bun (Default & Recommended)

```bash
docker compose up -d
docker compose logs -f api
```

#### Option B: Docker with Node.js

The Node image compiles the TypeScript sources with Bun at build time and then
runs the plain-JS bundle on native Node.js.

```bash
docker compose -f docker-compose.node.yml up -d
docker compose -f docker-compose.node.yml logs -f api
```

#### Redis options

Redis is **optional** and resolved at runtime from `REDIS_ENABLED` / `REDIS_URL`:

| Scenario | What to do |
|---|---|
| No Redis (file-based storage) | `REDIS_ENABLED=false` in `.env` (default) — just run compose |
| Redis already on the VPS host | `REDIS_ENABLED=true` and `REDIS_URL=redis://host.docker.internal:6379` |
| Redis already on the VPS in another container | `REDIS_ENABLED=true` and `REDIS_URL=redis://<host-or-container>:6379` |
| Bundled Redis container | `REDIS_ENABLED=true`, `REDIS_URL=redis://redis:6379`, then run compose with `--profile redis` |

```bash
# bundled Redis (isolated: no host port is published)
docker compose --profile redis up -d
docker compose -f docker-compose.node.yml --profile redis up -d   # Node variant
```

The bundled Redis has no published port, so it never collides with a Redis
already running on the VPS. Stop it with the same profile flag:

```bash
docker compose --profile redis down
```

#### Changing the port

`PORT` in `.env` is honored on both sides of the mapping, and the container
health check follows it:

```bash
PORT=8080   # → host 8080 → container 8080, healthy
```

To stop containers: `docker compose down`

---

## 🖥️ Visual Dashboard

The API includes an intuitive, modular web dashboard to manage everything visually without touching the CLI.

### Dashboard Configuration (`.env`)

```env
DASHBOARD_ENABLED=true
DASHBOARD_REGISTRATION_ENABLED=false
DASHBOARD_REGISTRATION_REQUIRE_APPROVAL=true
DASHBOARD_JWT_SECRET=super-secret-key-change-me
DASHBOARD_PASSWORD_MIN_LENGTH=6

# Session ownership / quotas for non-admin users (0 = unlimited)
MAX_SESSIONS_PER_USER=3
MAX_SESSIONS_PER_MANAGER=5

# Keep CSP enforcing; see the CSP mode note in the security section
CSP_REPORT_ONLY=false
```

### Initial Setup

1. Open `http://localhost:3000/dashboard/` in your browser.
2. If `data/dashboard-users.json` is empty, you will be prompted to create the very first **Admin Account**.
3. Create your account with a secure password (hashed via `bcryptjs`).
4. Once created, recommended to set `DASHBOARD_REGISTRATION_ENABLED=false` in `.env` to prevent public sign-ups.

### Role & Access Model

- `admin`: **all sessions** plus users/approval/roles, create/delete, webhooks,
  AI, REST API keys and every messaging capability.
- `manager`: **assigned sessions** (or all sessions when the admin ticks
  **All Sessions**). Can reconnect, edit session settings, manage webhooks, AI
  routing and REST keys **for those sessions only**, plus chats/groups/outbound.
  Cannot create or delete sessions and has no account/user controls.
- `assistant`: **only assigned sessions**, chat/group support with single-message
  outbound (Bulk Send is hidden). Can open Groups in view-only mode and Settings
  for account/password and About; role permissions, quick actions, Sessions, AI,
  webhooks, REST API, events and user management stay hidden. An empty
  assignment grants no session at all, so unassigned numbers never appear in
  dashboard or API responses.
- Session creation/deletion is admin-only. Managers receive a **Reconnect**
  action for disconnected assigned sessions; reconnect preserves persisted
  webhook/AI/routing settings and never deletes credentials.
- Sessions record their creator (`ownerId`) for quotas and audit, but ownership
  does not widen a manager or assistant beyond its assignment.
- Admins can **add users**, change roles, approve pending accounts, and delete a
  user while optionally revoking every session they own (logout + credentials).

### Registration & Approval Behavior

- `DASHBOARD_REGISTRATION_ENABLED=false`: registration form is disabled for additional users.
- `DASHBOARD_REGISTRATION_REQUIRE_APPROVAL=true`: newly registered users remain pending until approved by admin.
- The first bootstrap admin (when user file is empty) is created immediately.

### Features

- **Sessions**: Add WhatsApp accounts (QR/Pairing Code), Delete accounts safely (auto-cleans media/logs).
- **Messaging**: Test sending texts, images, and bulk broadcasts interactively.
- **Webhooks**: Configure webhook URLs and event subscriptions per-session.
- **AI & Routing**: Per-number auto-response — responder mode (off/window/always),
  time window and timezone, OpenAI-compatible model + encrypted credentials,
  system instruction, knowledge endpoints (tool-calling RAG), and live routing
  metrics.
- **Events**: Real-time SSE (Server-Sent Events) live log for WhatsApp events.
- **Admin & users**: Add users, approve registrations, change roles, scope
  sessions, and revoke sessions/credentials when deleting a user.
- **Security**: HttpOnly session cookie, strict CSP with violation reporting
  (`/dashboard/csp-report`), HSTS behind TLS, same-origin dashboard APIs.

---

## 🔐 API Authentication

The raw REST API `/chats`, `/groups`, etc., supports two authentication methods:

### 1. Simple Token (Dev / Single-User)

Set `AUTH_GLOBAL_TOKEN` in `.env`:

```env
AUTH_GLOBAL_TOKEN=your-secret-token-here
```

Supported headers for simple token mode:

- `Authorization: Bearer <token>`
- `x-api-key: <token>`
- `x-access-token: <token>`
- `token: <token>`

Use in requests:

```bash
curl -H "Authorization: Bearer your-secret-token-here" http://localhost:3000/sessions
```

### 2. Redis API Keys (Production / Multi-User)

Requires `REDIS_ENABLED=true`. Manage keys using the CLI:

```bash
# Bun Runtime
bun run manage-api-keys create user

# Node.js Runtime
npm run manage-api-keys:node create admin
```

Use header: `x-api-key: <your-api-key>`

```bash
# Create user API key
bun run manage-api-keys create user

# Create admin API key
bun run manage-api-keys create admin

# List all keys
bun run manage-api-keys list

# Delete a key
bun run manage-api-keys delete <api-key>
```

Use in requests:

```bash
curl -H "x-api-key: <your-api-key>" http://localhost:3000/sessions
```

> **Note**: In `development` mode (`NODE_ENV=development`), API authentication is skipped entirely.

### Dashboard Authentication (UI)

- Dashboard endpoints (`/dashboard/api/*`) use JWT-based auth.
- SSE/Event stream endpoints use short-lived stream-scoped tokens.
- Stream token endpoint: `GET /dashboard/api/auth/stream-token`

---

## 🔑 Managed API keys & audit log

Open **Dashboard → REST API** (admin only) to create and revoke keys without the
CLI. Each key stores:

| Field | Meaning |
|---|---|
| Label | Human name (`chatbot-widget`) |
| Session | The single session this key may send from |
| Last used | Updated on every authenticated call |

There is no role selector: REST keys are send-only (`user`). Admin-only
operations stay behind the dashboard session. **One key belongs to one
session**, so create a separate key per number you expose; the page only appears
while at least one session is connected.

The token is shown **once** at creation and stored only as a SHA-256 hash. A
leaked dump does not expose usable keys. Storage is flexible: every record is
written to `data/api-keys.json`, and mirrored into Redis when it is available
(reads merge both, deletes remove both) — Redis is not required. Legacy
plaintext keys are migrated automatically on first use. Scope is enforced on
`/api/v1/messages`: a key bound to `ROG8` gets `403` when `from` resolves to
another session.

Every call is written to the audit log (Dashboard → REST API → Request log):
time, key id/label, session, masked receiver, type, status, latency and IP. The
message body is **not** stored unless `AUDIT_LOG_BODY=true`, and tokens never
appear in the log. Entries also append to `logs/api-audit-YYYY-MM-DD.jsonl` and
are pruned after `AUDIT_LOG_RETENTION_DAYS`.

```bash
# Create a key bound to one session (admin session cookie required)
curl -X POST https://your-domain.com/dashboard/api/api-keys \
  -H "Content-Type: application/json" \
  -b "wa_dashboard_session=<cookie>" \
  -d '{"label":"chatbot-widget","session":"ROG8"}'
```

## 📱 API Usage Examples

### Create Session (Pairing Code)

```bash
POST /sessions/my-session
Content-Type: application/json

{
  "usePairingCode": true,
  "phoneNumber": "+6281234567890",
  "webhookUrl": "http://your-server.com/webhook"
}
```

### Send an Image

```bash
POST /chats/my-session/send
Content-Type: application/json

{
  "receiver": "6281234567890",
  "message": {
    "image": { "url": "https://example.com/image.jpg" },
    "caption": "Check this out!"
  }
}
```

### Unified send (third-party friendly)

Base URL depends on where the API runs:

| Environment | Base URL |
|---|---|
| Local / development | `http://localhost:3000` |
| Production (VPS) | `https://your-domain.com` (or whatever your reverse proxy exposes) |

So the canonical endpoint is `<BASE_URL>/api/v1/messages`; the older
`<BASE_URL>/messages` stays available as an alias. One endpoint for widgets,
chatbots and LLM tools. Authenticate with the same API
key as the rest of the REST API (`Authorization: Bearer <API_KEY>` or
`x-api-key`). `from` accepts a session id or the WhatsApp number bound to it.

```bash
POST https://your-domain.com/api/v1/messages
Content-Type: application/json
Authorization: Bearer <API_KEY>

{
  "from": "ROG8",
  "receiver": "628123456789",
  "type": "text",
  "messages": "Halo, ini pesan dari bot."
}
```

| `type` | Required fields |
|---|---|
| `text` (default) | `messages` |
| `image` | `media.url`; `messages` becomes the caption |
| `document` | `media.url`, optional `media.filename`, `media.mimetype` |
| `location` | `location.latitude`, `location.longitude`, optional `name`/`address` |

```bash
# Image with caption
POST https://your-domain.com/api/v1/messages
{
  "from": "62812xxxxxxx",
  "receiver": "62813xxxxxxx",
  "type": "image",
  "messages": "Bukti transfer",
  "media": { "url": "https://example.com/bukti.jpg" }
}

# Document
{
  "from": "ROG8",
  "receiver": "62813xxxxxxx",
  "type": "document",
  "media": {
    "url": "https://example.com/invoice.pdf",
    "filename": "invoice.pdf",
    "mimetype": "application/pdf"
  }
}

# Location
{
  "from": "ROG8",
  "receiver": "62813xxxxxxx",
  "type": "location",
  "location": {
    "latitude": -6.2,
    "longitude": 106.8,
    "name": "Kantor",
    "address": "Jl. Contoh 1"
  }
}
```

### Copy-paste integration snippet

Four separate blocks, ready for a chatbot tool definition (the dashboard shows
the same text in **REST API → Integration snippet**).

**Method & URL**

```
POST https://your-domain.com/api/v1/messages
```

**Headers**

```
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

**JSON Schema (tool parameters)**

```json
{
  "description": "Send a WhatsApp message from a connected session. Use text for plain messages, image/document with media.url, and location with latitude/longitude.",
  "type": "object",
  "required": ["from", "receiver"],
  "properties": {
    "from": { "type": "string", "description": "Session id (e.g. ROG8) or the phone number bound to it." },
    "receiver": { "type": "string", "description": "Recipient in international digits (e.g. 628123456789), a JID, or a group id ending with @g.us." },
    "type": { "type": "string", "enum": ["text", "image", "document", "location"], "description": "Message kind. Defaults to text." },
    "messages": { "type": "string", "description": "Text body, or the caption for image and document." },
    "media": {
      "type": "object",
      "required": ["url"],
      "description": "Required for image and document.",
      "properties": {
        "url": { "type": "string", "description": "Public file URL." },
        "filename": { "type": "string", "description": "Displayed file name." },
        "mimetype": { "type": "string", "description": "MIME type, e.g. application/pdf." }
      }
    },
    "location": {
      "type": "object",
      "required": ["latitude", "longitude"],
      "description": "Required for location.",
      "properties": {
        "latitude": { "type": "number", "description": "Decimal degrees." },
        "longitude": { "type": "number", "description": "Decimal degrees." },
        "name": { "type": "string", "description": "Place name." },
        "address": { "type": "string", "description": "Street address." }
      }
    },
    "isGroup": { "type": "boolean", "description": "Force group semantics when receiver is not an @g.us JID." }
  }
}
```

**Example body**

```json
{
  "from": "ROG8",
  "receiver": "628123456789",
  "type": "text",
  "messages": "Halo, ini pesan dari bot."
}
```

#### Full tool definition (download)

The dashboard can also emit one combined object (`Download .json`, saved as
`whatsapp-tool-<session>.json`) that a tool-import UI can consume directly:

```json
{
  "name": "send_whatsapp_message",
  "description": "Send a WhatsApp message from a connected session.",
  "method": "POST",
  "url": "https://your-domain.com/api/v1/messages",
  "headers": {
    "Authorization": "Bearer <API_KEY>",
    "Content-Type": "application/json"
  },
  "parameters": { "...": "the schema block above" },
  "example": {
    "from": "ROG8",
    "receiver": "628123456789",
    "type": "text",
    "messages": "Halo, ini pesan dari bot."
  }
}
```

For validators that want the stricter contract, the full draft-07 schema
(`oneOf` rules per type) is served at `GET /api/v1/messages/schema`.

Success response:

```json
{
  "success": true,
  "data": {
    "messageId": "3EB0...",
    "to": "628123456789@s.whatsapp.net",
    "type": "text",
    "timestamp": 1761000000
  },
  "message": "Message sent successfully"
}
```

Every failure is structured so a calling LLM can correct itself. Nothing
returns a bare status code:

```json
{
  "success": false,
  "code": "SESSION_NOT_CONNECTED",
  "message": "Session \"ROG8\" is not connected",
  "field": "from",
  "hint": "Reconnect the session from Dashboard → Sessions (scan the QR code), then retry this request.",
  "details": { "session": "ROG8", "connected": false },
  "retryable": true,
  "requestId": "mvxu1abc-9f2k"
}
```

| HTTP | `code` | Meaning | What to do |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | Body failed validation | Read `field` and `details.issues` (all issues, not just the first) |
| 400 | `RECEIVER_NOT_ON_WHATSAPP` | Number not registered on WhatsApp | Use international digits (`628123456789`) and confirm WhatsApp exists |
| 401 | `UNAUTHORIZED` | Missing or revoked API key | Send `Authorization: Bearer <API_KEY>`; create a key in Dashboard → REST API |
| 403 | `KEY_NOT_SCOPED` | Key cannot use that `from` | Use an allowed `from`; see `details.allowed` |
| 403 | `GROUP_DISABLED` | Group sending is off | Send 1:1, or enable `ALLOW_GROUP_SEND` |
| 403 | `GROUP_NOT_ALLOWED` | Group not in the allowlist | Add the JID to `ALLOWED_GROUP_JIDS` |
| 404 | `SESSION_NOT_FOUND` | `from` did not resolve | Use a session id from `details.available` (or `GET /sessions`) |
| 409 | `SESSION_NOT_CONNECTED` | Session exists but is offline | Reconnect via Dashboard → Sessions, then retry |
| 500 | `SEND_FAILED` | Unexpected send failure | Retry once; if it persists, report the `requestId` |

`retryable` is `true` for `409` and `5xx` only: after reconnecting a session a
retry is sensible, while a bad `receiver` or missing field will fail again until
the request changes.

**Groups are opt-in.** Send to `...@g.us` only when `ALLOW_GROUP_SEND=true`;
optionally restrict with `ALLOWED_GROUP_JIDS`. Group blasts are the highest ban
risk for an unofficial client — keep them allowlisted and low-volume.

### Send Bulk Messages (Anti-Spam)

```bash
POST /chats/my-session/send-bulk
Content-Type: application/json

{
  "messages": [
    { "receiver": "6281234567890", "message": { "text": "Hello #1" } },
    { "receiver": "6281234567891", "message": { "text": "Hello #2" } }
  ]
}
```

Response:

```json
{
 "success": true,
 "message": "Broadcast job created",
 "data": { "jobId": "bc_1709271000_abc123", "total": 3, "status": "pending" }
}
```

Track progress:

```bash
GET /chats/my-session/broadcast/bc_1709271000_abc123
```

### Standard response envelope (`code` & `requestId`)

Every public API response (success or error) is a stable JSON envelope:

- **Success** — `{ success, message, data?, requestId }`
- **Error** — `{ success: false, message, code, requestId }`

`code` is a machine-readable error code derived from the HTTP status so
integrators can branch programmatically instead of parsing free-text
messages:

| HTTP | `code` |
| --- | --- |
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 422 | `UNPROCESSABLE_ENTITY` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |
| 503 | `SERVICE_UNAVAILABLE` |
| … | `HTTP_<status>` fallback |

`requestId` lets you trace a request end-to-end across logs and reverse
proxies. Send your own id in the `x-request-id` header to have it echoed
back, or omit it and one is generated for you.

Example:

```bash
curl -i -X POST /chats/missing-session/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-request-id: req_12345" \
  -H "Content-Type: application/json" \
  -d '{"receiver":"6281234567890","message":{"text":"hi"}}'
```

```json
HTTP/1.1 404 Not Found
{ "success": false, "message": "Session 'missing-session' not found", "code": "NOT_FOUND", "requestId": "req_12345" }
```

### Create a Group

```bash
POST /groups/my-session/create
Content-Type: application/json

{
  "groupName": "API Test Group",
  "participants": ["6281234567890", "6281234567891"]
}
```

### Webhook Events

Set `WEBHOOK_URL` in `.env` or per-session. Events are sent as POST:

```json
{
  "sessionId": "my-session",
  "event": "messages.upsert",
  "data": { "messages": [...], "type": "notify" }
}
```

Webhook requests are authenticated with the configured secret sent in **two headers**
so both legacy and standard receivers work (this is deliberate, kept in a single
header builder):

- `x-webhook-secret: <secret>` — legacy receivers built for this API
- `Authorization: Bearer <secret>` — standard receivers / API gateways

When signature mode is enabled, webhook requests also include:

- `x-webhook-timestamp`
- `x-webhook-signature: sha256=<hmac>`

(The signature uses the *same* secret — a shared-secret HMAC over
`"<timestamp>.<body>"`, not a separate signing key — so only verify it if you
control the receiver and trust the shared secret.)

Controlled by:

- `WEBHOOK_SIGNATURE_MODE=off|optional|required` (default `optional`;
  `required` once the receiver verifies signatures)
- `WEBHOOK_INCLUDE_TOKEN=true|false` — legacy static-token headers. Set
  `false` after the receiver verifies `X-Webhook-Signature`; the secret then
  stays off the wire. Requests also carry a stable `X-Webhook-Id` for
  deduplication.
- `WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK=true|false`

Webhook secrets are **never returned** by list endpoints; the dashboard shows
only `hasWebhookSecret` and the last four characters. Submitting an empty secret
keeps the stored one (use `clearWebhookSecret: true` to remove it).

Secrets are encrypted at rest in session metadata when `CONFIG_ENC_KEY` is set
(otherwise they carry a `plain:` prefix for backward compatibility).
`POST /dashboard/api/sessions/:sessionId/webhook/rotate` generates a 32-byte
secret, stores the encrypted value and returns the plaintext **once**. The
previous secret remains **primary** for `WEBHOOK_SECRET_GRACE_MS` (default
24 h), so existing receivers keep working while they are updated; the new
secret is sent in `x-webhook-secret-new` and `x-webhook-signature-new`. After
the grace window the new secret becomes primary. Pass `graceMs: 0` (API) to
invalidate the old secret immediately. Rotation is manual: there is no
recurring 24-hour expiry and nothing rotates on its own. Dead-letter JSONL
persistence omits the secret; replay resolves the active one from the session.

**Token auth is not replay protection.** TLS protects the wire only: a bearer
token (`Authorization`, `x-webhook-secret`) captured in receiver, reverse-proxy,
APM or error-report logs remains usable even without intercepting TLS. Redact
those headers everywhere, never put secrets in URLs, and rotate if a log dump
may have been exposed. `x-webhook-signature` + `x-webhook-timestamp` +
`x-webhook-id` only add replay resistance when the receiver enforces freshness
(for example ±5 minutes) and deduplicates delivery IDs; the headers themselves
do not reject an old request. Prefer HMAC and stop sending the token when the
receiver supports it, but token auth with strict log hygiene is an accepted
tradeoff for simpler integrations.

Fallback order for webhook auth/signing secret:

1. Per-session webhook secret
2. `AUTH_GLOBAL_TOKEN` (only when fallback is enabled)

#### Delivery hardening (retries, rate limit, circuit breaker, dead-letter)

Outbound delivery is hardened per receiver URL (see `.env.example`):

- **Smart retry** — non-retryable 4xx give up immediately; 429/503 honor
  `Retry-After` (capped); 5xx/408/425/network retry with backoff
  (`WEBHOOK_RETRY_MAX`, `WEBHOOK_RETRY_INTERVAL`, `WEBHOOK_BACKOFF_FACTOR`,
  `WEBHOOK_RETRYABLE_STATUSES`).
- **Per-URL rate limit** — `WEBHOOK_RATE_PER_MIN` (0 = off) token-bucket per
  receiver; extra events wait (bounded, fail-open) instead of being dropped.
- **Circuit breaker** — `WEBHOOK_CIRCUIT_FAILURES` (default 5) consecutive
  genuine failures (retryable 5xx / network errors — not 4xx or healthy 429s)
  pause delivery to that endpoint for `WEBHOOK_CIRCUIT_RESET_MS` (default
  30s). Paused deliveries are logged as `skipped` and never silently dropped.
- **Gzip** — bodies larger than `WEBHOOK_GZIP_THRESHOLD` bytes (default
  16 KB; 0 = off) are sent with `Content-Encoding: gzip`. The signature is
  computed over the *uncompressed* JSON, so receivers decompress first, then
  verify.
- **Dead-letter** — `WEBHOOK_DEAD_LETTER_ENABLED` keeps deliveries that
  exhausted retries (in-memory, optionally persisted as JSONL to
  `WEBHOOK_DEAD_LETTER_DIR`) for manual replay via the dashboard.
- **SSRF guard** — redirects are never followed, and when
  `WEBHOOK_BLOCK_INTERNAL=true` the hostname is resolved and every answer is
  checked against private/loopback/link-local ranges (textual checks alone miss
  DNS rebinding). `WEBHOOK_BLOCK_INTERNAL=true` rejects webhook URLs
  pointing at localhost / private networks (off by default so local testing
  works).

Available events:

- `connection.update` — Connection state changes (QR, open, close)
- `messages.upsert` — New messages received
- `messages.update` — Message status updates (sent, delivered, read)
- `messages.delete` — Messages deleted
- `messages.reaction` — Reactions added/removed
- `chats.upsert`, `chats.update`, `chats.delete`
- `contacts.upsert`, `contacts.update`
- `groups.upsert`, `groups.update`
- `group-participants.update`
- `presence.update`
- `blocklist.set`, `blocklist.update`

---

## 📂 Project Structure

```
baileys-wa-api/
├── data/                           # Dashboard users and internal dashboard data (JSON)
├── media/                          # Downloaded media files
├── sessions/                       # Auth/session state per WhatsApp session
├── scripts/
│   └── manage-api-keys.ts          # API key management CLI
├── src/
│   ├── index.ts                    # Runtime entry point (Bun/Node)
│   ├── app.ts                      # Hono app bootstrap + routes + docs
│   ├── config.ts                   # Centralized environment config
│   ├── baileys/
│   │   ├── connection.ts           # BaileysConnection class
│   │   ├── connectionManager.ts    # Multi-session manager
│   │   ├── types.ts                # Type definitions
│   │   ├── authState/
│   │   │   ├── index.ts            # Auth state factory
│   │   │   ├── file.ts             # File-based auth
│   │   │   └── redis.ts            # Redis-based auth
│   │   ├── store/
│   │   │   └── memoryStore.ts      # In-memory message store
│   │   └── helpers/
│   │       ├── downloadMedia.ts    # Media download utilities
│   │       └── shouldIgnoreJid.ts  # JID filtering
│   ├── dashboard/
│   │   ├── api.ts                  # Dashboard backend APIs (stats/events/webhooks)
│   │   ├── auth.ts                 # Dashboard auth + users/roles/approval
│   │   ├── eventBus.ts             # In-process event bus for SSE
│   │   └── loader.ts               # Dashboard route/static loader
│   ├── dashboard-ui/
│   │   ├── index.html              # Dashboard SPA shell
│   │   ├── css/
│   │   │   └── styles.css
│   │   └── js/
│   │       ├── api.js
│   │       ├── app.js
│   │       ├── auth.js
│   │       ├── theme.js
│   │       ├── components/
│   │       │   ├── modal.js
│   │       │   └── toast.js
│   │       └── pages/              # overview/sessions/chatrooms/groups/webhooks/events/settings
│   ├── lib/
│   │   ├── logger.ts               # Pino logger
│   │   ├── redis.ts                # Redis client helpers
│   │   ├── response.ts             # API response helpers
│   │   └── runtime.ts              # Bun/Node runtime abstraction
│   ├── middleware/
│   │   ├── auth.ts                 # API authentication
│   │   ├── rateLimit.ts            # API rate limiting
│   │   └── sessionValidator.ts     # Session existence check
│   ├── routes/
│   │   ├── session.ts              # Session CRUD
│   │   ├── chat.ts                 # Chat operations
│   │   ├── group.ts                # Group management
│   │   ├── profile.ts              # Profile management
│   │   ├── media.ts                # Media handling
│   │   ├── story.ts                # Story broadcasting
│   │   └── status.ts               # Server health
│   ├── schemas/
│   │   ├── chat.ts                 # Chat schemas
│   │   ├── group.ts                # Group schemas
│   │   └── session.ts              # Session schemas
│   ├── services/
│   │   ├── broadcastQueue.ts       # Broadcast queue with delays
│   │   └── mediaCleanup.ts         # Media file cleanup
│   │   └── webhookLog.ts           # Webhook delivery log storage
│   └── utils/
│       ├── asyncSleep.ts           # Async sleep utilities
│       ├── phone.ts                # Phone/JID formatting
│       └── validation.ts           # Validation utilities
├── .env.example
├── biome.jsonc
├── docker-compose.yml
├── docker-compose.node.yml
├── Dockerfile
├── Dockerfile.node
├── package.json
├── tsconfig.json
└── README.md
```

---

## ⚙️ Configuration Reference (`.env`)

| Variable                                  | Default                          | Description                                                              |
| ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`                                | `development`                    | Environment (`development` / `production`)                               |
| `HOST`                                    | `0.0.0.0`                        | Server host                                                              |
| `PORT`                                    | `3000`                           | Server port                                                              |
| `LOG_LEVEL`                               | `info`                           | Log level (`debug`, `info`, `warn`, `error`)                             |
| `AUTH_GLOBAL_TOKEN`                       | —                                | Simple auth token                                                        |
| `REDIS_ENABLED`                           | `false`                          | Enable Redis integration                                                 |
| `REDIS_URL`                               | `redis://localhost:6379`         | Redis connection URL                                                     |
| `REDIS_PASSWORD`                          | —                                | Redis password                                                           |
| `BAILEYS_LOG_LEVEL`                       | `warn`                           | Baileys internal log level                                               |
| `MAX_RETRIES`                             | `5`                              | Max reconnection attempts                                                |
| `RECONNECT_INTERVAL`                      | `5000`                           | Reconnection delay (ms)                                                  |
| `MAX_SESSIONS`                            | `50`                             | Maximum concurrent WhatsApp sessions                                     |
| `WEBHOOK_URL`                             | —                                | Default webhook URL                                                      |
| `WEBHOOK_CONCURRENCY`                     | `20`                             | Max concurrent outbound webhook requests globally                        |
| `WEBHOOK_SIGNATURE_MODE`                  | `optional`                       | Webhook signature mode (`off`, `optional`, `required`)                   |
| `WEBHOOK_INCLUDE_TOKEN`                   | `true`                           | Legacy static-token headers; `false` after receivers verify HMAC         |
| `WEBHOOK_SECRET_GRACE_MS`                 | `86400000`                       | After rotation, keep the old secret primary this long (0 = immediate)    |
| `WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK`     | `true`                           | Allow fallback to `AUTH_GLOBAL_TOKEN` for webhook secret/signature       |
| `WEBHOOK_ALLOWED_EVENTS`                  | `ALL`                            | Comma-separated event filter                                             |
| `WEBHOOK_RETRY_MAX`                       | `3`                              | Webhook delivery retry count                                             |
| `WEBHOOK_RETRY_INTERVAL`                  | `5000`                           | Initial webhook retry delay (ms)                                         |
| `WEBHOOK_BACKOFF_FACTOR`                  | `3`                              | Exponential backoff multiplier                                           |
| `BROADCAST_MIN_DELAY_MS`                  | `1500`                           | Min delay between bulk messages                                          |
| `BROADCAST_MAX_DELAY_MS`                  | `3000`                           | Max delay between bulk messages                                          |
| `BROADCAST_BATCH_SIZE`                    | `10`                             | Messages per batch before pause                                          |
| `BROADCAST_BATCH_PAUSE_MS`                | `5000`                           | Pause between batches                                                    |
| `BROADCAST_TYPING_SIMULATION`             | `false`                          | Show a per-recipient "composing…" bubble during broadcasts (default: false — safer/less bot-like; adds typing delay per recipient) |
| `BROADCAST_DELAY_DISTRIBUTION`            | `uniform`                        | Delay pattern between messages: `uniform` (random min–max, legacy) or `human` (short gaps + occasional longer pauses) |
| `BROADCAST_BATCH_CHECK_WA`                | `false`                          | Check recipient WA-registration in batches (fewer usync queries) instead of 1-by-1 |
| `BROADCAST_CHECK_WA_BATCH_SIZE`           | `50`                             | Batch size when `BROADCAST_BATCH_CHECK_WA=true`                          |
| `MEDIA_INCLUDE_BASE64`                    | `false`                          | Include media in webhooks                                                |
| `MEDIA_CLEANUP_ENABLED`                   | `true`                           | Auto-delete old media files                                              |
| `MEDIA_CLEANUP_INTERVAL_MS`               | `3600000`                        | Media cleanup interval (ms)                                              |
| `MEDIA_MAX_AGE_HOURS`                     | `24`                             | Max age of media files                                                   |
| `CORS_ORIGIN`                             | `*`                              | CORS allowed origins                                                     |
| `TRUST_PROXY`                             | `false`                          | Trust `x-forwarded-for`/`x-real-ip`/`cf-connecting-ip` for client IP. Enable ONLY behind a trusted reverse proxy/LB; when `false` the socket address is used so spoofed headers cannot bypass rate limits |
| `DASHBOARD_ENABLED`                       | `true`                           | Enable internal UI dashboard                                             |
| `DASHBOARD_REGISTRATION_ENABLED`          | `false`                          | Allow account creation                                                   |
| `DASHBOARD_REGISTRATION_REQUIRE_APPROVAL` | `true`                           | Require admin approval before new user can login                         |
| `DASHBOARD_PASSWORD_MIN_LENGTH`           | `6`                              | Minimum password length for dashboard users                              |
| `DASHBOARD_JWT_SECRET`                    | `change-this-to-a-random-secret` | JWT secret for dashboard auth. **In production**: if unset/still default, dashboard auth is disabled (fail-closed, 503) — generate with `openssl rand -base64 48` |
| `SIMULATE_TYPING_BEFORE_SEND`             | `true`                           | Auto-send "composing" presence before each message (default: true)       |
| `SIMULATE_TYPING_DELAY_MIN_MS`            | `1500`                           | Typing delay range in ms (random between min-max)                        |
| `SIMULATE_TYPING_DELAY_MAX_MS`            | `3000`                           | Typing delay range in ms (random between min-max)                        |
| `AUTO_READ_MESSAGES`                      | `false`                          | **⚠ RISK**: auto-mark incoming as read. Instant 0ms reads on 100% of chats is a bot signature & may trigger bans. Leave `false` unless required; if enabled also set `AUTO_READ_DELAY_ENABLED=true` for a natural delay |
| `AUTO_READ_DELAY_ENABLED`                 | `true`                           | Wait a natural "opened chat" delay before marking read (only when `AUTO_READ_MESSAGES=true`); `false` = read instantly (legacy) |
| `AUTO_READ_DELAY_MIN_MS`                  | `1500`                           | Min random "opened chat" delay before read receipt (ms)                 |
| `AUTO_READ_DELAY_MAX_MS`                  | `4000`                           | Max random "opened chat" delay before read receipt (ms)                 |
| `AUTO_MARK_ONLINE`                        | `true`                           | Auto-set presence to "available" when sending messages (default: true)   |
| `REJECT_CALLS`                            | `false`                          | Auto-reject incoming calls across all sessions                           |
| `HUMANIZE_READ_BEFORE_REPLY`              | `false`                          | Before auto-replying to a 1-on-1 chat, wait a natural "reading" gap then mark as read (bot-like instant replies without prior read = risky) |
| `HUMANIZE_READ_DELAY_MIN_MS`              | `800`                            | Min random "reading" gap before the read receipt (ms)                   |
| `HUMANIZE_READ_DELAY_MAX_MS`              | `2500`                           | Max random "reading" gap before the read receipt (ms)                   |
| `HUMANIZE_THINK_MIN_MS`                   | `800`                            | Min random "thinking" gap before typing starts (ms)                     |
| `HUMANIZE_THINK_MAX_MS`                   | `2000`                           | Max random "thinking" gap before typing starts (ms)                     |
| `HUMANIZE_TYPING_PROPORTIONAL`            | `false`                          | When `true`, typing ("composing") duration scales with reply length instead of a fixed random range. Default `false` = legacy fixed random typing delay (controlled by `SIMULATE_TYPING_DELAY_*`) |
| `HUMANIZE_PRESENCE_DEDUPE_MS`             | `0`                              | Min gap between repeated composing/paused to the same chat (ms); `0` = always send (legacy) |
| `HUMANIZE_GLOBAL_PACING_MIN_MS`           | `0`                              | Min random gap between ANY outbound actions within a session (ms); `0` = off (legacy) |
| `HUMANIZE_GLOBAL_PACING_MAX_MS`           | `0`                              | Max random gap between ANY outbound actions within a session (ms); `0` = off (legacy) |
| `HUMANIZE_DELAY_DISTRIBUTION`             | `uniform`                        | Delay pattern for humanize read/think gaps: `uniform` (random min–max, legacy) or `human` (short gaps + occasional longer pauses) |

### CORS & reverse-proxy notes

- **`CORS_ORIGIN=*`** (default) is safe for a token-based public API: CORS only controls which browser origins may *read responses*, it is **not** authentication — requests still need `AUTH_GLOBAL_TOKEN` / API keys. Restrict it (comma-separated origins) when a browser dashboard on another domain must talk to this API, or when you never want other sites to read responses.
- **`TRUST_PROXY=false`** (default) uses the socket address for rate limiting — spoofed `x-forwarded-for` headers cannot bypass limits. Set `TRUST_PROXY=true` **only** behind a trusted reverse proxy / load balancer (Nginx, Caddy, Cloudflare, AWS ALB) so the real client IP is used.

---

## 🧪 Useful Scripts

Use these commands for validation and maintenance:

```bash
# Type-check only
npm run build-check

# Lint with error-level gate
npm run lint

# Full lint diagnostics
npm run lint:all

# Auto-format/fix source files
npm run format
```

API key helper:

```bash
# Bun runtime
bun run manage-api-keys create admin

# Node runtime
npm run manage-api-keys:node create admin
```

---

## 📝 License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This project is licensed under the [MIT License](LICENSE) - see the [LICENSE](LICENSE) file for details.
