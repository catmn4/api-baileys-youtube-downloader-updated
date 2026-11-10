/** Settings Page — account info, health check modal, OpenAPI viewer, about */
(() => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  /** Current dashboard user id, tolerant of corrupted local storage. */
  function currentUserId() {
    try {
      return JSON.parse(localStorage.getItem("wa-dashboard-user") || "{}").id;
    } catch {
      return undefined;
    }
  }

  window.SettingsPage = {
    formatAssignedSessionsSummary(assignedSessions) {
      if (!assignedSessions || assignedSessions.length === 0) {
        return "All sessions";
      }

      if (assignedSessions.length === 1) {
        return assignedSessions[0];
      }

      if (assignedSessions.length === 2) {
        return assignedSessions.join(", ");
      }

      return `${assignedSessions.length} sessions selected`;
    },

    async render() {
      let user = {};
      try {
        user = JSON.parse(localStorage.getItem("wa-dashboard-user") || "{}");
      } catch {
        user = {};
      }
      const role = user.role || "assistant";
      const roleSummary =
        {
          admin:
            "Full system control, user approval, session/webhook management, outbound messaging, and monitoring.",
          manager:
            "Handles assigned sessions: reconnect, session settings, webhooks, AI routing and REST API keys. Cannot create or delete sessions, or manage users.",
          assistant:
            "Chat and group support in assigned sessions. Settings is limited to your account/password and About; no role or system controls.",
        }[role] || "Limited operational access.";

      const perm = (kind, tip = "") => {
        const label = { allow: "✅ Allowed", limited: "⚠️ Limited", deny: "❌ Restricted" }[kind];
        const className = `perm-badge perm-${kind}`;
        if (kind !== "limited" || !tip) return `<span class="${className}">${label}</span>`;
        const safeTip = escapeHtml(tip);
        return `<span class="${className}" tabindex="0" data-tip="${safeTip}" title="${safeTip}">${label}</span>`;
      };

      const capabilityRows = [
        [
          "Sessions",
          perm("allow"),
          perm(
            "limited",
            "Assigned sessions only (or All Sessions when granted). Reconnect and edit settings; create/delete stay admin-only.",
          ),
          perm("deny"),
        ],
        ["Chat Rooms", perm("allow"), perm("allow"), perm("allow")],
        [
          "Groups",
          perm("allow"),
          perm("allow"),
          perm(
            "limited",
            "Assigned groups are visible; create, clear and exit/delete remain manager/admin actions.",
          ),
        ],
        [
          "Messaging",
          perm("allow"),
          perm("allow"),
          perm("limited", "Single messages allowed; Bulk Send is hidden for assistants."),
        ],
        ["AI & Routing", perm("allow"), perm("allow"), perm("deny")],
        ["Webhooks", perm("allow"), perm("allow"), perm("deny")],
        ["REST API", perm("allow"), perm("allow"), perm("deny")],
        ["Events", perm("allow"), perm("allow"), perm("deny")],
        [
          "Settings",
          perm("allow"),
          perm("allow"),
          perm(
            "limited",
            "Account password and About only; role permissions and quick actions are hidden.",
          ),
        ],
        ["User Management", perm("allow"), perm("deny"), perm("deny")],
      ];

      UI.setHtml(
        document.getElementById("page-content"),
        `
        <div class="card mb-2">
          <div class="card-header">
            <h3>Account</h3>
          </div>
          <table class="u-mb-1">
            <tr><td class="text-muted u-w-100">Username</td><td><strong>${escapeHtml(user.username || "—")}</strong></td></tr>
			<tr><td class="text-muted">Role</td><td><span class="badge ${user.role === "admin" ? "badge-success" : "badge-info"}">${escapeHtml((user.role || "assistant").toUpperCase())}</span></td></tr>
          </table>
          <button class="btn btn-outline btn-sm" id="btn-show-password-modal">
            <svg class="u-mr-4px" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Change Password
          </button>
        </div>

		<div class="card mb-2 ${role === "assistant" ? "hidden" : ""}">
		  <div class="card-header ui-between">
			<h3>Role Permissions</h3>
			${user.role === "admin" ? `<button class="btn btn-outline btn-sm" id="btn-show-users-modal"><span class="u-mr-035">👥</span>Users, Approvals & Roles</button>` : ""}
		  </div>
		  <div class="u-p-0-1-1">
			<p class="text-sm u-mb-075"><strong>Your role:</strong> <span class="badge ${role === "admin" ? "badge-success" : role === "manager" ? "badge-info" : "badge-warning"}">${role.toUpperCase()}</span></p>
			<p class="text-muted text-sm u-mb-08">${roleSummary}</p>
			<details class="ui-border-card">
				<summary class="ui-accordion">
					<span>Show Full Permission Matrix</span>
					<span class="text-muted text-xs">Expand</span>
				</summary>
				<div class="table-wrapper permission-matrix u-p-0-075-075">
				  <table>
					<thead><tr><th>Capability</th><th>Admin</th><th>Manager</th><th>Assistant</th></tr></thead>
					<tbody>
					${capabilityRows
            .map(
              ([module, admin, manager, assistant]) =>
                `<tr><td>${module}</td><td>${admin}</td><td>${manager}</td><td>${assistant}</td></tr>`,
            )
            .join("")}
					</tbody>
				  </table>
				</div>
			</details>
		  </div>
		</div>

        <div class="card mb-2 ${role === "assistant" ? "hidden" : ""}">
          <div class="card-header"><h3>Quick Actions</h3></div>
          <div class="flex gap-2 u-flex-wrap">
            <a href="/docs" target="_blank" class="btn btn-outline">📖 Swagger Docs</a>
						${user.role === "admin" ? `<button class="btn btn-outline" id="btn-health-check">💚 Health Check</button>` : ""}
            <button class="btn btn-outline" id="btn-openapi">📋 OpenAPI Spec</button>
          </div>
        </div>

        <div class="card mb-2" id="simulation-card">
          <div class="card-header"><h3>🤖 WA Web Behavior Simulation</h3></div>
          <div class="u-p-1"><div class="skeleton skeleton-text u-skeleton-200"></div><div class="skeleton skeleton-text u-skeleton-150"></div></div>
        </div>

        <div class="card" id="about-card">
          <div class="card-header"><h3>About</h3></div>
          <div class="u-p-1s"><div class="skeleton skeleton-text u-skeleton-200"></div><div class="skeleton skeleton-text u-skeleton-150"></div></div>
        </div>`,
      );

      const healthBtn = document.getElementById("btn-health-check");
      if (healthBtn) {
        healthBtn.addEventListener("click", () => this.showHealthCheck());
      }
      document.getElementById("btn-openapi").addEventListener("click", () => this.showOpenAPI());

      // Password logic
      document
        .getElementById("btn-show-password-modal")
        .addEventListener("click", () => this.showChangePasswordModal());

      // Simulation is a global admin-only read; avoid an error card for managers.
      if (user.role === "admin") this.loadSimulationConfig();
      else document.getElementById("simulation-card")?.remove();

      if (user.role === "admin") {
        const btnUsers = document.getElementById("btn-show-users-modal");
        if (btnUsers) btnUsers.addEventListener("click", () => this.showUsersModal());
      }

      try {
        const res = await fetch("/dashboard/api/about", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("wa-dashboard-token")}`,
          },
        });
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        const data = json.data;
        const aboutCard = document.getElementById("about-card");
        if (aboutCard) {
          const restricted = Boolean(data.infoRestricted);
          UI.setHtml(
            aboutCard,
            `
					  <div class="card-header"><h3>About</h3></div>
					  <table>
						<tr><td class="text-muted u-w-100">Project</td><td><strong>${data.project}</strong></td></tr>
						<tr><td class="text-muted">Version</td><td>${data.version}</td></tr>
						${restricted ? `<tr><td class="text-muted">System Details</td><td><span class="badge badge-warning">ADMIN ONLY</span></td></tr>` : `<tr><td class="text-muted">Engine</td><td><strong>${data.engine}</strong></td></tr>`}
						${restricted ? "" : `<tr><td class="text-muted">Runtime</td><td>${data.runtime}</td></tr>`}
					  </table>
					`,
          );
        }
      } catch (_err) {
        const aboutCard = document.getElementById("about-card");
        if (aboutCard) {
          UI.setHtml(
            aboutCard,
            `
					  <div class="card-header"><h3>About</h3></div>
					  <table>
						<tr><td class="text-muted u-w-100">Project</td><td><strong>Baileys WA API</strong></td></tr>
						<tr><td class="text-muted">Version</td><td>v1.0.0</td></tr>
						<tr><td class="text-muted">Engine</td><td>Baileys 7.0.0-rc.9</td></tr>
						<tr><td class="text-muted">Runtime</td><td>Bun + Hono</td></tr>
					  </table>
					`,
          );
        }
      }
    },

    /** Health Check — fetches /status and renders visual cards */
    async showHealthCheck() {
      Modal.show(
        "Health Check",
        '<div class="u-text-center-p-2"><div class="skeleton skeleton-card w-full u-h-120"></div></div>',
      );

      try {
        const res = await fetch("/status");
        const json = await res.json();
        const d = json.data || json;

        const uptimeH = Math.floor((d.uptime || 0) / 3600);
        const uptimeM = Math.floor(((d.uptime || 0) % 3600) / 60);
        const uptimeS = Math.floor((d.uptime || 0) % 60);
        const uptimeStr =
          uptimeH > 0 ? `${uptimeH}h ${uptimeM}m ${uptimeS}s` : `${uptimeM}m ${uptimeS}s`;

        const statusColor = json.success !== false ? "var(--success)" : "var(--danger)";
        const statusIcon = json.success !== false ? "✓" : "✕";
        const statusText = json.success !== false ? "Healthy" : "Unhealthy";
        const projectName = d.name || "Baileys WA API";
        const projectVersion = d.version || "v1.0.0";

        UI.setHtml(
          document.getElementById("modal-body"),
          `
          <div class="u-text-center-mb-125">
            <div class="u-status-icon" data-status-color="${statusColor}">${statusIcon}</div>
            <h3 class="u-status-text" data-status-color="${statusColor}">${statusText}</h3>
						<p class="text-muted text-sm">${projectName} ${projectVersion}</p>
          </div>

					<div class="stats-grid u-grid-2">
						<div class="stat-card u-p-085">
              <div class="stat-icon green u-w-36">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div class="stat-info"><h4>Uptime</h4><div class="stat-value u-text-11">${uptimeStr}</div></div>
            </div>
						<div class="stat-card u-p-085">
							<div class="stat-icon blue u-w-36">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/></svg>
							</div>
							<div class="stat-info">
								<h4>Sessions</h4>
								<div class="stat-value u-text-098">
									<div><strong>${d.activeSessions ?? 0}</strong> active</div>
									<div><strong>${d.connectedSessions ?? 0}</strong> connected</div>
								</div>
							</div>
						</div>
          </div>

          <table class="u-mt-075">
			<tr><td class="text-muted u-w-140">Project</td><td><strong>${projectName}</strong></td></tr>
			<tr><td class="text-muted">Version</td><td>${projectVersion}</td></tr>
            <tr><td class="text-muted u-w-140">Environment</td><td><span class="badge badge-info">${(d.environment || "unknown").toUpperCase()}</span></td></tr>
            <tr><td class="text-muted">Redis</td><td><span class="badge ${d.redis === "connected" ? "badge-success" : "badge-warning"}">${(d.redis || "disabled").toUpperCase()}</span></td></tr>
            <tr><td class="text-muted">Description</td><td class="text-sm">${d.description || "—"}</td></tr>
          </table>
        `,
        );

        // Dynamic colours are applied through CSSOM (allowed by CSP) instead of
        // inline style attributes.
        document.querySelectorAll("#modal-body [data-status-color]").forEach((el) => {
          el.style.setProperty("--status-color", el.getAttribute("data-status-color") || "");
        });
      } catch (err) {
        UI.setHtml(
          document.getElementById("modal-body"),
          `
          <div class="u-text-center-p-15">
            <div class="u-text-2rem">⚠️</div>
            <p class="text-danger">Failed to reach health endpoint</p>
            <p class="text-muted text-sm">${err.message}</p>
          </div>`,
        );
      }
    },

    /** OpenAPI Spec — fetches /openapi.json and renders formatted tree view */
    async showOpenAPI() {
      Modal.show(
        "OpenAPI Specification",
        '<div class="u-text-center-p-2"><div class="skeleton skeleton-card w-full u-h-120"></div></div>',
      );

      try {
        const res = await fetch("/openapi.json");
        const spec = await res.json();

        const paths = Object.keys(spec.paths || {});
        const methods = {
          get: "badge-info",
          post: "badge-success",
          put: "badge-warning",
          delete: "badge-danger",
          patch: "badge-warning",
        };

        // Group paths by tag or first segment
        const grouped = {};
        for (const path of paths) {
          const ops = spec.paths[path];
          for (const [method, detail] of Object.entries(ops)) {
            if (!methods[method]) continue;
            const tag = detail.tags?.[0] || path.split("/")[1] || "other";
            if (!grouped[tag]) grouped[tag] = [];
            grouped[tag].push({
              method: method.toUpperCase(),
              path,
              summary: detail.summary || detail.operationId || "",
            });
          }
        }

        let html = `
          <div class="u-mb-1b">
            <h4 class="u-m-0">${spec.info?.title || "API"}</h4>
            <p class="text-muted text-sm">${spec.info?.description || ""} — v${spec.info?.version || "1.0.0"}</p>
          </div>
          <p class="text-sm text-muted mb-1">${paths.length} endpoints found</p>
        `;

        for (const [tag, endpoints] of Object.entries(grouped)) {
          html += `<div class="mb-1"><strong class="u-capitalize-sm">${tag.replace(/[_-]/g, " ")}</strong></div>`;
          html += `<div class="table-wrapper mb-2"><table>`;
          for (const ep of endpoints) {
            const color = methods[ep.method.toLowerCase()] || "badge-info";
            html += `<tr>
              <td class="u-w-70"><span class="badge ${color}">${ep.method}</span></td>
              <td class="font-mono text-xs">${ep.path}</td>
              <td class="text-muted text-sm">${ep.summary}</td>
            </tr>`;
          }
          html += `</table></div>`;
        }

        html += `<div class="flex gap-1 mt-2">
          <a href="/docs" target="_blank" class="btn btn-primary btn-sm">Open Swagger UI</a>
          <a href="/openapi.json" target="_blank" class="btn btn-outline btn-sm">Download JSON</a>
        </div>`;

        UI.setHtml(document.getElementById("modal-body"), html);

        // Allow the modal to be wider for the spec
        document.getElementById("modal").style.maxWidth = "700px";
      } catch (err) {
        UI.setHtml(
          document.getElementById("modal-body"),
          `
          <div class="u-text-center-p-15">
            <div class="u-text-2rem">⚠️</div>
            <p class="text-danger">Failed to load OpenAPI spec</p>
            <p class="text-muted text-sm">${err.message}</p>
          </div>`,
        );
      }
    },

    async loadSimulationConfig() {
      const card = document.getElementById("simulation-card");
      if (!card) return;

      try {
        const result = await window.API.get("/config/simulation");
        if (!result.success) throw new Error(result.message);

        const d = result.data;
        const badge = (val) =>
          val
            ? '<span class="badge badge-success">ON</span>'
            : '<span class="badge badge-warning">OFF</span>';

        UI.setHtml(
          card,
          `
				  <div class="card-header"><h3>🤖 WA Web Behavior Simulation</h3></div>
				  <table>
					<tr><td class="text-muted u-w-200">Auto-Typing Before Send</td><td>${badge(d.typingBeforeSend)}</td></tr>
					<tr><td class="text-muted">Typing Delay</td><td><strong>${d.typingDelayMinMs}ms</strong> – <strong>${d.typingDelayMaxMs}ms</strong> <span class="text-muted text-sm">(randomized)</span></td></tr>
					<tr><td class="text-muted">Auto-Read Messages</td><td>${badge(d.autoReadMessages)}</td></tr>
					<tr><td class="text-muted">Auto-Mark Online</td><td>${badge(d.autoMarkOnline)}</td></tr>
					<tr><td class="text-muted">Auto-Reject Calls</td><td>${badge(d.rejectCalls)}</td></tr>
				  </table>
				  <p class="text-muted text-sm u-p-075-1"><span class="u-text-warning-bold">*</span> Settings are configured via <code>.env</code> file. Restart the server after changes.</p>
				`,
        );
      } catch (err) {
        UI.setHtml(
          card,
          `
				  <div class="card-header"><h3>🤖 WA Web Behavior Simulation</h3></div>
				  <div class="u-p-15-center">
					<p class="text-danger u-mb-05">Unable to load simulation config</p>
					<p class="text-muted text-sm">${err.message}</p>
				  </div>
				`,
        );
      }
    },

    showChangePasswordModal() {
      const minLen = Number(window.__dashboardMinPasswordLength || 6);
      Modal.show(
        "Change Password",
        `
                <form id="modal-form-change-password">
                    <p class="text-muted text-sm mb-2">Update your account password. Must be at least ${minLen} characters.</p>
                    <div class="form-group">
                        <label for="current-password">Current Password</label>
                        <div class="input-password-wrapper">
                            <input type="password" id="current-password" required autocomplete="current-password">
                            <button type="button" class="password-toggle" data-target="current-password" title="Show password">
                            <svg class="eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            <svg class="eye-closed is-hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            </button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="new-password">New Password</label>
                        <div class="input-password-wrapper">
							<input type="password" id="new-password" required minlength="${minLen}" autocomplete="new-password">
                            <button type="button" class="password-toggle" data-target="new-password" title="Show password">
                            <svg class="eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            <svg class="eye-closed is-hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            </button>
                        </div>
                    </div>
                    <div class="flex gap-1 u-mt-15">
                        <button type="submit" class="btn btn-primary" id="btn-submit-change">Update Password</button>
                        <button type="button" class="btn btn-outline" id="btn-cancel-password">Cancel</button>
                    </div>
                </form>
            `,
      );

      if (window.initPasswordToggles)
        window.initPasswordToggles(document.getElementById("modal-body"));

      document.getElementById("modal-form-change-password").addEventListener("submit", (e) => {
        e.preventDefault();
        this.changePassword();
      });

      // No inline handler: CSP keeps script-src 'self'.
      document.getElementById("btn-cancel-password")?.addEventListener("click", () => Modal.hide());
    },

    async changePassword() {
      const currentPassword = document.getElementById("current-password").value;
      const newPassword = document.getElementById("new-password").value;
      const btn = document.getElementById("btn-submit-change");

      if (!currentPassword || !newPassword) return Toast.error("Missing fields");

      btn.disabled = true;
      btn.textContent = "Updating...";

      const res = await window.API.put("/auth/password", {
        currentPassword,
        newPassword,
      });

      btn.disabled = false;
      btn.textContent = "Update Password";

      if (res.success) {
        Toast.success("Password updated successfully");
        Modal.hide();
      } else {
        Toast.error(res.message);
      }
    },

    showUsersModal() {
      Modal.show(
        "Users, Approvals & Roles",
        `
                <p class="text-muted text-sm mb-2">Manage dashboard users, approve pending registrations, assign roles, and scope session access.</p>
                <div class="card u-mb-1">
                    <h4 class="u-mt-0">Add User</h4>
                    <div class="u-grid-3-gap">
                        <div class="form-group u-mb-0">
                            <label for="new-user-username">Username</label>
                            <input id="new-user-username" class="input" autocomplete="off" placeholder="e.g. manager_ops">
                        </div>
                        <div class="form-group u-mb-0">
                            <label for="new-user-password">Password</label>
                            <div class="input-password-wrapper">
                                <input id="new-user-password" type="password" class="input" autocomplete="new-password" placeholder="Temporary Password">
                                ${window.passwordToggleHtml("new-user-password")}
                            </div>
                        </div>
                        <div class="form-group u-mb-0">
                            <label for="new-user-role">Role</label>
                            <select id="new-user-role" class="input">
                                <option value="assistant">ASSISTANT</option>
                                <option value="manager">MANAGER</option>
                                <option value="admin">ADMIN</option>
                            </select>
                        </div>
                    </div>
                    <div class="u-mt-075-between">
                        <span class="text-muted text-xs">Non-admin users are limited per role; admin accounts are unlimited.</span>
                        <button class="btn btn-primary btn-sm" id="btn-create-user">Add User</button>
                    </div>
                </div>
                <div class="table-wrapper">
                    <table id="modal-users-table">
                        <tr><td class="u-text-center"><span class="loader u-spinner-20"></span></td></tr>
                    </table>
                </div>
            `,
      );

      // Allow wider modal for table
      document.getElementById("modal").style.maxWidth = "700px";
      window.initPasswordToggles?.(document.getElementById("modal-body"));

      document.getElementById("btn-create-user").addEventListener("click", async () => {
        const username = document.getElementById("new-user-username").value.trim();
        const password = document.getElementById("new-user-password").value;
        const role = document.getElementById("new-user-role").value;
        const button = document.getElementById("btn-create-user");

        button.disabled = true;
        button.textContent = "Creating...";
        const res = await window.API.post("/auth/users", { username, password, role });
        button.disabled = false;
        button.textContent = "Add User";

        if (res.success) {
          Toast.success(`User @${username} created`);
          document.getElementById("new-user-username").value = "";
          document.getElementById("new-user-password").value = "";
          this.loadUsers();
        } else {
          Toast.error(res.message);
        }
      });

      this.loadUsers();
    },

    async loadUsers() {
      const table = document.getElementById("modal-users-table");
      if (!table) return;

      const [usersRes, sessionsRes] = await Promise.all([
        window.API.get("/auth/users"),
        window.API.get("/sessions"),
      ]);

      if (!usersRes.success) {
        UI.setHtml(
          table,
          `<tr><td class="text-danger text-center">Failed to load users: ${escapeHtml(usersRes.message)}</td></tr>`,
        );
        return;
      }

      const sessions = (sessionsRes.success ? sessionsRes.data : [])
        .filter((session) => session.sessionId)
        .sort((left, right) => String(left.sessionId).localeCompare(String(right.sessionId)));

      let html = `
                <tr>
                    <th>Username</th>
					<th>Status</th>
                    <th>Role</th>
					<th>Assigned Sessions</th>
                    <th>Joined</th>
                    <th class="u-w-100-right">Actions</th>
                </tr>
            `;

      usersRes.data.forEach((u) => {
        const isCurrentUser = currentUserId() === u.id;
        const date = new Date(u.createdAt).toLocaleDateString();
        const assignedSessions = Array.isArray(u.assignedSessions) ? u.assignedSessions : [];
        const assignedSummary = this.formatAssignedSessionsSummary(assignedSessions);
        const sessionSelector = sessions.length
          ? sessions
              .map((session) => {
                const sessionId = String(session.sessionId);
                const checked = assignedSessions.includes(sessionId) ? "checked" : "";
                const user = session.user || {};
                const phone = String(user.id || user.lid || "")
                  .split("@")[0]
                  .trim();
                const lastActiveAt = Number(session.lastActiveAt || 0);
                const lastActive =
                  lastActiveAt > 0 ? new Date(lastActiveAt).toLocaleString() : "No activity yet";
                const connected = Boolean(session.connected);
                return `
									<label class="session-assign-row">
										<input type="checkbox" class="user-session-option" data-user-id="${escapeHtml(u.id)}" value="${escapeHtml(sessionId)}" ${checked} ${isCurrentUser ? "disabled" : ""}>
										<span class="session-assign-info">
											<span class="session-assign-title">
												${escapeHtml(sessionId)}
												<span class="badge ${connected ? "badge-success" : "badge-danger"}">${connected ? "CONNECTED" : "OFFLINE"}</span>
											</span>
											<span class="session-assign-meta">${escapeHtml(phone || "Phone not available")} · Last active: ${escapeHtml(lastActive)}</span>
										</span>
									</label>`;
              })
              .join("")
          : '<div class="text-muted text-xs u-py-035">No sessions yet.</div>';

        const assignmentCell =
          u.role === "admin"
            ? `<span class="text-muted text-sm">All sessions (admin)</span>`
            : `
                        <details class="user-sessions-picker u-relative" data-id="${escapeHtml(u.id)}">
							<summary class="u-user-sessions-summary" data-locked="${isCurrentUser ? "true" : "false"}">
								<span class="user-sessions-summary u-truncate" data-id="${escapeHtml(u.id)}">${escapeHtml(u.allSessions ? "All Sessions" : assignedSummary)}</span>
								<span class="text-muted">${isCurrentUser ? "Locked" : "Edit"}</span>
							</summary>
							<div class="u-settings-popover">
								${
                  u.role === "manager"
                    ? `<label class="ui-list-row"><input type="checkbox" class="user-all-sessions" data-id="${escapeHtml(u.id)}" ${u.allSessions ? "checked" : ""} ${isCurrentUser ? "disabled" : ""}><span class="text-sm">All Sessions</span></label>`
                    : ""
                }
								<p class="text-muted text-xs u-m-0-045">${
                  u.role === "manager"
                    ? "Unchecked: only the selected sessions are available."
                    : "Assistants only see assigned sessions. An empty selection means no access at all."
                }</p>
								<div class="u-scroll-170">${sessionSelector}</div>
								<div class="flex gap-1 u-mt-065-end">
									${isCurrentUser ? "" : `<button type="button" class="btn btn-outline btn-sm btn-user-sessions-all" data-id="${escapeHtml(u.id)}">Clear</button><button type="button" class="btn btn-primary btn-sm btn-user-sessions-save" data-id="${escapeHtml(u.id)}">Save</button>`}
								</div>
							</div>
						</details>`;

        html += `
                <tr>
                    <td><strong>${escapeHtml(u.username)}</strong> ${isCurrentUser ? '<span class="text-muted text-xs ml-1">(You)</span>' : ""}<div class="text-muted text-xs">${Number(u.sessionCount || 0)} owned session(s)</div></td>
					<td>
						${u.status === "pending" ? '<span class="badge badge-warning">PENDING</span>' : '<span class="badge badge-success">ACTIVE</span>'}
					</td>
                    <td>
                        <select class="user-role-select u-input-mini" data-id="${escapeHtml(u.id)}" ${isCurrentUser ? "disabled" : ""}>
							<option value="assistant" ${u.role === "assistant" ? "selected" : ""}>ASSISTANT</option>
							<option value="manager" ${u.role === "manager" ? "selected" : ""}>MANAGER</option>
                            <option value="admin" ${u.role === "admin" ? "selected" : ""}>ADMIN</option>
                        </select>
                    </td>
					<td>${assignmentCell}</td>
                    <td class="text-muted">${date}</td>
                    <td class="u-text-right">
						${!isCurrentUser && u.status === "pending" ? `<button class="btn btn-outline btn-sm text-xs btn-approve-user u-pill-mr" data-id="${escapeHtml(u.id)}" data-username="${u.username}">Approve</button>` : ""}
						${!isCurrentUser ? `<button class="btn btn-danger btn-sm text-xs btn-delete-user u-pill" data-id="${escapeHtml(u.id)}" data-username="${u.username}">Delete</button>` : '<span class="text-muted text-xs">—</span>'}
                    </td>
                </tr>`;
      });

      UI.setHtml(table, html);

      table.querySelectorAll(".user-role-select").forEach((sel) => {
        sel.addEventListener("change", async (e) => {
          const id = e.target.dataset.id;
          const role = e.target.value;
          const res = await window.API.put(`/auth/users/${id}/role`, {
            role,
          });
          if (res.success) {
            Toast.success(`Role updated to ${role.toUpperCase()}`);
            this.loadUsers();

            // If they changed their own role somehow, reload the app (though UI disables it)
            const currentId = currentUserId();
            if (currentId === id) {
              setTimeout(() => window.location.reload(), 1500);
            }
          } else {
            Toast.error(res.message);
            this.loadUsers(); // Revert on failure
          }
        });
      });

      table.querySelectorAll(".btn-delete-user").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const id = e.target.dataset.id;
          const username = e.target.dataset.username;

          if (!confirm(`Are you sure you want to delete user @${username}?`)) return;

          const revoke = confirm(
            `Also revoke every session owned by @${username}?\n\nOK = delete user and revoke sessions (logs out WhatsApp, deletes credentials, irreversible)\nCancel = delete the login only`,
          );
          const res = await window.API.del(
            `/auth/users/${id}${revoke ? "?revokeSessions=true" : ""}`,
          );
          if (res.success) {
            Toast.success(
              res.data?.revokedSessions
                ? `User @${username} deleted; ${res.data.revokedSessions} session(s) revoked`
                : `User @${username} deleted`,
            );
            this.loadUsers();
          } else {
            Toast.error(res.message);
          }
        });
      });

      table.querySelectorAll(".btn-approve-user").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const id = e.target.dataset.id;
          const username = e.target.dataset.username;
          const res = await window.API.put(`/auth/users/${id}/approve`, {});
          if (res.success) {
            Toast.success(`User @${username} approved`);
            this.loadUsers();
          } else {
            Toast.error(res.message);
          }
        });
      });

      table.querySelectorAll(".user-sessions-picker").forEach((picker) => {
        const summary = picker.querySelector(".user-sessions-summary");
        const saveButton = picker.querySelector(".btn-user-sessions-save");
        const allButton = picker.querySelector(".btn-user-sessions-all");
        const summaryElement = picker.querySelector("summary");

        const collectAssignedSessions = () =>
          Array.from(picker.querySelectorAll(".user-session-option:checked")).map(
            (input) => input.value,
          );

        if (!saveButton && summaryElement) {
          summaryElement.addEventListener("click", (event) => {
            event.preventDefault();
          });
        }

        const allSessionsToggle = picker.querySelector(".user-all-sessions");
        const sessionList = picker.querySelector(".u-scroll-170");

        const syncAllSessionsState = () => {
          if (!allSessionsToggle) return;
          const all = allSessionsToggle.checked;
          if (sessionList) sessionList.style.opacity = all ? "0.5" : "1";
          picker.querySelectorAll(".user-session-option").forEach((input) => {
            if (!input.dataset.lockedByCurrentUser) {
              input.disabled = all || input.dataset.userLocked === "true";
            }
          });
        };

        allSessionsToggle?.addEventListener("change", syncAllSessionsState);
        syncAllSessionsState();

        if (saveButton) {
          saveButton.addEventListener("click", async () => {
            const id = saveButton.dataset.id;
            const allSessions = Boolean(allSessionsToggle?.checked);
            const assignedSessions = allSessions ? [] : collectAssignedSessions();
            saveButton.disabled = true;
            saveButton.textContent = "Saving...";

            const res = await window.API.put(`/auth/users/${id}/sessions`, {
              assignedSessions,
              allSessions,
            });

            saveButton.disabled = false;
            saveButton.textContent = "Save";

            if (res.success) {
              if (summary) {
                summary.textContent = allSessions
                  ? "All Sessions"
                  : this.formatAssignedSessionsSummary(assignedSessions);
              }
              picker.open = false;
              Toast.success("Session access updated");
            } else {
              Toast.error(res.message);
              this.loadUsers();
            }
          });
        }

        if (allButton) {
          allButton.addEventListener("click", () => {
            picker.querySelectorAll(".user-session-option").forEach((input) => {
              input.checked = false;
            });
          });
        }
      });
    },
  };
})();
