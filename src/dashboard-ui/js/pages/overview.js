/** Overview Page */
(() => {
  window.OverviewPage = {
    async render() {
      const container = document.getElementById("page-content");
      UI.setHtml(
        container,
        `
        <div class="stats-grid" id="stats-grid">
          <div class="stat-card"><div class="skeleton skeleton-card w-full"></div></div>
          <div class="stat-card"><div class="skeleton skeleton-card w-full"></div></div>
          <div class="stat-card"><div class="skeleton skeleton-card w-full"></div></div>
          <div class="stat-card"><div class="skeleton skeleton-card w-full"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Server Information</h3></div>
          <div id="server-info"><div class="skeleton skeleton-text"></div></div>
        </div>`,
      );

      const result = await API.get("/stats");
      if (!result.success) return;
      const d = result.data;
      const isRestricted = Boolean(d.infoRestricted);

      UI.setHtml(
        document.getElementById("stats-grid"),
        `
        <div class="stat-card">
          <div class="stat-icon green"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/></svg></div>
          <div class="stat-info"><h4>Total Sessions</h4><div class="stat-value">${d.totalSessions}</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <div class="stat-info"><h4>Connected</h4><div class="stat-value">${d.connectedSessions}</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon amber"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg></div>
          <div class="stat-info"><h4>Disconnected</h4><div class="stat-value">${d.disconnectedSessions}</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
          <div class="stat-info"><h4>Uptime</h4><div class="stat-value">${this.formatUptime(d.uptime)}</div></div>
        </div>`,
      );

      const mem = d.memoryUsage;
      UI.setHtml(
        document.getElementById("server-info"),
        `
        <table>
          ${isRestricted ? `<tr><td class="text-muted">System Info</td><td><span class="badge badge-warning">ADMIN ONLY</span></td></tr>` : `<tr><td class="text-muted">Environment</td><td><span class="badge badge-info">${d.environment}</span></td></tr>`}
          ${isRestricted ? "" : `<tr><td class="text-muted">Redis</td><td><span class="badge ${d.redisEnabled ? "badge-success" : "badge-warning"}">${d.redisEnabled ? "CONNECTED" : "DISABLED"}</span></td></tr>`}
          ${isRestricted ? "" : `<tr><td class="text-muted">Memory (RSS)</td><td>${(mem.rss / 1024 / 1024).toFixed(1)} MB</td></tr>`}
          ${isRestricted ? "" : `<tr><td class="text-muted">Memory (Heap)</td><td>${(mem.heapUsed / 1024 / 1024).toFixed(1)} / ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB</td></tr>`}
          <tr><td class="text-muted">Version</td><td>${d.version}</td></tr>
        </table>`,
      );
    },

    formatUptime(seconds) {
      const numeric = Number(seconds);
      if (!Number.isFinite(numeric) || numeric < 0) return "—";
      const h = Math.floor(numeric / 3600);
      const m = Math.floor((numeric % 3600) / 60);
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    },
  };
})();
