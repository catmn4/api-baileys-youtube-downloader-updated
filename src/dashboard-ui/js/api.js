/** API Client — wraps fetch with auth token */
(() => {
  const BASE = "/dashboard/api";

  // Sessions live in an HttpOnly cookie. The token is kept in memory only for
  // backward compatibility (a proxy that strips cookies) and is never written to
  // localStorage, where XSS could read it.
  const LEGACY_TOKEN_KEY = "wa-dashboard-token";
  let memoryToken = null;
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): cookie auth still works.
  }

  window.API = {
    getToken() {
      return memoryToken;
    },
    setToken(token) {
      memoryToken = token || null;
    },
    clearToken() {
      memoryToken = null;
    },

    async request(path, options = {}) {
      const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      };
      if (memoryToken) headers.Authorization = `Bearer ${memoryToken}`;

      const res = await fetch(`${BASE}${path}`, {
        ...options,
        headers,
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({ success: false, message: "Network error" }));

      if (
        res.status === 401 &&
        path !== "/auth/login" &&
        path !== "/auth/register" &&
        path !== "/auth/status" &&
        path !== "/auth/me"
      ) {
        this.clearToken();
        window.App?.showAuth();
      }
      return data;
    },

    get(path) {
      return this.request(path);
    },
    post(path, body) {
      return this.request(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    put(path, body) {
      return this.request(path, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    patch(path, body) {
      return this.request(path, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    async getStreamToken() {
      const result = await this.get("/auth/stream-token");
      return result.success ? result.data?.token || null : null;
    },
    del(path) {
      return this.request(path, { method: "DELETE" });
    },
  };
})();
