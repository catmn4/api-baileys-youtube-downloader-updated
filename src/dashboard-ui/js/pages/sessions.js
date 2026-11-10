/** Sessions Page — list, create (QR/pairing), delete, reconnect */
(() => {
  let pollTimer = null;

  /** Escape dynamic values before they enter an HTML template. */
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem("wa-dashboard-user") || "{}");
    } catch {
      return {};
    }
  }

  function can(capability) {
    return Boolean(window.App?.hasCapability?.(currentUser(), capability));
  }

  window.SessionsPage = {
    async render() {
      const container = document.getElementById("page-content");
      UI.setHtml(
        container,
        `
        <div class="toolbar">
          ${can("createSessions") ? '<button class="btn btn-primary" id="btn-new-session">+ New Session</button>' : ""}
          <div class="toolbar-spacer"></div>
          <button class="btn btn-outline btn-sm" id="btn-refresh-sessions">↻ Refresh</button>
        </div>
        <div id="sessions-list"><div class="skeleton skeleton-card w-full u-h-200"></div></div>`,
      );

      document
        .getElementById("btn-new-session")
        ?.addEventListener("click", () => this.showNewSessionModal());
      document
        .getElementById("btn-refresh-sessions")
        .addEventListener("click", () => this.loadSessions());

      // Delegated row actions: no inline handlers, so CSP keeps script-src 'self'.
      document.getElementById("sessions-list").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;
        const sessionId = button.getAttribute("data-session-id");
        if (!sessionId) return;
        const action = button.getAttribute("data-action");
        if (action === "reconnect") this.reconnectSession(sessionId);
        else if (action === "settings") this.showSettingsModal(sessionId);
        else if (action === "delete") this.deleteSession(sessionId);
      });

      this.loadSessions();
    },

    async loadSessions() {
      const result = await API.get("/sessions");
      const el = document.getElementById("sessions-list");
      if (!result.success) {
        UI.setHtml(el, '<p class="text-muted">Failed to load sessions</p>');
        return;
      }

      const sessions = result.data || [];
      if (sessions.length === 0) {
        UI.setHtml(
          el,
          `<div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/></svg>
          <h3>No Sessions</h3><p class="text-muted">Create a new session to connect your WhatsApp account</p>
        </div>`,
        );
        return;
      }

      UI.setHtml(
        el,
        `<div class="table-wrapper"><table>
        <thead><tr><th>Session ID</th><th>Status</th><th>Phone</th><th>Actions</th></tr></thead>
        <tbody>${sessions
          .map(
            (s) => `
          <tr>
            <td><strong>${escapeHtml(s.sessionId || s.id || "—")}</strong></td>
            <td>${
              s.connected
                ? '<span class="badge badge-success"><span class="badge-dot pulse"></span>CONNECTED</span>'
                : '<span class="badge badge-danger"><span class="badge-dot"></span>DISCONNECTED</span>'
            }</td>
            <td class="text-muted">${escapeHtml(s.user?.id || s.phone || "—")}</td>
            <td class="flex gap-1">
              ${!s.connected && can("reconnectSessions") ? `<button class="btn btn-outline btn-sm" data-action="reconnect" data-session-id="${escapeHtml(s.sessionId || s.id)}">Reconnect</button>` : ""}
							<button class="btn btn-outline btn-sm" data-action="settings" data-session-id="${escapeHtml(s.sessionId || s.id)}">Settings</button>
              ${can("deleteSessions") ? `<button class="btn btn-danger btn-sm" data-action="delete" data-session-id="${escapeHtml(s.sessionId || s.id)}">Delete</button>` : ""}
            </td>
          </tr>`,
          )
          .join("")}
        </tbody></table></div>`,
      );
    },

    showNewSessionModal() {
      Modal.show(
        "New Session",
        `
        <form id="new-session-form">
          <div class="form-group">
            <label for="session-id">Session ID</label>
            <input type="text" id="session-id" placeholder="e.g. my-phone" required />
          </div>
          <div class="form-group">
            <label for="session-webhook">Webhook URL (Optional)</label>
            <input type="url" id="session-webhook" placeholder="https://your-server.com/webhook" />
          </div>
          <div class="form-group">
            <label class="checkbox-label"><input type="checkbox" id="session-pairing" /> Use Pairing Code (instead of QR)</label>
          </div>
					<div class="form-group">
						<label class="checkbox-label"><input type="checkbox" id="session-fresh-auth" checked /> Fresh Auth (clear old auth state before create)</label>
					</div>
          <div class="form-group hidden" id="pairing-phone-group">
            <label for="session-phone">Phone Number</label>
            <input type="text" id="session-phone" placeholder="+6281234567890" />
          </div>

					<div class="u-section-divider">
						<h4 class="u-fs-09-mb-1">Auto Reply Configuration</h4>
						<div class="form-group">
							<label class="checkbox-label"><input type="checkbox" id="session-autoreply-enabled" /> Enable Auto Reply for this session</label>
							<small class="text-muted u-block-mt-035">
								Static reply only. The AI responder is configured on the
								<a href="#ai">AI &amp; Routing</a> page and takes priority when enabled.
							</small>
						</div>
						<div id="autoreply-settings" class="hidden u-indent-block">
							<div class="form-group">
								<label for="session-autoreply-type">Trigger Mode</label>
								<select id="session-autoreply-type">
									<option value="always">Always Reply</option>
									<option value="time_range">Outside Working Hours</option>
									<option value="on_webhook_fail">On Webhook Failure</option>
								</select>
							</div>
							<div class="form-group">
								<label for="session-autoreply-role">Role when AI Routing is on</label>
								<select id="session-autoreply-role">
									<option value="both">Both — primary when AI is off / out of window, fallback when AI fails</option>
									<option value="primary">Primary only — static answers first</option>
									<option value="fallback">Fallback only — static answers only when AI fails</option>
								</select>
								<small class="text-muted u-block-mt-035">
									AI &amp; Routing overrides this whenever it is enabled and eligible.
								</small>
							</div>
							<div id="autoreply-time-group" class="u-time-range">
								<div class="u-flex-1">
									<label class="u-fs-08">Start Time</label>
									<input type="time" id="session-autoreply-start" value="18:00" />
								</div>
								<div class="u-flex-1">
									<label class="u-fs-08">End Time</label>
									<input type="time" id="session-autoreply-end" value="08:00" />
								</div>
							</div>
							<div class="form-group">
								<label for="session-autoreply-msg">Auto Reply Message</label>
								<textarea id="session-autoreply-msg" rows="3" placeholder="Hello, we&#39;re currently away.&#10;We&#39;ll reply to your message soon."></textarea>
							</div>
						</div>
					</div>

          <button type="submit" class="btn btn-primary btn-full">Create Session</button>
        </form>
      `,
      );

      const pairingToggle = document.getElementById("session-pairing");
      const autoReplyToggle = document.getElementById("session-autoreply-enabled");
      const autoReplyType = document.getElementById("session-autoreply-type");

      pairingToggle.addEventListener("change", (e) => {
        document
          .getElementById("pairing-phone-group")
          .classList.toggle("hidden", !e.target.checked);
      });

      autoReplyToggle.addEventListener("change", (e) => {
        document.getElementById("autoreply-settings").classList.toggle("hidden", !e.target.checked);
      });

      autoReplyType.addEventListener("change", (e) => {
        document
          .getElementById("autoreply-time-group")
          ?.classList.toggle("is-open", e.target.value === "time_range");
      });

      document.getElementById("new-session-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const sessionId = document.getElementById("session-id").value.trim();
        if (!sessionId) return Toast.warning("Session ID is required");

        const body = {
          webhookUrl: document.getElementById("session-webhook").value.trim(),
          usePairingCode: pairingToggle.checked,
          freshAuth: document.getElementById("session-fresh-auth").checked,
          phoneNumber: document.getElementById("session-phone").value.trim(),
        };

        if (autoReplyToggle.checked) {
          body.autoReply = {
            enabled: true,
            type: autoReplyType.value,
            role: document.getElementById("session-autoreply-role").value,
            message: document.getElementById("session-autoreply-msg").value.trim(),
            timeStart: document.getElementById("session-autoreply-start").value,
            timeEnd: document.getElementById("session-autoreply-end").value,
          };
        }

        const result = await API.post(`/sessions/${sessionId}`, body);
        if (result.success) {
          Toast.success("Session created");
          // Session-dependent menus appear as soon as a session exists.
          window.App?.refreshAvailability?.();
          if (result.data?.pairingCode) this.showPairingCode(result.data.pairingCode);
          else
            this.showQR(sessionId, {
              freshAuth: body.freshAuth,
            });
        } else {
          Toast.error(result.message || "Failed to create session");
        }
      });
    },

    async reconnectSession(sessionId) {
      const result = await API.post(`/sessions/${sessionId}/reconnect`, {});
      if (!result.success) {
        Toast.error(result.message || "Failed to reconnect session");
        return;
      }
      await window.App?.refreshAvailability?.();
      if (result.data?.pairingCode) {
        this.showPairingCode(result.data.pairingCode);
        return;
      }
      this.showQR(sessionId);
    },

    async showQR(sessionId, options = {}) {
      const freshAuthBadge = options.freshAuth
        ? '<div class="badge badge-info qr-fresh-auth-badge">FRESH AUTH ENABLED</div>'
        : "";
      Modal.show(
        `QR Code — ${escapeHtml(sessionId)}`,
        `
        <div class="qr-container">
          ${freshAuthBadge}
          <p class="qr-subtitle">QR Login Mode</p>
          <div class="badge badge-warning qr-status-chip" id="qr-status-chip">WAITING</div>
          <div id="qr-container-body">
            <div class="skeleton u-qr-box"></div>
            <p>Waiting for QR code...</p>
          </div>
        </div>
      `,
      );
      this.pollQR(sessionId);
    },

    async pollQR(sessionId) {
      if (pollTimer) clearInterval(pollTimer);
      let missingQrCount = 0;

      const setQrStatus = (label, tone) => {
        const chip = document.getElementById("qr-status-chip");
        if (!chip) return;
        chip.className = `badge qr-status-chip ${tone}`;
        chip.textContent = label;
      };

      const update = async () => {
        const result = await API.get(`/sessions/${sessionId}`);
        if (!result.success) return;
        const status = result.data;
        const el = document.getElementById("qr-container-body");
        if (!el) {
          clearInterval(pollTimer);
          return;
        }

        if (status.connected) {
          clearInterval(pollTimer);
          setQrStatus("CONNECTED", "badge-success");
          UI.setHtml(
            el,
            `<div class="u-fs-3rem">✓</div><p class="u-success-bold">Connected successfully!</p>`,
          );
          Toast.success(`Session ${sessionId} connected!`);
          setTimeout(() => {
            Modal.hide();
            this.loadSessions();
          }, 1500);
          return;
        }
        if (status.qrCode) {
          missingQrCount = 0;
          setQrStatus("READY TO SCAN", "badge-info");
          // Build the image through the DOM: assigning src as a property cannot
          // break out of the attribute, unlike interpolating it into HTML.
          const img = document.createElement("img");
          img.src = status.qrCode;
          img.alt = "QR Code";
          const hint = document.createElement("p");
          hint.textContent = "Scan this QR code with WhatsApp";
          el.replaceChildren(img, hint);
          return;
        }

        missingQrCount += 1;
        if (missingQrCount >= 5 || status.exists === false) {
          setQrStatus("EXPIRED", "badge-danger");
          UI.setHtml(
            el,
            `<div class="u-fs-2rem-mb-075">!</div><p>QR code is no longer available. Recreate the session to start a new login.</p>`,
          );
          clearInterval(pollTimer);
          return;
        }

        setQrStatus("WAITING", "badge-warning");
      };
      await update();
      pollTimer = setInterval(update, 3000);
    },

    showPairingCode(code) {
      Modal.show(
        "Pairing Code",
        `
        <div class="qr-container">
          <p class="qr-subtitle">Pairing Code Login Mode</p>
          <div class="badge badge-info qr-status-chip">READY</div>
          <p class="pairing-code">${code}</p>
          <p>Enter this code in WhatsApp &gt; Linked Devices &gt; Link a Device</p>
        </div>
      `,
      );
    },

    async deleteSession(sessionId) {
      const confirmed = await Modal.confirm(
        "Delete Session",
        `<p class="u-mb-15-center">Are you sure you want to delete session <strong>"${escapeHtml(sessionId)}"</strong>?<br><span class="u-danger-text">* This action cannot be undone.</span></p>`,
        {
          confirmText: "Delete",
          cancelText: "Cancel",
          variant: "danger",
        },
      );
      if (!confirmed) return;
      const result = await API.del(`/sessions/${sessionId}`);
      if (result.success) {
        Toast.success("Session deleted");
        window.App?.refreshAvailability?.();
        this.loadSessions();
      } else {
        Toast.error(result.message || "Failed to delete");
      }
    },

    async showSettingsModal(sessionId) {
      const result = await API.get("/sessions");
      const session = result.data?.find((s) => (s.sessionId || s.id) === sessionId);
      if (!session) return Toast.error("Session data not found");

      const ar = session.autoReply || {};
      const secretHint = session.hasWebhookSecret
        ? `Configured (••••${session.webhookSecretLast4 || ""}) — leave blank to keep`
        : "Optional secret key";

      Modal.show(
        `Update Settings — ${escapeHtml(sessionId)}`,
        `
        <form id="update-session-form">
          <div class="form-group">
            <label for="update-webhook">Webhook URL</label>
            <input type="url" id="update-webhook" placeholder="https://your-server.com/webhook" value="${escapeHtml(session.webhookUrl || "")}" />
          </div>
					<div class="form-group">
						<label for="update-secret">Webhook Secret Header</label>
						<div class="input-password-wrapper">
							<input type="password" id="update-secret" placeholder="${escapeHtml(secretHint)}" value="" autocomplete="off" />
							${window.passwordToggleHtml("update-secret")}
						</div>
					</div>

					<div class="u-section-divider">
						<h4 class="u-fs-09-mb-1">Auto Reply Configuration</h4>
						<div class="form-group">
							<label class="checkbox-label"><input type="checkbox" id="update-autoreply-enabled" ${ar.enabled ? "checked" : ""} /> Enable Auto Reply</label>
							<small class="text-muted u-block-mt-035">
								Static fallback. The AI responder takes priority when enabled on the
								<a href="#ai">AI &amp; Routing</a> page.
							</small>
						</div>
						<div id="update-autoreply-settings" class="${ar.enabled ? "" : "hidden"} u-indent-block">
							<div class="form-group">
								<label for="update-autoreply-type">Trigger Mode</label>
								<select id="update-autoreply-type">
									<option value="always" ${ar.type === "always" ? "selected" : ""}>Always Reply</option>
									<option value="time_range" ${ar.type === "time_range" ? "selected" : ""}>Outside Working Hours</option>
									<option value="on_webhook_fail" ${ar.type === "on_webhook_fail" ? "selected" : ""}>On Webhook Failure</option>
								</select>
							</div>
							<div class="form-group">
								<label for="update-autoreply-role">Role when AI Routing is on</label>
								<select id="update-autoreply-role">
									<option value="both" ${(ar.role || "both") === "both" ? "selected" : ""}>Both — primary when AI is off / out of window, fallback when AI fails</option>
									<option value="primary" ${ar.role === "primary" ? "selected" : ""}>Primary only — static answers first</option>
									<option value="fallback" ${ar.role === "fallback" ? "selected" : ""}>Fallback only — static answers only when AI fails</option>
								</select>
								<small class="text-muted u-block-mt-035">
									AI &amp; Routing overrides this whenever it is enabled and eligible.
								</small>
							</div>
							<div id="update-autoreply-time-group" class="u-time-range ${ar.type === "time_range" ? "is-open" : ""}">
								<div class="u-flex-1">
									<label class="u-fs-08">Start Time</label>
									<input type="time" id="update-autoreply-start" value="${escapeHtml(ar.timeStart || "18:00")}" />
								</div>
								<div class="u-flex-1">
									<label class="u-fs-08">End Time</label>
									<input type="time" id="update-autoreply-end" value="${escapeHtml(ar.timeEnd || "08:00")}" />
								</div>
							</div>
							<div class="form-group">
								<label for="update-autoreply-msg">Auto Reply Message</label>
								<textarea id="update-autoreply-msg" rows="3" placeholder="Hello, we&#39;re currently away.&#10;We&#39;ll reply to your message soon.">${ar.message || ""}</textarea>
							</div>
						</div>
					</div>

          <button type="submit" class="btn btn-primary btn-full">Save Settings</button>
        </form>
      `,
      );

      window.initPasswordToggles?.(document.getElementById("modal-body"));
      const autoReplyToggle = document.getElementById("update-autoreply-enabled");
      const autoReplyType = document.getElementById("update-autoreply-type");

      autoReplyToggle.addEventListener("change", (e) => {
        document
          .getElementById("update-autoreply-settings")
          .classList.toggle("hidden", !e.target.checked);
      });

      autoReplyType.addEventListener("change", (e) => {
        document
          .getElementById("update-autoreply-time-group")
          ?.classList.toggle("is-open", e.target.value === "time_range");
      });

      document.getElementById("update-session-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = {
          webhookUrl: document.getElementById("update-webhook").value.trim(),
          webhookSecret: document.getElementById("update-secret").value.trim(),
        };

        if (autoReplyToggle.checked) {
          body.autoReply = {
            enabled: true,
            type: autoReplyType.value,
            role: document.getElementById("update-autoreply-role").value,
            message: document.getElementById("update-autoreply-msg").value.trim(),
            timeStart: document.getElementById("update-autoreply-start").value,
            timeEnd: document.getElementById("update-autoreply-end").value,
          };
        } else {
          body.autoReply = {
            enabled: false,
            message: "",
            type: "always",
            role: document.getElementById("update-autoreply-role").value,
          };
        }

        const result = await API.patch(`/sessions/${sessionId}/settings`, body);
        if (result.success) {
          Toast.success("Settings updated successfully");
          Modal.hide();
          this.loadSessions();
        } else {
          Toast.error(result.message || "Failed to update settings");
        }
      });
    },

    destroy() {
      if (pollTimer) clearInterval(pollTimer);
    },
  };
})();
