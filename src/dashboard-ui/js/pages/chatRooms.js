/** Chat Rooms Page — WhatsApp Web style 1-on-1 conversations */
(() => {
  let selectedSessionId = "";
  let selectedJid = "";
  let selectedMode = "personal";
  let chatCache = [];
  let groupInventoryCache = { sessionId: "", at: 0, groups: [] };
  const GROUP_INVENTORY_TTL_MS = 5 * 60 * 1000;
  let refreshTimer = null;
  let eventSource = null;
  let activeSelfJid = "";
  let activeSelfLid = "";
  let isWindowFocused = true;
  let isSending = false;
  const draftByJid = new Map();
  const typingTimers = new Map();
  let outgoingTypingPauseTimer = null;
  let outgoingTypingStartTimer = null;
  let outgoingTypingKeepAliveTimer = null;
  let outgoingTypingActive = false;
  let outgoingTypingComposingSent = false;
  let outgoingTypingSessionId = "";
  let outgoingTypingJid = "";
  const outgoingPresenceState = new Map();
  const lastReadSyncAt = new Map();
  const sentMessageStatus = new Map(); // Track sent message status: "text:timestamp" → "sent"|"read"|"delivered"
  let latestSessions = [];
  let pendingBubbleSeq = 0;

  const POLL_CONFIG_KEY = "wa-dashboard-chatrooms-polling";
  const DEFAULT_POLL_ACTIVE_MS = 5000;
  const DEFAULT_POLL_IDLE_MS = 20000;
  const READ_SYNC_COOLDOWN_MS = 12000;
  const TYPING_COMPOSING_START_MIN_MS = 280;
  const TYPING_COMPOSING_START_MAX_MS = 900;
  const TYPING_PAUSE_AFTER_IDLE_MIN_MS = 2200;
  const TYPING_PAUSE_AFTER_IDLE_MAX_MS = 3600;
  const TYPING_KEEPALIVE_MIN_MS = 5200;
  const TYPING_KEEPALIVE_MAX_MS = 9000;
  const OUTGOING_PRESENCE_THROTTLE_MIN_MS = 900;
  const OUTGOING_PRESENCE_THROTTLE_MAX_MS = 1800;

  function randomBetween(min, max) {
    const floorMin = Math.ceil(Number(min) || 0);
    const floorMax = Math.floor(Number(max) || floorMin);
    if (floorMax <= floorMin) return floorMin;
    return Math.floor(Math.random() * (floorMax - floorMin + 1)) + floorMin;
  }

  function loadPollingConfig() {
    try {
      const raw = localStorage.getItem(POLL_CONFIG_KEY);
      if (!raw) {
        return {
          activeMs: DEFAULT_POLL_ACTIVE_MS,
          idleMs: DEFAULT_POLL_IDLE_MS,
        };
      }
      const parsed = JSON.parse(raw);
      return {
        activeMs: Math.min(
          Math.max(Number(parsed.activeMs) || DEFAULT_POLL_ACTIVE_MS, 1500),
          20000,
        ),
        idleMs: Math.min(Math.max(Number(parsed.idleMs) || DEFAULT_POLL_IDLE_MS, 5000), 120000),
      };
    } catch {
      return {
        activeMs: DEFAULT_POLL_ACTIVE_MS,
        idleMs: DEFAULT_POLL_IDLE_MS,
      };
    }
  }

  function savePollingConfig(activeMs, idleMs) {
    const payload = {
      activeMs: Math.min(Math.max(Number(activeMs) || DEFAULT_POLL_ACTIVE_MS, 1500), 20000),
      idleMs: Math.min(Math.max(Number(idleMs) || DEFAULT_POLL_IDLE_MS, 5000), 120000),
    };
    localStorage.setItem(POLL_CONFIG_KEY, JSON.stringify(payload));
    return payload;
  }

  function isOneToOneJid(jid) {
    // Newer WhatsApp accounts address DMs with @lid as well as @s.whatsapp.net.
    return typeof jid === "string" && (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"));
  }

  function isGroupJid(jid) {
    return typeof jid === "string" && jid.endsWith("@g.us");
  }

  function normalizeJid(jid) {
    return String(jid || "").replace(/:\d+(?=@)/, "");
  }

  function jidPhoneOnly(jid) {
    return normalizeJid(jid)
      .replace(/@s\.whatsapp\.net$/, "")
      .replace(/@g\.us$/, "");
  }

  function currentDashboardUser() {
    try {
      return JSON.parse(localStorage.getItem("wa-dashboard-user") || "{}");
    } catch {
      return {};
    }
  }

  function can(capability) {
    return Boolean(window.App?.hasCapability?.(currentDashboardUser(), capability));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeContactName(chat) {
    // contactName is resolved from both PN/LID records and is the saved name,
    // so it must win over a chat.name that may only be the push name.
    const savedName = chat.contactName || chat.name || chat.subject;
    if (savedName) return String(savedName);
    const pushName = chat.notify || chat.pushName;
    if (pushName) return String(pushName);

    const id = String(chat.id || "");
    if (id.endsWith("@s.whatsapp.net")) return id.slice(0, -"@s.whatsapp.net".length);
    if (id.endsWith("@lid")) return id;
    if (id.endsWith("@g.us")) return id.slice(0, -"@g.us".length);
    return id || "Unknown";
  }

  function displayNameForJid(jid) {
    const target = normalizeJid(jid);
    const chat = chatCache.find((entry) => normalizeJid(entry.id) === target);
    if (chat) return normalizeContactName(chat);
    if (String(jid).endsWith("@lid")) return String(jid);
    return jidPhoneOnly(jid) || String(jid);
  }

  function chatIdentity(jid) {
    const target = normalizeJid(jid);
    const chat = chatCache.find((entry) => normalizeJid(entry.id) === target);
    const foundName = String(
      chat?.contactName || chat?.name || chat?.notify || chat?.pushName || "",
    ).trim();
    const phone = String(
      chat?.phoneNumber ||
        (String(jid).endsWith("@s.whatsapp.net")
          ? String(jid).slice(0, -"@s.whatsapp.net".length)
          : ""),
    ).trim();
    const lid = String(chat?.lid || (String(jid).endsWith("@lid") ? jid : "")).trim();

    let title;
    if (foundName && phone) title = `${foundName} (${phone})`;
    else if (foundName && foundName !== lid) title = foundName;
    else if (phone) title = phone;
    else if (lid) title = lid;
    else title = displayNameForJid(jid);

    // Only show the LID label when a real contact name is the title and the
    // title itself is not already the LID.
    const showLid = Boolean(lid) && Boolean(foundName) && title !== lid;
    return { title, lid: showLid ? lid : "" };
  }

  function renderTextWithMarkdown(raw) {
    // WhatsApp-first parser with safe Markdown enrichment; see lib/messageFormat.js.
    return window.MessageFormat?.render(raw) ?? escapeHtml(raw);
  }

  function extractMessagePayload(msg) {
    const m = msg?.message || {};

    if (m.conversation) return { text: m.conversation, unsupported: false };
    if (m.extendedTextMessage?.text)
      return { text: m.extendedTextMessage.text, unsupported: false };
    if (m.imageMessage?.caption) return { text: m.imageMessage.caption, unsupported: false };
    if (m.videoMessage?.caption) return { text: m.videoMessage.caption, unsupported: false };
    if (m.documentMessage)
      return {
        text: `[Document] ${m.documentMessage.fileName || "file"}`,
        unsupported: false,
      };
    if (m.audioMessage) return { text: "[Audio]", unsupported: false };
    if (m.stickerMessage) return { text: "[Sticker]", unsupported: false };
    if (m.locationMessage) return { text: "[Location]", unsupported: false };
    if (m.contactMessage || m.contactsArrayMessage)
      return { text: "[Contact]", unsupported: false };
    if (m.pollCreationMessage) return { text: "[Poll]", unsupported: false };
    if (m.reactionMessage?.text)
      return {
        text: `[Reaction] ${m.reactionMessage.text}`,
        unsupported: false,
      };

    if (m.buttonsMessage || m.listMessage || m.templateMessage)
      return { text: "[Interactive Message]", unsupported: false };

    // Ignore protocol/service payloads in dashboard UI.
    return { text: "", unsupported: true };
  }

  function extractActionButtons(msg) {
    const m = msg?.message || {};
    const output = [];

    if (Array.isArray(m?.buttonsMessage?.buttons)) {
      m.buttonsMessage.buttons.forEach((btn) => {
        const label = btn?.buttonText?.displayText;
        if (label) output.push(label);
      });
    }

    const hydratedButtons = m?.templateMessage?.hydratedTemplate?.hydratedButtons;
    if (Array.isArray(hydratedButtons)) {
      hydratedButtons.forEach((btn) => {
        const label =
          btn?.quickReplyButton?.displayText ||
          btn?.urlButton?.displayText ||
          btn?.callButton?.displayText;
        if (label) output.push(label);
      });
    }

    if (m?.listMessage?.buttonText?.displayText) {
      output.push(m.listMessage.buttonText.displayText);
    }

    if (m?.buttonsResponseMessage?.selectedDisplayText) {
      output.push(`Selected: ${m.buttonsResponseMessage.selectedDisplayText}`);
    }

    return output;
  }

  function formatMessageTime(ts) {
    if (!ts) return "";
    const numeric = typeof ts === "object" && ts.low ? ts.low : Number(ts);
    if (!numeric || Number.isNaN(numeric)) return "";
    const date = new Date(numeric * 1000);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function normalizeTimestampSeconds(ts) {
    if (!ts) return null;
    if (typeof ts === "number" && !Number.isNaN(ts)) return ts;
    if (typeof ts === "string" && ts.trim() && !Number.isNaN(Number(ts))) {
      return Number(ts);
    }
    if (typeof ts === "object") {
      if (typeof ts.low === "number") return ts.low;
      if (typeof ts.toNumber === "function") {
        const n = ts.toNumber();
        if (!Number.isNaN(n)) return n;
      }
    }
    return null;
  }

  let chatMenuElement = null;
  let chatMenuCleanup = null;

  function closeChatMenu() {
    chatMenuElement?.remove();
    chatMenuElement = null;
    if (chatMenuCleanup) {
      chatMenuCleanup();
      chatMenuCleanup = null;
    }
  }

  function openChatMenu(anchor, jid) {
    closeChatMenu();

    const isGroup = isGroupJid(jid) || selectedMode === "groups";
    const canClear = can("manageSessions");
    const canManageGroup = can("manageGroups");
    const items = [
      {
        action: "reload",
        label: "Reload",
        icon: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>',
      },
      ...(isGroup
        ? [
            {
              action: "members",
              label: "Members",
              icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
            },
          ]
        : []),
      {
        action: "read",
        label: "Mark Read",
        icon: '<polyline points="20 6 9 17 4 12"/>',
      },
      ...(canClear
        ? [
            {
              action: "clear",
              label: "Clear Chat",
              icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>',
            },
          ]
        : []),
      ...(isGroup && canManageGroup
        ? [
            {
              action: "exit",
              label: "Exit & Delete",
              danger: true,
              icon: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
            },
          ]
        : []),
      ...(!isGroup && canClear
        ? [
            {
              action: "delete",
              label: "Delete Chat",
              danger: true,
              icon: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
            },
          ]
        : []),
    ];

    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "chat-action-menu";
    UI.setHtml(
      menu,
      items
        .map(
          (item) =>
            `<button type="button" class="chat-action-item ${item.danger ? "chat-action-danger" : ""}" data-action="${item.action}"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg><span>${item.label}</span></button>`,
        )
        .join(""),
    );
    menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - (items.length * 42 + 20))}px`;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 190)}px`;
    document.body.appendChild(menu);
    chatMenuElement = menu;

    menu.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        const action = button.dataset.action;
        closeChatMenu();
        await runChatAction(action, jid);
      });
    });

    const onOutside = (event) => {
      if (!menu.contains(event.target)) closeChatMenu();
    };
    const onKey = (event) => {
      if (event.key === "Escape") closeChatMenu();
    };
    setTimeout(() => document.addEventListener("click", onOutside), 0);
    document.addEventListener("keydown", onKey);
    chatMenuCleanup = () => {
      document.removeEventListener("click", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }

  async function runChatAction(action, jid) {
    const page = window.ChatRoomsPage;
    if (!page || !selectedSessionId) return;

    if (action === "reload") {
      selectedJid = jid;
      await page.loadConversation(jid, false);
      await page.loadChatList(false);
      return;
    }

    if (action === "members") {
      await page.showGroupMembers(jid);
      return;
    }

    if (action === "read") {
      await page.markRoomAsRead(jid, true, true);
      return;
    }

    if (action === "exit") {
      const confirmed = await window.Modal.confirm(
        "Exit & Delete Group",
        `Leave this group and delete its chat on WhatsApp and in the dashboard?<br><br><strong>${escapeHtml(jidPhoneOnly(jid))}</strong><br><br>You will stop receiving messages from this group. This cannot be undone.`,
        { confirmText: "Exit & delete", variant: "danger" },
      );
      if (!confirmed) return;

      const result = await API.post(
        `/groups/${encodeURIComponent(selectedSessionId)}/leave-and-delete/${encodeURIComponent(jid)}`,
        {},
      );
      if (!result.success) {
        Toast.error(result.message || "Failed to exit the group");
        return;
      }

      groupInventoryCache.at = 0;
      Toast.success("Left and deleted the group");
      if (jid === selectedJid) {
        selectedJid = "";
        UI.setHtml(
          document.getElementById("chatroom-messages"),
          '<div class="chatrooms-empty">Group left and deleted.</div>',
        );
      }
      await page.loadChatList(true, true);
      return;
    }

    const isClear = action === "clear";
    const confirmed = await window.Modal.confirm(
      isClear ? "Clear Chat" : "Delete Chat",
      `${
        isClear
          ? "Clear this chat's history on WhatsApp and in the dashboard?"
          : "Delete this chat on WhatsApp and in the dashboard?"
      }<br><br><strong>${escapeHtml(jidPhoneOnly(jid))}</strong><br><br>${
        isClear
          ? "This cannot be undone."
          : "The chat and its history will be removed. This cannot be undone."
      }`,
      { confirmText: isClear ? "Clear chat" : "Delete chat", variant: "danger" },
    );
    if (!confirmed) return;

    const result = await API.post(
      `/sessions/${encodeURIComponent(selectedSessionId)}/chats/${isClear ? "clear" : "delete"}`,
      { jid },
    );
    if (!result.success) {
      Toast.error(result.message || "Action failed");
      return;
    }

    if (isClear) {
      Toast.success(`Cleared ${result.data?.clearedMessages ?? 0} messages in this chat`);
      if (jid === selectedJid) await page.loadConversation(jid, false);
      await page.loadChatList(false);
      return;
    }

    Toast.success("Chat deleted on WhatsApp and in the dashboard");
    if (jid === selectedJid) {
      selectedJid = "";
      UI.setHtml(
        document.getElementById("chatroom-messages"),
        '<div class="chatrooms-empty">Chat deleted.</div>',
      );
    }
    await page.loadChatList(false);
  }

  window.ChatRoomsPage = {
    setReadSyncStatus(text = "", kind = "") {
      const el = document.getElementById("chatroom-read-status");
      if (!el) return;

      if (!text) {
        el.textContent = "";
        el.className = "chatroom-read-status";
        el.classList.add("is-hidden");
        return;
      }

      el.textContent = text;
      el.className = `chatroom-read-status ${kind}`;
      el.classList.remove("is-hidden");
    },

    async sendChatPresence(type, jid, sessionId = selectedSessionId, force = false) {
      if (!sessionId || !jid) return;

      const targetKey = `${sessionId}:${normalizeJid(jid)}`;
      const now = Date.now();
      const last = outgoingPresenceState.get(targetKey);
      if (!force && last && last.type === type && now - last.at < Number(last.cooldownMs || 0)) {
        return;
      }

      try {
        const nextCooldownMs = randomBetween(
          OUTGOING_PRESENCE_THROTTLE_MIN_MS,
          OUTGOING_PRESENCE_THROTTLE_MAX_MS,
        );
        await API.post(`/sessions/${encodeURIComponent(sessionId)}/chats/presence`, { type, jid });
        outgoingPresenceState.set(targetKey, {
          type,
          at: now,
          cooldownMs: nextCooldownMs,
        });
      } catch {
        // Presence send is best-effort for UX only.
      }
    },

    armOutgoingTypingKeepAlive() {
      if (outgoingTypingKeepAliveTimer) {
        clearTimeout(outgoingTypingKeepAliveTimer);
        outgoingTypingKeepAliveTimer = null;
      }

      if (!outgoingTypingActive || !outgoingTypingComposingSent) return;

      const keepAliveMs = randomBetween(TYPING_KEEPALIVE_MIN_MS, TYPING_KEEPALIVE_MAX_MS);

      outgoingTypingKeepAliveTimer = setTimeout(() => {
        if (!outgoingTypingActive || !outgoingTypingSessionId || !outgoingTypingJid) {
          return;
        }

        void this.sendChatPresence("composing", outgoingTypingJid, outgoingTypingSessionId);
        this.armOutgoingTypingKeepAlive();
      }, keepAliveMs);
    },

    scheduleOutgoingTypingPresence(jid) {
      if (!selectedSessionId || !jid || isSending) return;

      const sameTarget =
        outgoingTypingActive &&
        outgoingTypingSessionId === selectedSessionId &&
        normalizeJid(outgoingTypingJid) === normalizeJid(jid);

      if (!sameTarget && outgoingTypingActive) {
        void this.pauseOutgoingTypingPresence();
      }

      if (!sameTarget) {
        outgoingTypingSessionId = selectedSessionId;
        outgoingTypingJid = jid;
        outgoingTypingActive = true;
        outgoingTypingComposingSent = false;
        if (outgoingTypingStartTimer) {
          clearTimeout(outgoingTypingStartTimer);
          outgoingTypingStartTimer = null;
        }
        if (outgoingTypingKeepAliveTimer) {
          clearTimeout(outgoingTypingKeepAliveTimer);
          outgoingTypingKeepAliveTimer = null;
        }

        const startDelayMs = randomBetween(
          TYPING_COMPOSING_START_MIN_MS,
          TYPING_COMPOSING_START_MAX_MS,
        );
        const startSessionId = selectedSessionId;
        const startJid = jid;
        outgoingTypingStartTimer = setTimeout(() => {
          outgoingTypingStartTimer = null;
          if (
            !outgoingTypingActive ||
            outgoingTypingSessionId !== startSessionId ||
            normalizeJid(outgoingTypingJid) !== normalizeJid(startJid)
          ) {
            return;
          }

          void this.sendChatPresence("composing", startJid, startSessionId);
          outgoingTypingComposingSent = true;
          this.armOutgoingTypingKeepAlive();
        }, startDelayMs);
      } else if (outgoingTypingComposingSent && !outgoingTypingKeepAliveTimer) {
        this.armOutgoingTypingKeepAlive();
      }

      if (outgoingTypingPauseTimer) {
        clearTimeout(outgoingTypingPauseTimer);
      }

      const idlePauseMs = randomBetween(
        TYPING_PAUSE_AFTER_IDLE_MIN_MS,
        TYPING_PAUSE_AFTER_IDLE_MAX_MS,
      );
      outgoingTypingPauseTimer = setTimeout(() => {
        void this.pauseOutgoingTypingPresence();
      }, idlePauseMs);
    },

    async pauseOutgoingTypingPresence(forceSendPaused = false) {
      if (outgoingTypingPauseTimer) {
        clearTimeout(outgoingTypingPauseTimer);
        outgoingTypingPauseTimer = null;
      }
      if (outgoingTypingStartTimer) {
        clearTimeout(outgoingTypingStartTimer);
        outgoingTypingStartTimer = null;
      }
      if (outgoingTypingKeepAliveTimer) {
        clearTimeout(outgoingTypingKeepAliveTimer);
        outgoingTypingKeepAliveTimer = null;
      }

      const hasActiveTyping = outgoingTypingActive;
      const hadComposingSent = outgoingTypingComposingSent;
      const sessionId = outgoingTypingSessionId;
      const jid = outgoingTypingJid;

      outgoingTypingActive = false;
      outgoingTypingComposingSent = false;
      outgoingTypingSessionId = "";
      outgoingTypingJid = "";

      if (!sessionId || !jid) return;
      if (!hasActiveTyping && !forceSendPaused) return;
      if (!hadComposingSent && !forceSendPaused) return;

      await this.sendChatPresence("paused", jid, sessionId, forceSendPaused);
    },

    async render() {
      const pollCfg = loadPollingConfig();
      const sessions = await this.getSessions();
      latestSessions = sessions;
      selectedSessionId =
        window.App?.resolveSelectedSession?.(sessions) ||
        sessions[0]?.sessionId ||
        sessions[0]?.id ||
        "";
      selectedJid = "";
      selectedMode = "personal";
      chatCache = [];
      const activeSession =
        sessions.find((session) => (session.sessionId || session.id) === selectedSessionId) ||
        sessions[0];
      activeSelfJid = normalizeJid(activeSession?.user?.id || "");
      activeSelfLid = normalizeJid(activeSession?.user?.lid || "");

      UI.setHtml(
        document.getElementById("page-content"),
        `
			<div class="chatrooms-page">
				<div class="chatrooms-toolbar">
					<div class="chatrooms-toolbar-controls">
						<div class="form-group chatrooms-session-group">
							<label for="chatrooms-session">Session</label>
							<select id="chatrooms-session" ${selectedSessionId ? "" : "disabled"}>
							${
                sessions.length
                  ? sessions
                      .map(
                        (s) =>
                          `<option value="${s.sessionId || s.id}">${s.sessionId || s.id}</option>`,
                      )
                      .join("")
                  : "<option>No connected sessions</option>"
              }
							</select>
						</div>
						<div class="chatrooms-mode-toggle" id="chatrooms-mode-toggle">
							<button class="chatrooms-mode-btn active" data-mode="personal">Personal</button>
							<button class="chatrooms-mode-btn" data-mode="groups">Groups</button>
						</div>
						<div class="form-group chatrooms-search-group">
							<label for="chatrooms-search">Search Chat</label>
							<input type="text" id="chatrooms-search" placeholder="Search by name / JID" />
						</div>
						<div class="chatrooms-toolbar-actions">
							<div class="chatrooms-action-buttons">
							<button class="btn btn-outline btn-sm" id="chatrooms-polling-toggle" type="button">Polling Settings</button>
							<button class="btn btn-outline btn-sm" id="chatrooms-refresh">Refresh</button>
							${can("manageGroups") ? '<button class="btn btn-outline btn-sm hidden" id="chatrooms-create-group">+ Create Group</button>' : ""}
							</div>
							
							<span class="badge badge-info" id="polling-mode-badge">POLL: ACTIVE</span>
						</div>
					</div>
				</div>

				<div class="chatrooms-polling-panel-row" id="chatrooms-polling-panel-row" hidden>
					<div class="chatrooms-polling-panel" id="chatrooms-polling-panel">
						<div class="form-group chatrooms-polling-group">
							<label>Polling (ms)</label>
							<div class="chatrooms-polling-controls">
								<div class="chatrooms-polling-inputs">
									<input type="number" id="poll-active-ms" min="1500" max="20000" value="${pollCfg.activeMs}" title="Active tab interval" placeholder="Active" />
									<input type="number" id="poll-idle-ms" min="5000" max="120000" value="${pollCfg.idleMs}" title="Background tab interval" placeholder="Idle" />
								</div>
								<button class="btn btn-outline btn-sm" id="poll-apply-btn" type="button">Apply</button>
							</div>
							<p class="chatrooms-polling-help">Left input is for active tab interval, right input is for background interval.</p>
						</div>
					</div>
				</div>

				<div class="card chatrooms-compose-card">
					<form id="chatrooms-compose-form" class="chatrooms-compose-form">
						<input type="text" id="chatrooms-compose-receiver" placeholder="WA Number (62...) or Group JID" required />
						<input type="text" id="chatrooms-compose-text" placeholder="Message text" maxlength="2000" required />
						<button class="btn btn-primary" type="submit">Send</button>
					</form>
					<p class="text-xs text-muted mt-1">Use a WhatsApp number for personal chat, or a Group JID when Groups mode is selected.</p>
				</div>

				<div class="chatrooms-layout">
					<aside class="chatrooms-sidebar" id="chatrooms-sidebar"></aside>
					<section class="chatrooms-main" id="chatrooms-main"></section>
				</div>
			</div>`,
      );

      const sessionSelect = document.getElementById("chatrooms-session");
      const refreshBtn = document.getElementById("chatrooms-refresh");
      const searchInput = document.getElementById("chatrooms-search");
      const pollToggleBtn = document.getElementById("chatrooms-polling-toggle");
      const pollPanelRow = document.getElementById("chatrooms-polling-panel-row");
      const pollPanel = document.getElementById("chatrooms-polling-panel");
      const pollApplyBtn = document.getElementById("poll-apply-btn");
      const pollActiveInput = document.getElementById("poll-active-ms");
      const pollIdleInput = document.getElementById("poll-idle-ms");

      if (!selectedSessionId) {
        UI.setHtml(
          document.getElementById("chatrooms-sidebar"),
          '<div class="chatrooms-empty">No session available. Please create and connect a session first.</div>',
        );
        UI.setHtml(
          document.getElementById("chatrooms-main"),
          '<div class="chatrooms-empty">Select a session to start testing chat rooms.</div>',
        );
        return;
      }

      document.querySelectorAll(".chatrooms-mode-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          selectedMode = btn.dataset.mode;
          selectedJid = "";
          document.querySelectorAll(".chatrooms-mode-btn").forEach((b) => {
            b.classList.remove("active");
          });
          btn.classList.add("active");
          document
            .getElementById("chatrooms-create-group")
            ?.classList.toggle("hidden", selectedMode !== "groups");
          await this.loadChatList(true, true);
        });
      });

      sessionSelect.value = selectedSessionId;
      sessionSelect.addEventListener("change", async (e) => {
        selectedSessionId = e.target.value;
        window.App?.setSelectedSessionId?.(selectedSessionId);
        selectedJid = "";
        const currentSession = latestSessions.find(
          (s) => (s.sessionId || s.id) === selectedSessionId,
        );
        activeSelfJid = normalizeJid(currentSession?.user?.id || "");
        activeSelfLid = normalizeJid(currentSession?.user?.lid || "");
        await this.loadChatList(true, true);
      });

      searchInput.addEventListener("input", async () => {
        await this.renderChatListFromCache(searchInput.value.trim().toLowerCase());
      });

      refreshBtn.addEventListener("click", async () => {
        await this.loadChatList(true, selectedMode === "groups");
        if (selectedJid) {
          await this.loadConversation(selectedJid);
        }
      });

      pollToggleBtn.addEventListener("click", () => {
        const isOpen = pollPanelRow && !pollPanelRow.hasAttribute("hidden");
        if (!isOpen) {
          pollPanelRow?.removeAttribute("hidden");
          requestAnimationFrame(() => pollPanel.classList.add("is-open"));
          pollToggleBtn.classList.add("active");
          pollActiveInput?.focus();
          return;
        }
        pollPanel.classList.remove("is-open");
        pollToggleBtn.classList.remove("active");
        setTimeout(() => {
          pollPanelRow?.setAttribute("hidden", "hidden");
        }, 170);
      });

      pollApplyBtn.addEventListener("click", () => {
        const next = savePollingConfig(pollActiveInput.value, pollIdleInput.value);
        pollActiveInput.value = String(next.activeMs);
        pollIdleInput.value = String(next.idleMs);
        this.restartPollingSoon();
        Toast.success("Polling interval updated");
      });

      document.getElementById("chatrooms-compose-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const receiverInput = document.getElementById("chatrooms-compose-receiver");
        const textInput = document.getElementById("chatrooms-compose-text");
        const receiver = receiverInput.value.trim();
        const text = textInput.value.trim();
        if (!receiver || !text) return;

        if (selectedJid) {
          await this.markRoomAsRead(selectedJid, false);
        }

        const sendResult = await API.post(
          `/sessions/${encodeURIComponent(selectedSessionId)}/chats/send-text`,
          { receiver, text, isGroup: selectedMode === "groups" },
        );

        if (!sendResult.success) {
          Toast.error(sendResult.message || "Failed to send message");
          return;
        }

        textInput.value = "";
        Toast.success("Message sent");
        await this.loadChatList(false);
      });

      document.getElementById("chatrooms-create-group")?.addEventListener("click", () => {
        this.showCreateGroupModal();
      });
      document
        .getElementById("chatrooms-create-group")
        ?.classList.toggle("hidden", selectedMode !== "groups");

      await this.loadChatList(true, selectedMode === "groups");
      this.bindPollingLifecycle();
      this.startPolling();
      this.startPresenceStream();
    },

    bindPollingLifecycle() {
      window.removeEventListener("focus", this.onWindowFocus);
      window.removeEventListener("blur", this.onWindowBlur);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);

      window.addEventListener("focus", this.onWindowFocus);
      window.addEventListener("blur", this.onWindowBlur);
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    },

    onWindowFocus: () => {
      isWindowFocused = true;
      window.ChatRoomsPage?.updatePollingModeBadge();
      window.ChatRoomsPage?.restartPollingSoon();
    },

    onWindowBlur: () => {
      isWindowFocused = false;
      window.ChatRoomsPage?.updatePollingModeBadge();
      window.ChatRoomsPage?.restartPollingSoon();
    },

    onVisibilityChange: () => {
      window.ChatRoomsPage?.updatePollingModeBadge();
      window.ChatRoomsPage?.restartPollingSoon();
    },

    getPollingIntervalMs() {
      const cfg = loadPollingConfig();
      if (!isWindowFocused || document.hidden) {
        return cfg.idleMs;
      }
      return cfg.activeMs;
    },

    updatePollingModeBadge() {
      const badge = document.getElementById("polling-mode-badge");
      if (!badge) return;
      const cfg = loadPollingConfig();
      if (!isWindowFocused || document.hidden) {
        badge.className = "badge badge-warning";
        badge.textContent = `POLL: IDLE (${cfg.idleMs}ms)`;
        return;
      }

      badge.className = "badge badge-info";
      badge.textContent = `POLL: ACTIVE (${cfg.activeMs}ms)`;
    },

    restartPollingSoon() {
      this.startPolling(400);
    },

    startPolling(delayMs = 0) {
      this.stopPolling();
      this.updatePollingModeBadge();
      refreshTimer = setTimeout(async () => {
        if (!selectedSessionId) return;
        await this.loadChatList(false);
        if (selectedJid) {
          await this.refreshCurrentConversation(false);
        }
        this.startPolling();
      }, delayMs || this.getPollingIntervalMs());
    },

    stopPolling() {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    },

    startPresenceStream() {
      this.stopPresenceStream();
      // Cookie-authenticated stream (no token in the URL).
      eventSource = new EventSource("/dashboard/api/events/stream");

      eventSource.addEventListener("baileys-event", (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev?.event === "presence.update") {
            this.handlePresenceEvent(ev);
          } else if (ev?.event === "message-receipt.update") {
            this.handleReceiptUpdate(ev);
          }
        } catch {
          // Ignore malformed event payload.
        }
      });

      eventSource.onerror = () => {
        // Keep silent for dashboard lightweight mode.
      };
    },

    stopPresenceStream() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      typingTimers.forEach((timer) => {
        clearTimeout(timer);
      });
      typingTimers.clear();
    },

    handlePresenceEvent(ev) {
      if (!selectedJid || ev?.sessionId !== selectedSessionId) return;
      if (ev?.event !== "presence.update") return;

      const data = ev?.data || {};
      const presences = data.presences || {};
      const isGroupMode = selectedMode === "groups";

      let typingLabel = "";
      Object.entries(presences).forEach(([participantJid, p]) => {
        const presence = p?.lastKnownPresence || p?.presence;
        if (!["composing", "recording"].includes(presence)) return;

        if (normalizeJid(participantJid) === normalizeJid(activeSelfJid)) return;

        if (!isGroupMode) {
          if (normalizeJid(participantJid) === normalizeJid(selectedJid)) {
            typingLabel = "Typing...";
          }
          return;
        }

        typingLabel = `${jidPhoneOnly(participantJid)} is typing...`;
      });

      if (!typingLabel) return;

      const indicator = document.getElementById("chatroom-typing-indicator");
      if (!indicator) return;

      indicator.textContent = typingLabel;
      indicator.classList.remove("is-hidden");

      const key = `${selectedSessionId}:${selectedJid}`;
      if (typingTimers.has(key)) clearTimeout(typingTimers.get(key));
      typingTimers.set(
        key,
        setTimeout(() => {
          const current = document.getElementById("chatroom-typing-indicator");
          if (current) current.classList.add("is-hidden");
        }, 3500),
      );
    },

    handleReceiptUpdate(ev) {
      if (!selectedJid || ev?.sessionId !== selectedSessionId) return;
      if (ev?.event !== "message-receipt.update") return;

      const data = ev?.data || {};
      const receipts = data.receipts || {};

      // receipts[jid] = { keys: [{ remoteJid, id, fromMe }], receipt: { type, timestamp } }
      // Example: 62XXXXX@s.whatsapp.net = { keys: [...], receipt: { type: "read|delivered|watched", ... } }
      Object.entries(receipts).forEach(([jid, receiptData]) => {
        if (normalizeJid(jid) !== normalizeJid(selectedJid)) return;

        const receipt = receiptData?.receipt || {};
        const receiptType = receipt?.type; // "read", "delivered", "watched", etc
        const keys = receiptData?.keys || [];

        keys.forEach((msgKey) => {
          if (!msgKey?.id) return;
          // Update bubble status based on receipt type
          this.updateMessageBubbleStatus(msgKey.id, receiptType);
        });
      });
    },

    updateMessageBubbleStatus(messageId, receiptType) {
      if (!receiptType) return;
      if (!messageId) return;

      // Update bubble status in DOM if visible
      const bubbles = document.querySelectorAll(".msg-bubble-wrap.from-me");
      bubbles.forEach((bubble) => {
        const msgKey = bubble.dataset.messageKey;
        if (!msgKey) return; // Only update tracked messages
        if (msgKey !== messageId) return;

        const msgBubble = bubble.querySelector(".msg-bubble");
        const timeEl = bubble.querySelector(".msg-time");
        if (!msgBubble || !timeEl) return;

        // Update in tracking map
        if (sentMessageStatus.has(msgKey)) {
          const current = sentMessageStatus.get(msgKey);
          sentMessageStatus.set(msgKey, {
            ...current,
            status: receiptType,
          });
        }

        // Update in DOM
        const timestamp = timeEl.textContent.match(/^[^•]+/)?.[0] || "Now";

        if (receiptType === "read") {
          msgBubble.classList.add("msg-bubble-read");
          timeEl.textContent = `${timestamp} • Read`;
        } else if (receiptType === "delivered" || receiptType === "watched") {
          timeEl.textContent = `${timestamp} • ${receiptType.charAt(0).toUpperCase() + receiptType.slice(1)}`;
        }
      });
    },

    async getSessions() {
      const result = await API.get("/sessions");
      if (!result.success) return [];
      return (result.data || []).filter((s) => s.connected);
    },

    async loadGroupInventory(force = false) {
      const now = Date.now();
      if (
        !force &&
        groupInventoryCache.sessionId === selectedSessionId &&
        now - groupInventoryCache.at < GROUP_INVENTORY_TTL_MS
      ) {
        return groupInventoryCache.groups;
      }

      const result = await API.get(`/groups/${encodeURIComponent(selectedSessionId)}/list`);
      const groups = result.success ? result.data || [] : [];
      groupInventoryCache = { sessionId: selectedSessionId, at: now, groups };
      return groups;
    },

    async loadChatList(showToastOnError = true, forceGroupInventory = false) {
      if (!selectedSessionId) return;
      const searchInput = document.getElementById("chatrooms-search");
      const query = (searchInput?.value || "").trim().toLowerCase();
      const isGroupMode = selectedMode === "groups";

      const result = await API.get(
        `/sessions/${encodeURIComponent(selectedSessionId)}/chats?isGroup=${isGroupMode}`,
      );
      if (!result.success) {
        if (showToastOnError) Toast.error(result.message || "Failed to load chats");
        return;
      }

      const localChats = (result.data || [])
        .filter((chat) => (isGroupMode ? isGroupJid(chat.id) : isOneToOneJid(chat.id)))
        .filter((chat) => normalizeJid(chat.id) !== normalizeJid(activeSelfJid))
        .filter((chat) => !activeSelfLid || normalizeJid(chat.id) !== normalizeJid(activeSelfLid))
        .filter((chat) => normalizeJid(chat.id) !== "status@broadcast");

      let chats = localChats;
      if (isGroupMode) {
        // Local chats are shown first; the WhatsApp inventory adds groups that
        // have no message history/room yet. Fetched once per session/tab, not
        // on every poll.
        const inventory = await this.loadGroupInventory(forceGroupInventory);
        const merged = new Map(localChats.map((chat) => [normalizeJid(chat.id), chat]));
        for (const group of inventory) {
          const id = String(group.id || group.jid || "");
          if (!isGroupJid(id)) continue;
          const key = normalizeJid(id);
          if (merged.has(key)) continue;
          merged.set(key, {
            id,
            subject: group.subject || group.name || "",
            name: group.subject || group.name || "",
            participants: group.participants || [],
            size: group.size,
            conversationTimestamp: 0,
            inventoryOnly: true,
          });
        }
        chats = [...merged.values()];
      }

      const timestamp = (chat) => Number(chat.conversationTimestamp || 0);
      chatCache = chats.sort((a, b) => {
        const at = timestamp(a);
        const bt = timestamp(b);
        if (at === 0 && bt === 0) {
          return normalizeContactName(a).localeCompare(normalizeContactName(b));
        }
        if (at === 0) return 1;
        if (bt === 0) return -1;
        return bt - at;
      });

      if (selectedJid) {
        chatCache = chatCache.map((chat) =>
          chat.id === selectedJid ? { ...chat, unreadCount: 0 } : chat,
        );
      }

      await this.renderChatListFromCache(query);
    },

    async renderChatListFromCache(query = "") {
      const sidebar = document.getElementById("chatrooms-sidebar");
      if (!sidebar) return;

      const filtered = chatCache.filter((chat) => {
        if (!query) return true;
        const haystack = `${normalizeContactName(chat)} ${chat.id || ""}`.toLowerCase();
        return haystack.includes(query);
      });

      if (!filtered.length) {
        UI.setHtml(
          sidebar,
          query
            ? '<div class="chatrooms-empty">No chat matched your search.</div>'
            : selectedMode === "groups"
              ? '<div class="chatrooms-empty">No groups found for this session.</div>'
              : '<div class="chatrooms-empty">No 1-on-1 chat found in store yet.</div>',
        );
        UI.setHtml(
          document.getElementById("chatrooms-main"),
          '<div class="chatrooms-empty">Send or receive at least one message to populate rooms.</div>',
        );
        return;
      }

      UI.setHtml(
        sidebar,
        filtered
          .map((chat) => {
            const jid = chat.id;
            const name = escapeHtml(normalizeContactName(chat));
            const unread = Number(chat.unreadCount || 0);
            const time = formatMessageTime(chat.conversationTimestamp);
            const active = jid === selectedJid ? "active" : "";
            const subtitle = chat.inventoryOnly
              ? "Group · No local messages yet"
              : chat.lastMessageRecvTimestamp
                ? `Last activity: ${formatMessageTime(chat.lastMessageRecvTimestamp)}`
                : "Open room to load messages";
            return `
            <div class="chatroom-row">
              <button class="chatroom-item ${active}" data-jid="${jid}">
                <div class="chatroom-item-header">
                  <span class="chatroom-name">${name}</span>
                  <span class="chatroom-time">${time}</span>
                </div>
                <div class="chatroom-item-sub">${escapeHtml(subtitle)}</div>
                ${unread > 0 ? `<span class="chatroom-unread">${unread}</span>` : ""}
              </button>
              <button class="chatroom-kebab chat-menu-trigger" type="button" data-jid="${jid}" title="Chat actions">⋯</button>
            </div>`;
          })
          .join(""),
      );

      sidebar.querySelectorAll(".chatroom-kebab").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          openChatMenu(btn, btn.dataset.jid);
        });
      });

      sidebar.querySelectorAll(".chatroom-item").forEach((btn) => {
        btn.addEventListener("click", async () => {
          selectedJid = btn.dataset.jid;
          sidebar.querySelectorAll(".chatroom-item").forEach((b) => {
            b.classList.remove("active");
          });
          btn.classList.add("active");
          await this.loadConversation(selectedJid);
        });
      });

      if (!selectedJid || !filtered.some((chat) => chat.id === selectedJid)) {
        selectedJid = filtered[0].id;
        await this.loadConversation(selectedJid);
        const first = sidebar.querySelector(`[data-jid="${selectedJid}"]`);
        first?.classList.add("active");
      }
    },

    async markRoomAsRead(jid, showToastOnError = true, force = false) {
      if (!selectedSessionId || !jid) return;
      const key = `${selectedSessionId}:${jid}`;
      const now = Date.now();
      const last = lastReadSyncAt.get(key) || 0;
      if (!force && now - last < READ_SYNC_COOLDOWN_MS) {
        return;
      }

      const result = await API.post(
        `/sessions/${encodeURIComponent(selectedSessionId)}/chats/${encodeURIComponent(jid)}/read?limit=160`,
        {},
      );
      if (!result.success && showToastOnError) {
        Toast.error(result.message || "Failed to mark as read");
        this.setReadSyncStatus("Read sync failed", "error");
        return;
      }

      lastReadSyncAt.set(key, now);

      // Optimistic unread reset in dashboard list, because store chat unreadCount may update asynchronously.
      let changed = false;
      chatCache = chatCache.map((chat) => {
        if (chat.id !== jid) return chat;
        if (Number(chat.unreadCount || 0) === 0) return chat;
        changed = true;
        return { ...chat, unreadCount: 0 };
      });

      if (changed) {
        const searchInput = document.getElementById("chatrooms-search");
        const query = (searchInput?.value || "").trim().toLowerCase();
        await this.renderChatListFromCache(query);
      }

      this.setReadSyncStatus("Read synced", "success");
      setTimeout(() => {
        this.setReadSyncStatus();
      }, 1500);
    },

    appendOutgoingMessage(text) {
      const messagesEl = document.getElementById("chatroom-messages");
      if (!messagesEl) return null;
      pendingBubbleSeq += 1;
      const pendingId = `pending-${Date.now()}-${pendingBubbleSeq}`;
      const currentTimeTs = Math.floor(Date.now() / 1000);

      // Track this message by its text content and timestamp for status tracking
      const msgKey = `${selectedJid}:${text}:${currentTimeTs}`;
      sentMessageStatus.set(msgKey, {
        status: "sending",
        timestamp: currentTimeTs,
      });

      const bubble = document.createElement("div");
      bubble.className = "msg-bubble-wrap from-me";
      bubble.dataset.pendingId = pendingId;
      bubble.dataset.messageKey = msgKey;
      UI.setHtml(
        bubble,
        `
        <div class="msg-bubble from-me msg-bubble-pending">
          <div class="msg-text">${renderTextWithMarkdown(text)}</div>
          <div class="msg-time">${formatMessageTime(currentTimeTs)} • Sending...</div>
        </div>`,
      );

      const emptyState = messagesEl.querySelector(".chatrooms-empty");
      if (emptyState) emptyState.remove();
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      return pendingId;
    },

    markPendingBubbleSent(pendingId, serverTimestamp) {
      if (!pendingId) return;
      const wrap = document.querySelector(`[data-pending-id="${pendingId}"]`);
      if (!wrap) return;
      const bubble = wrap.querySelector(".msg-bubble");
      const time = wrap.querySelector(".msg-time");
      const ts = normalizeTimestampSeconds(serverTimestamp) || Math.floor(Date.now() / 1000);
      bubble?.classList.remove("msg-bubble-pending");
      time.textContent = `${formatMessageTime(ts)} • Sent`;

      // Update tracking status to "sent"
      const msgKey = wrap.dataset.messageKey;
      if (msgKey && sentMessageStatus.has(msgKey)) {
        const status = sentMessageStatus.get(msgKey);
        sentMessageStatus.set(msgKey, {
          ...status,
          status: "sent",
          timestamp: ts,
        });
      }
    },

    removePendingBubble(pendingId) {
      if (!pendingId) return;
      const wrap = document.querySelector(`[data-pending-id="${pendingId}"]`);
      wrap?.remove();
    },

    appendFailedOutgoingMessage(jid, text) {
      const messagesEl = document.getElementById("chatroom-messages");
      if (!messagesEl) return;

      const bubble = document.createElement("div");
      bubble.className = "msg-bubble-wrap from-me";
      UI.setHtml(
        bubble,
        `
        <div class="msg-bubble from-me msg-bubble-failed">
          <div class="msg-text">${renderTextWithMarkdown(text)}</div>
          <div class="msg-failed-actions">
            <span class="text-xs text-danger">Failed to send</span>
            <button class="btn btn-outline btn-sm" type="button">Retry</button>
          </div>
        </div>`,
      );

      const retryBtn = bubble.querySelector("button");
      retryBtn?.addEventListener("click", () => {
        const input = document.getElementById("chatroom-text");
        if (!input) return;
        input.value = text;
        draftByJid.set(jid, text);
        input.focus();
        bubble.remove();
      });

      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },

    showCreateGroupModal() {
      if (!can("manageGroups")) {
        Toast.warning("Your role cannot create groups");
        return;
      }
      if (!selectedSessionId) {
        Toast.warning("Select a session first");
        return;
      }

      Modal.show(
        "Create Group",
        `
        <form id="chatrooms-create-group-form">
          <div class="form-group">
            <label>Group Name</label>
            <input type="text" id="chatrooms-group-name" required autocomplete="off" />
          </div>
          <div class="form-group">
            <label>Participants (Comma-Separated Phones)</label>
            <input type="text" id="chatrooms-group-participants" placeholder="6281234567890,6281234567891" required autocomplete="off" />
          </div>
          <button type="submit" class="btn btn-primary btn-full">Create</button>
        </form>`,
      );

      document
        .getElementById("chatrooms-create-group-form")
        .addEventListener("submit", async (event) => {
          event.preventDefault();
          const groupName = document.getElementById("chatrooms-group-name").value.trim();
          const participants = document
            .getElementById("chatrooms-group-participants")
            .value.split(",")
            .map((participant) => participant.trim())
            .filter(Boolean);
          if (!groupName || participants.length === 0) {
            Toast.warning("Group name and at least one participant are required");
            return;
          }

          const result = await API.post(`/groups/${encodeURIComponent(selectedSessionId)}/create`, {
            groupName,
            participants,
          });
          if (!result.success) {
            Toast.error(result.message || "Failed to create group");
            return;
          }

          groupInventoryCache.at = 0;
          Modal.hide();
          Toast.success("Group created");
          await this.loadChatList(true, true);
        });
    },

    async showGroupMembers(jid) {
      Modal.show(
        "Group Members",
        '<div id="group-members-modal-body" class="text-sm text-muted">Loading members...</div>',
      );

      const result = await API.get(
        `/sessions/${encodeURIComponent(selectedSessionId)}/groups/${encodeURIComponent(jid)}/members`,
      );
      const body = document.getElementById("group-members-modal-body");
      if (!body) return;

      if (!result.success) {
        UI.setHtml(
          body,
          `<div class="text-sm text-danger">${escapeHtml(result.message || "Failed to load members")}</div>`,
        );
        return;
      }

      const members = result.data?.participants || [];
      if (!members.length) {
        UI.setHtml(body, '<div class="text-sm text-muted">No members metadata available.</div>');
        return;
      }

      UI.setHtml(
        body,
        `
        <div class="group-members-count">Members: ${members.length}</div>
        <div class="group-members-list">
          ${members
            .map(
              (m) =>
                `<span class="group-member-chip">${escapeHtml((m.id || "").replace(/@s\.whatsapp\.net$/, ""))}${m.admin ? ` (${escapeHtml(String(m.admin))})` : ""}</span>`,
            )
            .join("")}
        </div>`,
      );
    },

    async loadConversation(jid, showToastOnError = true) {
      if (!selectedSessionId || !jid) return;
      await this.pauseOutgoingTypingPresence();

      const main = document.getElementById("chatrooms-main");
      if (!main) return;

      const identity = chatIdentity(jid);
      const jidLabel = identity.title;
      const isGroupMode = selectedMode === "groups";
      UI.setHtml(
        main,
        `
        <div class="chatroom-header">
          <div>
            <h3>${escapeHtml(jidLabel)}</h3>
            <p class="text-sm text-muted">${identity.lid ? `LID: ${escapeHtml(identity.lid)} · ` : ""}Session: ${escapeHtml(selectedSessionId)}</p>
						<span class="chatroom-read-status is-hidden" id="chatroom-read-status"></span>
						<span class="chatroom-typing-indicator is-hidden" id="chatroom-typing-indicator"></span>
          </div>
          <div class="chatroom-header-actions">
            ${isGroupMode ? '<button class="btn btn-outline btn-sm" id="chatroom-load-members">Members</button>' : ""}
            <button class="btn btn-outline btn-sm chat-menu-trigger" id="chatroom-menu" type="button" title="Chat actions">⋯</button>
          </div>
        </div>
        <div class="chatroom-messages" id="chatroom-messages"><div class="chatrooms-empty">Loading messages...</div></div>
        <form class="chatroom-input" id="chatroom-send-form">
          <input type="text" id="chatroom-text" placeholder="Type a message for this room..." autocomplete="off" maxlength="2000" />
          <button class="btn btn-primary" type="submit">Send</button>
        </form>`,
      );

      document.getElementById("chatroom-menu").addEventListener("click", (event) => {
        event.stopPropagation();
        openChatMenu(event.currentTarget, jid);
      });

      if (isGroupMode) {
        document.getElementById("chatroom-load-members").addEventListener("click", async () => {
          await this.showGroupMembers(jid);
        });
      }

      const result = await API.get(
        `/sessions/${encodeURIComponent(selectedSessionId)}/chats/${encodeURIComponent(jid)}/messages?limit=80`,
      );
      if (!result.success) {
        if (showToastOnError) Toast.error(result.message || "Failed to load conversation");
        UI.setHtml(
          document.getElementById("chatroom-messages"),
          '<div class="chatrooms-empty">Failed to load conversation.</div>',
        );
        return;
      }

      await this.markRoomAsRead(jid, false);
      this.renderConversationMessages(jid, result.data || []);

      document.getElementById("chatroom-send-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = document.getElementById("chatroom-text");
        const rawText = input.value;
        const text = rawText.trim();
        if (!text || isSending) return;

        await this.pauseOutgoingTypingPresence();

        // Clear input immediately
        input.value = "";
        draftByJid.set(jid, "");

        // Mark as sending to prevent overlapping requests
        isSending = true;

        // Pause polling to prevent interference
        this.stopPolling();

        try {
          await this.markRoomAsRead(jid, false);
          const pendingId = this.appendOutgoingMessage(text);

          const receiver = selectedMode === "groups" ? jid : jid.replace(/@s\.whatsapp\.net$/, "");
          const sendResult = await API.post(
            `/sessions/${encodeURIComponent(selectedSessionId)}/chats/send-text`,
            {
              receiver,
              text,
              isGroup: selectedMode === "groups",
            },
          );

          if (!sendResult.success) {
            Toast.error(sendResult.message || "Failed to send message");
            this.removePendingBubble(pendingId);
            this.appendFailedOutgoingMessage(jid, text);
            // Keep previous draft if sending failed.
            draftByJid.set(jid, rawText);
            input.value = rawText;
            await this.refreshCurrentConversation(false);
            return;
          }

          this.markPendingBubbleSent(pendingId, sendResult?.data?.messageTimestamp);

          await this.loadChatList(false);

          // Wait a bit for socket to process message in store
          await new Promise((resolve) => setTimeout(resolve, 1200));

          // Refresh stored messages in background to replace temporary bubble
          await this.refreshCurrentConversation(false);
        } finally {
          // Resume polling
          isSending = false;
          this.startPolling();
        }
      });

      const composer = document.getElementById("chatroom-text");
      composer.value = draftByJid.get(jid) || "";
      composer.addEventListener("input", () => {
        draftByJid.set(jid, composer.value);
        if (composer.value.trim()) {
          this.scheduleOutgoingTypingPresence(jid);
          return;
        }
        void this.pauseOutgoingTypingPresence();
      });
    },

    renderConversationMessages(jid, rawMessages) {
      const messages = (rawMessages || [])
        .slice()
        // Timestamps arrive as JSON-serialized Baileys Long objects
        // ({ low, high }), so Number(obj) is NaN. Normalize before sorting,
        // otherwise the API's newest-first order is preserved and the oldest
        // message appears at the bottom of the conversation.
        .sort(
          (a, b) =>
            (normalizeTimestampSeconds(a.messageTimestamp) ?? 0) -
            (normalizeTimestampSeconds(b.messageTimestamp) ?? 0),
        );

      const visibleMessages = messages.filter((msg) => {
        const payload = extractMessagePayload(msg);
        return !payload.unsupported;
      });

      const messagesEl = document.getElementById("chatroom-messages");
      if (!messagesEl) return;

      const nearBottom =
        messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 90;

      if (!visibleMessages.length) {
        UI.setHtml(
          messagesEl,
          '<div class="chatrooms-empty">No visible chat message (system payload skipped).</div>',
        );
        return;
      }

      UI.setHtml(
        messagesEl,
        visibleMessages
          .map((msg) => {
            const fromMe = !!msg?.key?.fromMe;
            const payload = extractMessagePayload(msg);
            const mentioned = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const actionButtons = extractActionButtons(msg);
            const time = formatMessageTime(msg.messageTimestamp);

            // Check if this message has a tracked status (sent/read/delivered)
            let statusClass = "";
            let statusTag = "";
            let msgKey = "";
            if (fromMe) {
              // Find matching sent message by text content
              for (const [key, statusObj] of sentMessageStatus.entries()) {
                if (
                  key.startsWith(`${jid}:`) &&
                  key.includes(payload.text) &&
                  statusObj.status !== "sending"
                ) {
                  msgKey = key;
                  const status = statusObj.status;
                  if (status === "read") {
                    statusClass = " msg-bubble-read";
                    statusTag = " • Read";
                  } else if (status === "delivered") {
                    statusTag = " • Delivered";
                  } else if (status === "sent") {
                    statusTag = " • Sent";
                  } else if (status === "watched") {
                    statusTag = " • Watched";
                  }
                  break;
                }
              }
            }

            const bubbleWrap = `msg-bubble-wrap ${fromMe ? "from-me" : "from-them"}`;
            const dataMessageKey = msgKey ? ` data-message-key="${msgKey}"` : "";

            return `
              <div class="${bubbleWrap}"${dataMessageKey}>
                <div class="msg-bubble ${fromMe ? "from-me" : "from-them"}${statusClass}">
                  <div class="msg-text">${renderTextWithMarkdown(payload.text || "(empty)")}</div>
                  ${
                    Array.isArray(mentioned) && mentioned.length > 0
                      ? `<div class="msg-mentions">Mentions: ${mentioned
                          .map(
                            (m) =>
                              `<span class="msg-mention-chip">${escapeHtml(jidPhoneOnly(String(m)))}</span>`,
                          )
                          .join("")}</div>`
                      : ""
                  }
                  ${
                    actionButtons.length > 0
                      ? `<div class="msg-actions">${actionButtons
                          .map(
                            (label) => `<span class="msg-action-pill">${escapeHtml(label)}</span>`,
                          )
                          .join("")}</div>`
                      : ""
                  }
                  <div class="msg-time">${time}${statusTag}</div>
                </div>
              </div>`;
          })
          .join(""),
      );

      if (nearBottom) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    },

    async refreshCurrentConversation(showToastOnError = false) {
      if (!selectedSessionId || !selectedJid) return;
      const messagesEl = document.getElementById("chatroom-messages");
      if (!messagesEl) return;

      const result = await API.get(
        `/sessions/${encodeURIComponent(selectedSessionId)}/chats/${encodeURIComponent(selectedJid)}/messages?limit=80`,
      );
      if (!result.success) {
        if (showToastOnError) {
          Toast.error(result.message || "Failed to refresh conversation");
        }
        return;
      }

      this.renderConversationMessages(selectedJid, result.data || []);
    },

    destroy() {
      this.stopPolling();
      this.stopPresenceStream();
      this.setReadSyncStatus();
      void this.pauseOutgoingTypingPresence();
      isSending = false;
      outgoingPresenceState.clear();
      sentMessageStatus.clear();
      window.removeEventListener("focus", this.onWindowFocus);
      window.removeEventListener("blur", this.onWindowBlur);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      selectedJid = "";
      selectedSessionId = "";
      activeSelfJid = "";
    },
  };
})();
