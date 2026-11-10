/** AI & Routing Page — per-number responder, model, instruction, knowledge tools, metrics */
(() => {
  const MODE_HINTS = {
    off: "Static auto-reply (AUTO_REPLY_*) answers instead of the AI.",
    window: "AI answers inside the window; the static rules apply outside it.",
    always: 'AI answers 24/7 ("full handle"). A human reply still pauses it.',
  };

  const ROUTE_BADGES = {
    ai: "badge-success",
    static: "badge-info",
    human: "badge-warning",
    paused: "badge-warning",
    failed: "badge-danger",
    blocked: "badge-danger",
    muted: "badge-danger",
  };

  /** Generic, English examples: two live free endpoints plus one placeholder. */
  const EXAMPLE_ENDPOINTS = [
    {
      name: "web_search",
      description: "Search the web for general information.",
      method: "GET",
      url: "https://api.duckduckgo.com/",
      params: [
        { name: "q", type: "string", description: "Search query", required: true },
        { name: "format", type: "string", description: "Response format", default: "json" },
      ],
      timeoutMs: 6000,
      maxResponseChars: 1500,
    },
    {
      name: "check_weather",
      description: "Get the current weather for a location (no API key required).",
      method: "GET",
      url: "https://api.open-meteo.com/v1/forecast",
      params: [
        { name: "latitude", type: "number", description: "Latitude", required: true },
        { name: "longitude", type: "number", description: "Longitude", required: true },
        {
          name: "current_weather",
          type: "string",
          description: "Return current weather",
          default: "true",
        },
      ],
      timeoutMs: 6000,
      maxResponseChars: 1500,
    },
    {
      name: "search_users",
      description: "Look up a user by name, email or member id (replace the URL with yours).",
      method: "GET",
      url: "https://api.example.com/v1/users/search",
      params: [
        { name: "q", type: "string", description: "Name, email or member id", required: true },
        { name: "page", type: "integer", description: "Page number", default: 1 },
      ],
      timeoutMs: 6000,
      maxResponseChars: 1500,
    },
  ];

  /** Clipboard copy with a fallback for non-secure contexts. */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    }
  }

  const state = { sessions: [], sessionId: "", config: null, metrics: null };

  /**
   * Pre-flight validation so the operator gets a precise, actionable message
   * before the request hits the API (which would only report one field).
   */
  function validateEndpoints(endpoints) {
    if (!Array.isArray(endpoints)) return "Knowledge endpoints must be a JSON array.";
    for (let i = 0; i < endpoints.length; i += 1) {
      const endpoint = endpoints[i];
      const label = `Endpoint #${i + 1}`;
      if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) {
        return `${label} must be an object.`;
      }
      if (!endpoint.name) return `${label}: "name" is required.`;
      if (!endpoint.method) return `${endpoint.name}: "method" is required (GET or POST).`;
      if (!endpoint.url) return `${endpoint.name}: "url" is required.`;

      // A raw JSON Schema is forwarded untouched, so nothing to validate here.
      if (endpoint.parameters !== undefined) {
        const schema = endpoint.parameters;
        if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
          return `${endpoint.name}: "parameters" must be a JSON Schema object.`;
        }
        continue;
      }

      if (endpoint.params === undefined) continue;
      if (!Array.isArray(endpoint.params)) {
        if (typeof endpoint.params !== "object") {
          return `${endpoint.name}: "params" must be a list or a JSON Schema object.`;
        }
        continue; // params supplied as a raw schema
      }

      for (let j = 0; j < endpoint.params.length; j += 1) {
        const param = endpoint.params[j];
        const where = `${endpoint.name} param #${j + 1}`;
        if (!param || typeof param !== "object" || Array.isArray(param)) {
          return `${where}: must be an object.`;
        }
        if (param.properties) {
          return `${where}: this looks like a JSON Schema. Move it to "parameters": { "type": "object", "properties": { ... } } instead of listing it in "params".`;
        }
        if (!param.name) return `${where}: "name" is required (the API's parameter key, e.g. "q").`;
        if (!param.type) {
          return `${where}: "type" is required (string | number | integer | boolean).`;
        }
        if (!param.description) return `${where}: "description" is required.`;
      }
    }
    return null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function minutes(ms) {
    return Math.round((Number(ms) || 0) / 60000);
  }

  async function fetchSessions() {
    const result = await API.get("/sessions");
    return result.success ? result.data || [] : [];
  }

  async function fetchConfig(sessionId) {
    const result = await API.get(`/sessions/${sessionId}/ai-config`);
    return result.success ? result.data : null;
  }

  async function fetchMetrics(sessionId) {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    const result = await API.get(`/ai/metrics${query}`);
    return result.success ? result.data : null;
  }

  function metricValue(value) {
    const number = Number(value) || 0;
    return number.toLocaleString();
  }

  window.AiPage = {
    async render() {
      const container = document.getElementById("page-content");
      const sessions = await fetchSessions();
      state.sessions = sessions;

      if (sessions.length === 0) {
        UI.setHtml(
          container,
          `<div class="empty-state"><p class="text-muted">No sessions yet. Create a session first.</p></div>`,
        );
        return;
      }

      state.sessionId =
        window.App?.resolveSelectedSession?.(sessions) || state.sessionId || sessions[0].sessionId;
      UI.setHtml(
        container,
        `
        <div class="toolbar">
          <div class="form-group u-m0-minw-220">
            <select id="ai-session-select" class="input">
              ${sessions
                .map(
                  (session) =>
                    `<option value="${escapeHtml(session.sessionId)}" ${session.sessionId === state.sessionId ? "selected" : ""}>${escapeHtml(session.sessionId)}</option>`,
                )
                .join("")}
            </select>
          </div>
          <div class="toolbar-spacer"></div>
          <button class="btn btn-outline btn-sm" id="ai-refresh">↻ Refresh</button>
          <button class="btn btn-primary btn-sm" id="ai-save">Save Changes</button>
        </div>

        <div class="card">
          <div class="card-header"><h3>How Responders Fit Together</h3></div>
          <details>
            <summary class="text-xs" id="ai-chain-summary">Show effective chain</summary>
            <div class="u-mt-05" id="ai-chain">
              <p class="text-muted text-xs u-m-0">Loading…</p>
            </div>
          </details>
        </div>

        <div class="card">
          <div class="card-header"><h3>Responder &amp; Schedule</h3></div>
          <div class="form-row cols-2">
            <div class="form-group">
              <label for="ai-enabled">Enable AI for This Number</label>
              <select id="ai-enabled" class="input">
                <option value="false">No — static auto-reply</option>
                <option value="true">Yes — AI agent</option>
              </select>
            </div>
            <div class="form-group">
              <label for="ai-mode">When May the AI Answer?</label>
              <select id="ai-mode" class="input">
                <option value="off">Off (static only)</option>
                <option value="window">Inside the time window</option>
                <option value="always">Always (full handle)</option>
              </select>
              <small class="text-muted" id="ai-mode-hint"></small>
            </div>
          </div>
          <div class="form-row cols-6">
            <div class="form-group">
              <label for="ai-window-start">Start</label>
              <input id="ai-window-start" class="input" placeholder="16:00" />
            </div>
            <div class="form-group">
              <label for="ai-window-end">End</label>
              <input id="ai-window-end" class="input" placeholder="08:00" />
            </div>
            <div class="form-group">
              <label for="ai-timezone">Timezone</label>
              <input id="ai-timezone" class="input" placeholder="Asia/Jakarta" />
            </div>
            <div class="form-group">
              <label for="ai-batch-idle">Idle (Sec)</label>
              <input id="ai-batch-idle" class="input" type="number" min="3" max="120" />
            </div>
            <div class="form-group">
              <label for="ai-human-idle">Human Pause (Min)</label>
              <input id="ai-human-idle" class="input" type="number" min="1" max="1440" />
            </div>
            <div class="form-group">
              <label for="ai-handoff-pause">Handoff Pause (Min)</label>
              <input id="ai-handoff-pause" class="input" type="number" min="1" max="1440" />
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Model &amp; API Key</h3></div>
          <div class="form-row cols-2">
            <div class="form-group">
              <label for="ai-base-url">Base URL (OpenAI-Compatible)</label>
              <input id="ai-base-url" class="input" placeholder="https://openrouter.ai/api/v1" />
              <small class="text-muted">
                OpenRouter, OpenAI, Google Vertex (OpenAI-compatible), Fireworks,
                Hugging Face, Ollama…
              </small>
            </div>
            <div class="form-group">
              <label for="ai-model">Model</label>
              <input id="ai-model" class="input" placeholder="openai/gpt-4o-mini" />
            </div>
          </div>
          <div class="form-row cols-6">
            <div class="form-group">
              <label for="ai-temperature">Temperature</label>
              <input id="ai-temperature" class="input" type="number" step="0.1" min="0" max="2" />
            </div>
            <div class="form-group">
              <label for="ai-top-p">Top P</label>
              <input id="ai-top-p" class="input" type="number" step="0.05" min="0" max="1" />
            </div>
            <div class="form-group">
              <label for="ai-min-p">Min P</label>
              <input id="ai-min-p" class="input" type="number" step="0.01" min="0" max="1" />
            </div>
            <div class="form-group">
              <label for="ai-freq-penalty">Freq. Penalty</label>
              <input id="ai-freq-penalty" class="input" type="number" step="0.1" min="-2" max="2" />
            </div>
            <div class="form-group">
              <label for="ai-pres-penalty">Pres. Penalty</label>
              <input id="ai-pres-penalty" class="input" type="number" step="0.1" min="-2" max="2" />
            </div>
            <div class="form-group">
              <label for="ai-max-tokens">Max Tokens</label>
              <input id="ai-max-tokens" class="input" type="number" min="64" max="8192" />
            </div>
          </div>
          <div class="form-group">
            <label for="ai-api-key">API Key (Provider)</label>
            <div class="input-password-wrapper">
              <input id="ai-api-key" class="input" type="password" autocomplete="new-password" placeholder="sk-or-..." />
              ${window.passwordToggleHtml("ai-api-key")}
            </div>
            <small class="text-muted" id="ai-api-key-hint"></small>
          </div>

        </div>

        <div class="card">
          <div class="card-header"><h3>AI Capabilities</h3></div>
          <div class="u-mb-05">
            <label class="toggle-row">
              <input type="checkbox" id="ai-send-enabled" class="toggle-input" />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-copy">
                <strong>Allow AI to send WhatsApp messages</strong>
                <small>Adds <code>send_whatsapp_message</code> to every request. Plain text only; off by default.</small>
              </span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" id="ai-vision-enabled" class="toggle-input" />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-copy">
                <strong>Allow AI to understand images</strong>
                <small>Downloads inbound images in memory for a vision request. Off by default; videos and audio are not processed.</small>
              </span>
            </label>
          </div>
          <div id="ai-send-settings" class="hidden">
            <div class="form-row cols-2">
              <div class="form-group">
                <label for="ai-send-scope">Recipient Scope</label>
                <select id="ai-send-scope" class="input">
                  <option value="allowlist">Allowlist (plus current chat)</option>
                  <option value="any">Any recipient</option>
                </select>
              </div>
              <div class="form-group">
                <label for="ai-send-max">Max Sends per Hour</label>
                <input id="ai-send-max" class="input" type="number" min="1" max="200" step="1" value="10" />
              </div>
            </div>
            <div class="form-group" id="ai-send-allowlist-wrap">
              <label for="ai-send-allowlist">Allowed Recipients</label>
              <textarea id="ai-send-allowlist" class="input" rows="4"
                placeholder="628123456789&#10;628987654321"></textarea>
              <small class="text-muted">One phone number or JID per line. Only used with the allowlist scope.</small>
            </div>
            <small class="text-muted" id="ai-send-scope-hint"></small>
          </div>
          <div id="ai-vision-settings" class="hidden">
            <div class="form-group">
              <label for="ai-vision-model">Vision Model (Optional)</label>
              <input id="ai-vision-model" class="input" type="text" maxlength="128"
                placeholder="Leave empty to use the main model" />
              <small class="text-muted">
                Uses the same base URL and API key. Leave empty only if the main model supports image inputs.
              </small>
            </div>
          </div>
          <label class="toggle-row">
            <input type="checkbox" id="otp-filter-enabled" class="toggle-input" />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
            <span class="toggle-copy">
              <strong>Message Filter / Ignore OTP / Verification Messages</strong>
              <small>Skips AI and static auto-replies for matching messages. Messages are still stored, and webhooks still fire.</small>
            </span>
          </label>
          <div id="otp-filter-settings" class="hidden">
            <div class="form-group">
              <label for="otp-ignored-senders">Ignored Senders (Ignore List)</label>
              <textarea id="otp-ignored-senders" class="input" rows="4"
                placeholder="628123456789&#10;120363000000000000@g.us"></textarea>
              <small class="text-muted">One phone number or JID per line. No sender is ignored by default.</small>
            </div>
            <div class="form-group">
              <label for="otp-detection-mode">Detection Mode</label>
              <select id="otp-detection-mode" class="input">
                <option value="keywords">Keywords Only</option>
                <option value="smart" selected>Smart OTP / Verification</option>
              </select>
              <small class="text-muted">Keywords Only applies the phrase list directly. Smart OTP / Verification also scores nearby built-in code shapes.</small>
            </div>
            <div id="otp-smart-settings" class="hidden">
              <div class="form-group">
                <label for="otp-smart-sensitivity">Sensitivity</label>
                <select id="otp-smart-sensitivity" class="input">
                  <option value="conservative">Conservative</option>
                  <option value="balanced" selected>Balanced</option>
                  <option value="aggressive">Aggressive</option>
                </select>
                <small class="text-muted">Conservative needs stronger evidence. Aggressive catches more messages with a higher false-positive risk.</small>
              </div>
            </div>
            <div class="form-group">
              <label for="otp-keywords">Keywords</label>
              <textarea id="otp-keywords" class="input" rows="4"
                placeholder="verification code&#10;one-time password&#10;your login code&#10;do not share this code"></textarea>
              <small class="text-muted">Positive phrases for either mode. No phrase is built in; one phrase per line.</small>
            </div>
            <div class="form-group">
              <label for="otp-exclude-keywords">Exclude Keywords</label>
              <textarea id="otp-exclude-keywords" class="input" rows="3"
                placeholder="not received&#10;didn't receive&#10;resend"></textarea>
              <small class="text-muted">A match subtracts from Smart scoring and prevents a direct match in Keywords Only mode. One phrase per line.</small>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>System Instruction</h3></div>
          <div class="form-group">
            <textarea id="ai-instruction" class="input" rows="18"
              placeholder="You are a professional assistant. Answer clearly, concisely and politely in the customer's language. Ask a short clarifying question when the request is ambiguous. Never invent facts; use the available tools when data is required. Hand the conversation to a human when the customer asks for one or when you are unsure."></textarea>
            <small class="text-muted">Persona, tone, language and escalation rules.</small>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Knowledge Endpoints</h3></div>
          <div class="form-group">
            <div class="flex gap-1 u-between-center u-mb-05">
              <label for="ai-endpoints">Endpoints the Assistant May Call</label>
              <button type="button" class="btn btn-outline btn-sm" id="ai-example">View Example</button>
            </div>
            <textarea id="ai-endpoints" class="input" rows="12"
              placeholder='[ { "name": "...", "method": "GET", "url": "https://...", "params": [] } ]'></textarea>
            <small class="text-muted">
              <strong>What to call.</strong> Two shapes are accepted:
              <code>params</code> as a list of <code>{ name, type, description }</code>, or
              <code>parameters</code> as a raw JSON Schema (paste a third-party schema
              untouched). GET arguments become query params; POST arguments become the JSON body.
            </small>
          </div>

          <div class="card-header u-mt-15">
            <h3>Endpoint Credentials (Optional)</h3>
            <button type="button" class="btn btn-outline btn-sm" id="ai-credentials-example">View Example</button>
          </div>
          <div class="form-group">
            <textarea id="ai-credentials" class="input" rows="8"
              placeholder='{
  "web_search": { "headers": { "X-API-Key": "..." } },
  "check_weather": { "query": { "appid": "..." } },
  "search_users": { "headers": { "Authorization": "Bearer ..." } }
}'></textarea>
            <small class="text-muted" id="ai-credentials-hint"></small>
            <small class="text-muted">
              <strong>How to authenticate those endpoints.</strong> Keys are endpoint names;
              values are the <code>headers</code> / <code>query</code> to add. Leave empty when
              the endpoint needs no key. The provider key is the field in “Model &amp; API Key”.
            </small>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Routing Metrics</h3>
            <button class="btn btn-outline btn-sm" id="ai-reset-metrics">Reset</button>
          </div>
          <div id="ai-metrics"><div class="empty-state"><p class="text-muted">Loading…</p></div></div>
        </div>`,
      );

      document.getElementById("ai-session-select").addEventListener("change", (event) => {
        state.sessionId = event.target.value;
        window.App?.setSelectedSessionId?.(state.sessionId);
        this.loadConfig();
        this.loadMetrics();
      });
      document.getElementById("ai-refresh").addEventListener("click", () => {
        this.loadConfig();
        this.loadMetrics();
      });
      document.getElementById("ai-save").addEventListener("click", () => this.save());
      document
        .getElementById("ai-reset-metrics")
        .addEventListener("click", () => this.resetMetrics());
      document.getElementById("ai-example").addEventListener("click", () => this.showExample());
      document
        .getElementById("ai-credentials-example")
        .addEventListener("click", () => this.showCredentialsExample());
      document.getElementById("ai-mode").addEventListener("change", (event) => {
        const hint = document.getElementById("ai-mode-hint");
        if (hint) hint.textContent = MODE_HINTS[event.target.value] || "";
      });
      document.getElementById("ai-send-enabled")?.addEventListener("change", () => {
        this.syncSendMessageUi();
      });
      document.getElementById("ai-vision-enabled")?.addEventListener("change", () => {
        this.syncSendMessageUi();
      });
      document.getElementById("otp-filter-enabled")?.addEventListener("change", () => {
        this.syncOtpFilterUi();
      });
      document.getElementById("otp-detection-mode")?.addEventListener("change", () => {
        this.syncOtpFilterUi();
      });
      document.getElementById("ai-send-scope")?.addEventListener("change", () => {
        this.syncSendMessageUi();
      });

      window.initPasswordToggles?.(container);
      await Promise.all([this.loadConfig(), this.loadMetrics()]);
    },

    async loadConfig() {
      if (!state.sessionId) return;
      const data = await fetchConfig(state.sessionId);
      if (!data) {
        Toast.error("Failed to load AI configuration");
        return;
      }
      state.config = data;
      const routing = data.routing || {};
      const ai = data.ai || {};

      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? "";
      };

      set("ai-enabled", String(Boolean(ai.enabled)));
      set("ai-mode", ai.mode || "window");
      set("ai-window-start", routing.aiWindowStart || "");
      set("ai-window-end", routing.aiWindowEnd || "");
      set("ai-timezone", routing.timezone || "");
      set("ai-batch-idle", Math.round((Number(routing.batchIdleMs) || 0) / 1000));
      set("ai-human-idle", minutes(routing.humanIdleMs));
      set("ai-handoff-pause", minutes(routing.handoffPauseMs));
      set("ai-base-url", ai.baseUrl || data.defaults?.baseUrl || "");
      set("ai-model", ai.model || "");
      set("ai-temperature", ai.temperature ?? 0.6);
      set("ai-top-p", ai.topP ?? 0.95);
      set("ai-min-p", ai.minP ?? 0.05);
      set("ai-freq-penalty", ai.frequencyPenalty ?? 0);
      set("ai-pres-penalty", ai.presencePenalty ?? 0);
      set("ai-max-tokens", ai.maxTokens ?? 1024);
      set("ai-instruction", ai.systemInstruction || "");
      set("ai-endpoints", JSON.stringify(ai.ragEndpoints || [], null, 2));

      const sendMessage = ai.sendMessage || {};
      const sendEnabled = document.getElementById("ai-send-enabled");
      if (sendEnabled) sendEnabled.checked = Boolean(sendMessage.enabled);
      set("ai-send-scope", sendMessage.scope || "allowlist");
      set("ai-send-allowlist", (sendMessage.allowlist || []).join("\n"));
      set("ai-send-max", sendMessage.maxPerHour ?? 10);
      const vision = ai.vision || {};
      const visionEnabled = document.getElementById("ai-vision-enabled");
      if (visionEnabled) visionEnabled.checked = Boolean(vision.enabled);
      set("ai-vision-model", vision.model || "");
      const otpFilter = ai.otpFilter || {};
      const otpEnabled = document.getElementById("otp-filter-enabled");
      if (otpEnabled) otpEnabled.checked = Boolean(otpFilter.enabled);
      const detectionMode =
        otpFilter.detectionMode ||
        (otpFilter.smart ? "smart" : otpFilter.keywordFilter ? "keywords" : "smart");
      set("otp-detection-mode", detectionMode);
      set("otp-smart-sensitivity", otpFilter.sensitivity || "balanced");
      set("otp-ignored-senders", (otpFilter.ignoredSenders || []).join("\n"));
      set("otp-keywords", (otpFilter.keywords || []).join("\n"));
      set("otp-exclude-keywords", (otpFilter.excludeKeywords || []).join("\n"));
      this.syncSendMessageUi();
      this.syncOtpFilterUi();

      const credentials = document.getElementById("ai-credentials");
      if (credentials) credentials.value = "";
      const apiKeyField = document.getElementById("ai-api-key");
      if (apiKeyField) apiKeyField.value = "";

      const apiKeyHint = document.getElementById("ai-api-key-hint");
      if (apiKeyHint) {
        apiKeyHint.textContent = ai.apiKeySet
          ? `Stored${ai.apiKeyHint ? ` (${ai.apiKeyHint})` : ""} — ${ai.credentialsEncrypted ? "encrypted" : "plaintext"}. Leave empty to keep it.`
          : "No API key stored yet.";
      }

      const hint = document.getElementById("ai-credentials-hint");
      if (hint) {
        hint.textContent = ai.credentialsSet
          ? "Tool credentials stored. Leave empty to keep them."
          : "Optional: headers/query per knowledge endpoint (only when that API needs a key).";
      }

      const modeHint = document.getElementById("ai-mode-hint");
      if (modeHint) modeHint.textContent = MODE_HINTS[ai.mode || "window"] || "";
      this.renderChain();
    },

    /** Keep the send-tool fields consistent with the toggle/scope. */
    syncSendMessageUi() {
      const enabled = Boolean(document.getElementById("ai-send-enabled")?.checked);
      const scope = document.getElementById("ai-send-scope")?.value || "allowlist";
      const visionEnabled = Boolean(document.getElementById("ai-vision-enabled")?.checked);
      document.getElementById("ai-send-settings")?.classList.toggle("hidden", !enabled);
      document.getElementById("ai-vision-settings")?.classList.toggle("hidden", !visionEnabled);
      document
        .getElementById("ai-send-allowlist-wrap")
        ?.classList.toggle("hidden", scope !== "allowlist");
      const hint = document.getElementById("ai-send-scope-hint");
      if (hint) {
        hint.textContent =
          scope === "allowlist"
            ? "The current conversation is always allowed. Add recipients above to let the model contact other chats. Group sends still obey ALLOW_GROUP_SEND; rate limit is enforced server-side."
            : "The model may contact any number or JID the customer names; the current conversation is the default when no receiver is given. Group sends still obey ALLOW_GROUP_SEND; rate limit is enforced server-side.";
      }
    },

    /** Keep the OTP/filter fields consistent with their toggles. */
    syncOtpFilterUi() {
      const enabled = Boolean(document.getElementById("otp-filter-enabled")?.checked);
      const mode = document.getElementById("otp-detection-mode")?.value || "smart";
      document.getElementById("otp-filter-settings")?.classList.toggle("hidden", !enabled);
      document
        .getElementById("otp-smart-settings")
        ?.classList.toggle("hidden", !enabled || mode !== "smart");
    },

    /** Show the responder chain that will actually run for this number. */
    renderChain() {
      const target = document.getElementById("ai-chain");
      if (!target) return;
      const ai = state.config?.ai ?? {};
      const routing = state.config?.routing ?? {};
      const session = state.sessions.find((item) => item.sessionId === state.sessionId);
      const autoReply = session?.autoReply ?? {};
      const mode = ai.mode ?? "window";

      let aiText;
      if (!ai.enabled) {
        aiText = "off";
      } else if (mode === "always") {
        aiText = "answers 24/7";
      } else if (mode === "window") {
        aiText = `answers ${routing.aiWindowStart}–${routing.aiWindowEnd} (${routing.timezone})`;
      } else {
        aiText = "off";
      }

      const staticText = autoReply.enabled
        ? `role ${autoReply.role || "both"} · trigger ${autoReply.type}`
        : "not enabled";

      // The collapsed summary carries the live chain, so no static paragraph is
      // needed above it (that was the redundant part of this card).
      const summary = document.getElementById("ai-chain-summary");
      if (summary) {
        const aiShort = !ai.enabled
          ? "AI off"
          : mode === "always"
            ? "AI 24/7"
            : mode === "window"
              ? `AI ${routing.aiWindowStart}–${routing.aiWindowEnd}`
              : "AI off";
        const staticShort = autoReply.enabled ? `static ${autoReply.role || "both"}` : "static off";
        summary.textContent = `${aiShort} → ${staticShort} → webhook events only`;
      }

      UI.setHtml(
        target,
        `
        <div class="table-wrapper"><table>
          <thead><tr><th>#</th><th>Layer</th><th>Behaviour</th></tr></thead>
          <tbody>
            <tr><td>1</td><td><span class="badge badge-success">AI</span></td><td class="text-xs">${escapeHtml(aiText)}</td></tr>
            <tr><td>2</td><td><span class="badge badge-info">Static</span></td><td class="text-xs">${escapeHtml(staticText)}</td></tr>
            <tr><td>3</td><td><span class="badge">Webhook</span></td><td class="text-xs">event delivery only — never answers</td></tr>
          </tbody>
        </table></div>`,
      );
    },

    async save() {
      if (!state.sessionId) return;
      const value = (id) => document.getElementById(id)?.value?.trim() ?? "";
      const num = (id, fallback) => {
        const raw = value(id);
        const parsed = Number(raw);
        return raw !== "" && Number.isFinite(parsed) ? parsed : fallback;
      };

      let endpoints;
      try {
        endpoints = JSON.parse(value("ai-endpoints") || "[]");
      } catch {
        Toast.error("Knowledge endpoints must be valid JSON");
        return;
      }

      const endpointError = validateEndpoints(endpoints);
      if (endpointError) {
        Toast.error(endpointError);
        return;
      }

      const credentialsJson = value("ai-credentials");
      if (credentialsJson) {
        try {
          const parsedCredentials = JSON.parse(credentialsJson);
          if (
            !parsedCredentials ||
            typeof parsedCredentials !== "object" ||
            Array.isArray(parsedCredentials)
          ) {
            Toast.error("Tool credentials must be a JSON object");
            return;
          }
        } catch {
          Toast.error("Tool credentials must be valid JSON");
          return;
        }
      }

      const apiKey = value("ai-api-key");

      const payload = {
        routing: {
          aiWindowStart: value("ai-window-start"),
          aiWindowEnd: value("ai-window-end"),
          timezone: value("ai-timezone"),
          batchIdleMs: Math.max(3, Number(value("ai-batch-idle")) || 20) * 1000,
          humanIdleMs: Math.max(1, Number(value("ai-human-idle")) || 15) * 60000,
          handoffPauseMs: Math.max(1, Number(value("ai-handoff-pause")) || 30) * 60000,
        },
        ai: {
          enabled: value("ai-enabled") === "true",
          mode: value("ai-mode"),
          driver: "openai",
          model: value("ai-model"),
          baseUrl: value("ai-base-url"),
          temperature: num("ai-temperature", 0.6),
          topP: num("ai-top-p", 0.95),
          minP: num("ai-min-p", 0.05),
          frequencyPenalty: num("ai-freq-penalty", 0),
          presencePenalty: num("ai-pres-penalty", 0),
          maxTokens: num("ai-max-tokens", 1024),
          systemInstruction: value("ai-instruction"),
          ragEndpoints: endpoints,
          sendMessage: {
            enabled: Boolean(document.getElementById("ai-send-enabled")?.checked),
            scope: value("ai-send-scope") || "allowlist",
            allowlist: value("ai-send-allowlist")
              .split(/[\n,]+/)
              .map((entry) => entry.trim())
              .filter(Boolean),
            maxPerHour: Math.min(Math.max(Number(value("ai-send-max")) || 10, 1), 200),
          },
          vision: {
            enabled: Boolean(document.getElementById("ai-vision-enabled")?.checked),
            model: value("ai-vision-model"),
          },
          otpFilter: {
            enabled: Boolean(document.getElementById("otp-filter-enabled")?.checked),
            ignoredSenders: value("otp-ignored-senders")
              .split(/\r?\n/)
              .map((entry) => entry.trim())
              .filter(Boolean),
            detectionMode: value("otp-detection-mode") || "smart",
            sensitivity: value("otp-smart-sensitivity") || "balanced",
            keywords: value("otp-keywords")
              .split(/\r?\n/)
              .map((entry) => entry.trim())
              .filter(Boolean),
            excludeKeywords: value("otp-exclude-keywords")
              .split(/\r?\n/)
              .map((entry) => entry.trim())
              .filter(Boolean),
          },
          ...(apiKey ? { apiKey } : {}),
          ...(credentialsJson ? { credentialsJson } : {}),
        },
      };

      const result = await API.patch(`/sessions/${state.sessionId}/ai-config`, payload);
      if (!result.success) {
        Toast.error(result.message || "Failed to save AI configuration");
        return;
      }
      Toast.success("AI configuration saved");
      await this.loadConfig();
    },

    async loadMetrics() {
      const data = await fetchMetrics(state.sessionId);
      state.metrics = data;
      const target = document.getElementById("ai-metrics");
      if (!target) return;
      UI.setHtml(target, this.renderMetrics(data));

      // Bar widths go through CSSOM (allowed by CSP) instead of an inline style.
      target.querySelectorAll("[data-width]").forEach((bar) => {
        bar.style.width = `${bar.getAttribute("data-width") || 0}%`;
      });
    },

    renderMetrics(metrics) {
      if (!metrics) {
        return '<div class="empty-state"><p class="text-muted">No metrics yet</p></div>';
      }
      const counters = metrics.counters || {};
      const latency = metrics.latency || {};
      const hourly = metrics.hourly || [];
      const recent = metrics.recent || [];

      const maxHour = Math.max(1, ...hourly.map((h) => (h.ai || 0) + (h.human || 0)));

      return `
        <div class="stats-grid cols-4">
          <div class="stat-card"><div class="stat-info"><h4>AI Replies</h4><div class="stat-value">${metricValue(counters.aiReplies)}</div></div></div>
          <div class="stat-card"><div class="stat-info"><h4>Human Handled</h4><div class="stat-value">${metricValue(counters.humanSkips)}</div></div></div>
          <div class="stat-card"><div class="stat-info"><h4>Static Replies</h4><div class="stat-value">${metricValue(counters.staticReplies)}</div></div></div>
          <div class="stat-card"><div class="stat-info"><h4>Failures</h4><div class="stat-value">${metricValue(counters.failures)}</div></div></div>
          <div class="stat-card"><div class="stat-info"><h4>Tool Calls</h4><div class="stat-value">${metricValue(counters.toolCalls)}</div></div></div>
          <div class="stat-card"><div class="stat-info"><h4>Avg Latency</h4><div class="stat-value">${metricValue(latency.avgMs)} ms</div></div></div>
          <div class="stat-card"><div class="stat-info"><h4>Tokens In / Out</h4><div class="stat-value">${metricValue(counters.tokensIn)} / ${metricValue(counters.tokensOut)}</div></div></div>
        </div>
        <p class="text-muted text-xs u-mt-8px">
          In-process counters since ${new Date(metrics.since).toLocaleString()} — they reset on restart.
        </p>

        <div class="card-header"><h3>Per Hour</h3></div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Hour</th><th>AI</th><th>Human</th><th>Share</th></tr></thead>
          <tbody>${
            hourly
              .filter((bucket) => bucket.ai > 0 || bucket.human > 0)
              .map((bucket) => {
                const total = (bucket.ai || 0) + (bucket.human || 0);
                const width = Math.round((total / maxHour) * 100);
                return `<tr>
                <td class="font-mono text-xs">${String(bucket.hour).padStart(2, "0")}:00</td>
                <td>${metricValue(bucket.ai)}</td>
                <td>${metricValue(bucket.human)}</td>
                <td><span class="badge badge-info" data-width="${width}">${total}</span></td>
              </tr>`;
              })
              .join("") || '<tr><td colspan="4" class="text-muted text-xs">No traffic yet</td></tr>'
          }
          </tbody></table></div>

        <div class="card-header u-mt-15"><h3>Recent Decisions</h3></div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Time</th><th>Route</th><th>Conversation</th><th>Reason</th><th>Latency</th></tr></thead>
          <tbody>${
            recent
              .slice(0, 25)
              .map(
                (entry) => `<tr>
                <td class="text-xs">${new Date(entry.at).toLocaleTimeString()}</td>
                <td><span class="badge ${ROUTE_BADGES[entry.route] || "badge-info"}">${escapeHtml(entry.route)}</span></td>
                <td class="font-mono text-xs">${escapeHtml(entry.conversationId)}</td>
                <td class="text-xs text-muted">${escapeHtml(entry.reason || "-")}</td>
                <td class="text-xs text-muted">${entry.latencyMs ? `${entry.latencyMs} ms` : "-"}</td>
              </tr>`,
              )
              .join("") ||
            '<tr><td colspan="5" class="text-muted text-xs">No decisions yet</td></tr>'
          }
          </tbody></table></div>`;
    },

    showExample() {
      const json = JSON.stringify(EXAMPLE_ENDPOINTS, null, 2);
      Modal.show(
        "Knowledge endpoint example",
        `<p class="text-muted text-xs">
           Structured example: two placeholders to replace and one live free endpoint
           (DuckDuckGo). Copy the JSON, then paste it into <strong>Knowledge endpoints</strong>.
         </p>
         <pre class="example-json">${escapeHtml(json)}</pre>
         <div class="flex gap-1 u-end-mt-1">
           <button type="button" class="btn btn-outline btn-sm" id="ai-example-use">Use Example</button>
           <button type="button" class="btn btn-primary btn-sm" id="ai-example-copy">Copy JSON</button>
         </div>`,
      );

      document.getElementById("ai-example-use").addEventListener("click", () => {
        const field = document.getElementById("ai-endpoints");
        if (field) field.value = json;
        Modal.hide();
        Toast.success("Example loaded into the form");
      });

      document.getElementById("ai-example-copy").addEventListener("click", async () => {
        const copied = await copyText(json);
        if (copied) Toast.success("JSON copied to clipboard");
        else Toast.error("Copy failed — select the text manually");
      });
    },

    showCredentialsExample() {
      const json = JSON.stringify(
        {
          web_search: { headers: { "X-API-Key": "<your-search-key>" } },
          check_weather: { query: { appid: "<your-weather-appid>" } },
          search_users: { headers: { Authorization: "Bearer <your-token>" } },
        },
        null,
        2,
      );

      Modal.show(
        "Endpoint credentials example",
        `<p class="text-muted text-xs">
           Keys are endpoint names from <strong>Knowledge endpoints</strong>. Values add
           <code>headers</code>, <code>query</code> or <code>body</code> for that endpoint only.
           Omit a section when the endpoint needs no key.
         </p>
         <pre class="example-json">${escapeHtml(json)}</pre>
         <div class="flex gap-1 u-end-mt-1">
           <button type="button" class="btn btn-outline btn-sm" id="ai-credentials-use">Use Example</button>
           <button type="button" class="btn btn-primary btn-sm" id="ai-credentials-copy">Copy JSON</button>
         </div>`,
      );

      document.getElementById("ai-credentials-use").addEventListener("click", () => {
        const field = document.getElementById("ai-credentials");
        if (field) field.value = json;
        Modal.hide();
        Toast.success("Example loaded into the form");
      });

      document.getElementById("ai-credentials-copy").addEventListener("click", async () => {
        const copied = await copyText(json);
        if (copied) Toast.success("JSON copied to clipboard");
        else Toast.error("Copy failed — select the text manually");
      });
    },

    async resetMetrics() {
      const result = await API.post("/ai/metrics/reset", {});
      if (!result.success) {
        Toast.error(result.message || "Failed to reset metrics");
        return;
      }
      Toast.success("Metrics reset");
      await this.loadMetrics();
    },
  };
})();
