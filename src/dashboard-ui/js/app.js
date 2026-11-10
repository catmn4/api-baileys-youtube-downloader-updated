/** Main App — SPA Router & Initialization */
(() => {
  const roleCapabilities = {
    admin: new Set([
      "viewSessions",
      "manageSessions",
      "createSessions",
      "deleteSessions",
      "reconnectSessions",
      "viewChats",
      "sendOutbound",
      "replyIncoming",
      "manageGroups",
      "viewGroups",
      "manageWebhooks",
      "manageApiKeys",
      "viewSettings",
      "viewEvents",
      "manageEvents",
      "sendBulk",
    ]),
    manager: new Set([
      "viewSessions",
      "manageSessions",
      "reconnectSessions",
      "viewChats",
      "sendOutbound",
      "replyIncoming",
      "manageGroups",
      "viewGroups",
      "manageWebhooks",
      "manageApiKeys",
      "viewSettings",
      "viewEvents",
      "sendBulk",
    ]),
    assistant: new Set([
      "viewSessions",
      "viewChats",
      "replyIncoming",
      "sendOutbound",
      "viewGroups",
      "viewSettings",
    ]),
  };

  const pages = {
    overview: { title: "Overview", render: () => OverviewPage.render() },
    sessions: {
      title: "Sessions",
      requires: "viewSessions",
      roles: ["admin", "manager"],
      render: () => SessionsPage.render(),
      destroy: () => SessionsPage.destroy?.(),
    },
    messaging: {
      title: "Messaging",
      requires: "sendOutbound",
      needsSession: true,
      render: () => MessagingPage.render(),
    },
    chatrooms: {
      title: "Chat Rooms",
      requires: "viewChats",
      needsSession: true,
      render: () => ChatRoomsPage.render(),
      destroy: () => ChatRoomsPage.destroy?.(),
    },
    webhooks: {
      title: "Webhooks",
      requires: "manageWebhooks",
      needsSession: true,
      render: () => WebhooksPage.render(),
      destroy: () => WebhooksPage.destroy?.(),
    },
    events: {
      title: "Event Monitor",
      requires: "viewEvents",
      needsWebhook: true,
      render: () => EventsPage.render(),
      destroy: () => EventsPage.destroy?.(),
    },
    ai: {
      title: "AI & Routing",
      requires: "manageSessions",
      needsSession: true,
      render: () => AiPage.render(),
    },
    api: {
      title: "REST API",
      requires: "manageApiKeys",
      needsSession: true,
      render: () => ApiPage.render(),
      destroy: () => ApiPage.destroy?.(),
    },
    settings: {
      title: "Settings",
      requires: "viewSettings",
      render: () => SettingsPage.render(),
    },
  };

  let currentPage = null;
  /** Cached session list used to gate session-dependent navigation. */
  let sessionCache = [];

  async function loadSessionsForNav() {
    try {
      const result = await API.get("/sessions");
      sessionCache = result.success ? result.data || [] : [];
    } catch {
      sessionCache = [];
    }
    return sessionCache;
  }

  function hasSession() {
    return sessionCache.length > 0;
  }

  function hasWebhookConfigured() {
    return sessionCache.some((session) => String(session.webhookUrl || "").trim().length > 0);
  }

  /** Read the cached user without throwing on corrupted storage. */
  function readStoredUser() {
    try {
      const parsed = JSON.parse(localStorage.getItem("wa-dashboard-user") || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  /** Pages that need infrastructure hide themselves until it exists. */
  const SELECTED_SESSION_PREFIX = "wa-dashboard-selected-session";

  function selectedSessionKey() {
    const user = readStoredUser();
    return `${SELECTED_SESSION_PREFIX}:${user.id || user.username || "anonymous"}`;
  }

  function readSelectedSessionId() {
    try {
      return localStorage.getItem(selectedSessionKey()) || "";
    } catch {
      return "";
    }
  }

  function rememberSelectedSessionId(sessionId) {
    try {
      if (sessionId) localStorage.setItem(selectedSessionKey(), sessionId);
      else localStorage.removeItem(selectedSessionKey());
    } catch {
      // Storage unavailable; selection still works for this page render.
    }
  }

  function isPageAvailable(page) {
    if (!page) return false;
    if (page.needsSession && !hasSession()) return false;
    if (page.needsWebhook && !hasWebhookConfigured()) return false;
    return true;
  }

  window.App = {
    async init() {
      Modal.init();

      // Theme toggle
      document
        .getElementById("theme-toggle")
        .addEventListener("click", () => ThemeManager.toggle());

      // Sidebar navigation
      document.querySelectorAll(".nav-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          e.preventDefault();
          const page = item.dataset.page;
          this.navigate(page);
          // Close mobile sidebar
          document.getElementById("sidebar").classList.remove("open");
        });
      });

      // Mobile hamburger
      document.getElementById("hamburger").addEventListener("click", () => {
        document.getElementById("sidebar").classList.toggle("open");
      });
      document.getElementById("sidebar-close").addEventListener("click", () => {
        document.getElementById("sidebar").classList.remove("open");
      });

      // Logout
      document.getElementById("btn-logout").addEventListener("click", async () => {
        // Clear the HttpOnly cookie server-side, then forget local state.
        await API.post("/auth/logout", {});
        API.clearToken();
        localStorage.removeItem("wa-dashboard-user");
        this.showAuth();
        Toast.info("Logged out");
      });

      // Check auth. The HttpOnly cookie is the source of truth; memoryToken is
      // empty after a refresh, so gating this on API.getToken() forced a
      // spurious re-login on every reload.
      const result = await API.get("/auth/me");
      if (result.success) {
        await this.showDashboard(result.data);
        return;
      }
      this.showAuth();
    },

    showAuth() {
      document.getElementById("auth-screen").classList.remove("hidden");
      document.getElementById("dashboard").classList.add("hidden");
      AuthUI.init();
    },

    async showDashboard(user) {
      localStorage.setItem("wa-dashboard-user", JSON.stringify(user || {}));
      document.getElementById("auth-screen").classList.add("hidden");
      document.getElementById("dashboard").classList.remove("hidden");
      this.renderUserBadge(user?.username || "User");
      await loadSessionsForNav();
      this.applyRoleAccess(user || {});
      this.loadBrandInfo();

      // Navigate to hash or default
      const hash = window.location.hash.replace("#", "") || "overview";
      this.navigate(hash);
    },

    /** Fill the sidebar version from /about; cosmetic, never blocks the UI. */
    async loadBrandInfo() {
      try {
        const result = await API.get("/about");
        const version = result?.success ? result.data?.version : "";
        const element = document.getElementById("sidebar-version");
        if (element && version) element.textContent = version;
      } catch {
        // Branding is cosmetic.
      }
    },

    getUserCapabilities(user) {
      const role = user?.role || "assistant";
      return roleCapabilities[role] || roleCapabilities.assistant;
    },

    hasCapability(user, capability) {
      if (!capability) return true;
      return this.getUserCapabilities(user).has(capability);
    },

    /** Persisted active session shared by Chat Rooms, AI, Webhooks, etc. */
    getSelectedSessionId() {
      return readSelectedSessionId();
    },

    setSelectedSessionId(sessionId) {
      rememberSelectedSessionId(String(sessionId || ""));
    },

    resolveSelectedSession(sessions) {
      const ids = (sessions || [])
        .map((session) => String(session?.sessionId || session?.id || ""))
        .filter(Boolean);
      const stored = this.getSelectedSessionId();
      const chosen = stored && ids.includes(stored) ? stored : ids[0] || "";
      if (chosen) this.setSelectedSessionId(chosen);
      return chosen;
    },

    applyRoleAccess(user) {
      const role = user?.role || "assistant";
      document.querySelectorAll(".nav-item").forEach((item) => {
        const pageName = item.dataset.page;
        const page = pages[pageName];
        const roleOk =
          this.hasCapability(user, page?.requires) &&
          (!page?.requiresRole || role === page.requiresRole) &&
          (!page?.roles || page.roles.includes(role));
        // Session-dependent menus stay hidden until they can actually be used.
        const allowed = roleOk && isPageAvailable(page);
        item.style.display = allowed ? "" : "none";
      });
    },

    /**
     * Re-evaluate navigation after sessions or webhooks change, so pages that
     * depend on them appear/disappear without a reload.
     */
    async refreshAvailability() {
      await loadSessionsForNav();
      const user = readStoredUser();
      this.applyRoleAccess(user);
      if (currentPage && !isPageAvailable(pages[currentPage])) this.navigate("overview");
    },

    /** Get initials from username: "admin" → "A", "admin_dashboard" → "AD", "john_doe_smith" → "JD" */
    getInitials(username) {
      const parts = username.split(/[_\-.\s]+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return username.substring(0, 1).toUpperCase();
    },

    /** Deterministic color from username hash */
    getAvatarColor(username) {
      let hash = 0;
      for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash) % 360;
      return `hsl(${hue}, 65%, 50%)`;
    },

    /** Convert username to Title Case: "admin_dashboard" → "Admin Dashboard" */
    toTitleCase(username) {
      return username
        .split(/[_\-.\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    },

    renderUserBadge(username) {
      const initials = this.getInitials(username);
      const color = this.getAvatarColor(username);
      const displayName = this.toTitleCase(username);
      const el = document.getElementById("user-badge");
      el.replaceChildren();
      const avatar = document.createElement("div");
      avatar.className = "user-avatar";
      avatar.style.background = color;
      avatar.textContent = initials;
      const name = document.createElement("span");
      name.className = "user-name";
      name.textContent = displayName;
      el.append(avatar, name);
    },

    navigate(pageName) {
      const user = readStoredUser();
      // Destroy previous page if has cleanup
      if (currentPage && pages[currentPage]?.destroy) {
        pages[currentPage].destroy();
      }

      const page = pages[pageName];
      if (!page) {
        this.navigate("overview");
        return;
      }

      const role = user?.role || "assistant";
      const roleOk =
        this.hasCapability(user, page.requires) &&
        (!page.requiresRole || role === page.requiresRole) &&
        (!page.roles || page.roles.includes(role));
      if (!roleOk) {
        Toast.warning("Your role does not have access to this page");
        pageName = "overview";
      } else if (!isPageAvailable(page)) {
        Toast.info("Create or connect a session first");
        pageName = "sessions";
      }

      const finalPage = pages[pageName];

      currentPage = pageName;
      window.location.hash = pageName;

      // Update nav active state
      document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.page === pageName);
      });

      // Update title
      document.getElementById("page-title").textContent = finalPage.title;

      // Render page
      finalPage.render();
    },
  };

  // Init when DOM ready
  document.addEventListener("DOMContentLoaded", () => App.init());
})();
