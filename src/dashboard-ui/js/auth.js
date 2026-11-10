/** Auth UI — login/register with auto-detect setup mode */
(() => {
  let isRegister = false;
  let registrationEnabled = false;

  window.AuthUI = {
    async init() {
      const form = document.getElementById("auth-form");
      const toggleText = document.getElementById("auth-toggle-text");
      const subtitle = document.getElementById("auth-subtitle");
      const submitBtn = document.getElementById("auth-submit");

      // Check auth status
      const status = await API.request("/auth/status", { method: "GET" });
      if (status.success) {
        registrationEnabled = status.data.registrationEnabled;
        if (typeof status.data.passwordMinLength === "number") {
          window.__dashboardMinPasswordLength = status.data.passwordMinLength;
        }
        if (status.data.registrationEnabled && status.data.registrationRequireApproval) {
          Toast.info("Registration requires admin approval before first login");
        }
        if (!status.data.hasUsers) {
          isRegister = true;
          subtitle.textContent = "Create your admin account to get started";
          submitBtn.querySelector("span").textContent = "Create Admin Account";
        }
      }

      this.updateToggle(toggleText, subtitle, submitBtn);

      toggleText.addEventListener("click", () => {
        if (!registrationEnabled && !isRegister) return;
        isRegister = !isRegister;
        this.updateToggle(toggleText, subtitle, submitBtn);
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("auth-username").value.trim();
        const password = document.getElementById("auth-password").value;

        if (!username || !password) return Toast.warning("Please fill in all fields");

        submitBtn.disabled = true;
        submitBtn.querySelector("span").textContent = "Please wait...";

        const endpoint = isRegister ? "/auth/register" : "/auth/login";
        const result = await API.request(endpoint, {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });

        if (result.success) {
          if (!result.data?.token) {
            Toast.info(result.message || "Registration submitted. Please wait for admin approval.");
            isRegister = false;
            this.updateToggle(toggleText, subtitle, submitBtn);
            submitBtn.disabled = false;
            return;
          }

          API.setToken(result.data.token);
          localStorage.setItem("wa-dashboard-user", JSON.stringify(result.data.user));
          Toast.success(isRegister ? "Account created!" : "Welcome back!");
          window.App.showDashboard(result.data.user);
        } else {
          Toast.error(result.message || "Authentication failed");
        }

        submitBtn.disabled = false;
        this.updateToggle(null, null, submitBtn);
      });
    },

    updateToggle(toggleText, subtitle, submitBtn) {
      if (submitBtn) {
        submitBtn.querySelector("span").textContent = isRegister ? "Create Account" : "Sign In";
      }
      if (toggleText) {
        if (registrationEnabled) {
          toggleText.textContent = isRegister ? "← Back to Sign In" : "Create an account →";
        } else {
          toggleText.textContent = "";
        }
      }
      if (subtitle) {
        subtitle.textContent = isRegister ? "Create your account" : "Sign in to your dashboard";
      }
    },
  };

  const EYE_OPEN =
    '<svg aria-hidden="true" class="eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_CLOSED =
    '<svg aria-hidden="true" class="eye-closed is-hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  /** Reusable eye button for dynamically rendered password fields. */
  window.passwordToggleHtml = (target) =>
    `<button type="button" class="password-toggle" data-target="${target}" title="Show password">${EYE_OPEN}${EYE_CLOSED}</button>`;

  /** Global password toggle — works on any .password-toggle with data-target */
  window.initPasswordToggles = (container) => {
    const root = container || document;
    root.querySelectorAll(".password-toggle").forEach((btn) => {
      if (btn._toggleBound) return;
      btn._toggleBound = true;
      btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        btn.querySelector(".eye-open")?.classList.toggle("is-hidden", isPassword);
        btn.querySelector(".eye-closed")?.classList.toggle("is-hidden", !isPassword);
        btn.title = isPassword ? "Hide password" : "Show password";
      });
    });
  };

  // Auto-init toggles when auth screen loads
  document.addEventListener("DOMContentLoaded", () => initPasswordToggles());
})();
