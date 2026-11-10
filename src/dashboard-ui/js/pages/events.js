/** Events Page — real-time event monitor via SSE */
(() => {
  let eventSource = null;
  let paused = false;
  let eventCount = 0;

  window.EventsPage = {
    async render() {
      UI.setHtml(
        document.getElementById("page-content"),
        `
				<div class="card events-panel">
					<div class="toolbar events-panel-toolbar">
						<div class="events-panel-title">
							<h3>Realtime Event Feed</h3>
						</div>
						<button class="btn btn-outline btn-sm" id="btn-pause-events">⏸ Pause</button>
						<button class="btn btn-outline btn-sm" id="btn-clear-events">🗑 Clear</button>
						<div class="toolbar-spacer"></div>
						<span class="badge badge-success" id="sse-status"><span class="badge-dot pulse"></span>LISTENING</span>
					</div>
					<div class="events-feed-shell">
						<div class="events-feed" id="events-feed">
							<div class="empty-state"><p class="text-muted">Waiting for events...</p></div>
						</div>
					</div>
				</div>`,
      );

      document
        .getElementById("btn-pause-events")
        .addEventListener("click", () => this.togglePause());
      document
        .getElementById("btn-clear-events")
        .addEventListener("click", () => this.clearEvents());

      // Load recent events first
      const recent = await API.get("/events/recent?limit=30");
      if (recent.success && recent.data?.length > 0) {
        const feed = document.getElementById("events-feed");
        feed.replaceChildren();
        recent.data.reverse().forEach((ev) => {
          this.addEvent(ev, false);
        });
      }

      this.startSSE();
    },

    startSSE() {
      if (eventSource) eventSource.close();
      // The HttpOnly session cookie authenticates the stream: EventSource cannot
      // set headers, and no token belongs in the URL (proxy access logs).
      eventSource = new EventSource("/dashboard/api/events/stream");

      eventSource.addEventListener("baileys-event", (e) => {
        if (paused) return;
        try {
          const ev = JSON.parse(e.data);
          this.addEvent(ev, true);
          eventCount++;
          const badge = document.getElementById("events-badge");
          if (badge) {
            badge.classList.remove("is-hidden");
            badge.textContent = eventCount;
          }
        } catch {}
      });

      eventSource.addEventListener("heartbeat", () => {
        const status = document.getElementById("sse-status");
        if (status) UI.setHtml(status, '<span class="badge-dot pulse"></span>LISTENING');
      });

      eventSource.onerror = () => {
        const status = document.getElementById("sse-status");
        if (status) {
          status.className = "badge badge-danger";
          UI.setHtml(status, "DISCONNECTED");
        }
      };
    },

    addEvent(ev, prepend = true) {
      const feed = document.getElementById("events-feed");
      if (!feed) return;

      // Remove empty state
      const empty = feed.querySelector(".empty-state");
      if (empty) empty.remove();

      const time = new Date(ev.timestamp).toLocaleTimeString();
      const item = document.createElement("div");
      item.className = "event-item";
      UI.setHtml(
        item,
        `
        <div class="event-header">
          <span class="event-type">${UI.escapeHtml(ev.event)}</span>
          <span class="event-session">${UI.escapeHtml(ev.sessionId)}</span>
          <span class="event-time">${time}</span>
        </div>
        <div class="event-detail">${UI.escapeHtml(JSON.stringify(ev.data, null, 2))}</div>`,
      );

      item.addEventListener("click", () => item.classList.toggle("expanded"));

      prepend ? feed.prepend(item) : feed.appendChild(item);

      // Keep max 100 items
      while (feed.children.length > 100) feed.lastChild.remove();
    },

    togglePause() {
      paused = !paused;
      const btn = document.getElementById("btn-pause-events");
      btn.textContent = paused ? "▶ Resume" : "⏸ Pause";
      const status = document.getElementById("sse-status");
      if (paused) {
        status.className = "badge badge-warning";
        UI.setHtml(status, "PAUSED");
      } else {
        status.className = "badge badge-success";
        UI.setHtml(status, '<span class="badge-dot pulse"></span>LISTENING');
      }
    },

    clearEvents() {
      const feed = document.getElementById("events-feed");
      if (feed)
        UI.setHtml(feed, '<div class="empty-state"><p class="text-muted">Events cleared</p></div>');
      eventCount = 0;
      const badge = document.getElementById("events-badge");
      if (badge) badge.classList.add("is-hidden");
      API.post("/events/clear");
    },

    destroy() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    },
  };
})();
