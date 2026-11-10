/** Messaging Page — send text, image, file, bulk messages */
(() => {
  function canSendBulk() {
    try {
      const user = JSON.parse(localStorage.getItem("wa-dashboard-user") || "{}");
      return Boolean(window.App?.hasCapability?.(user, "sendBulk"));
    } catch {
      return false;
    }
  }

  window.MessagingPage = {
    async render() {
      const sessions = await this.getSessions();
      const opts = sessions
        .map((s) => `<option value="${s.sessionId || s.id}">${s.sessionId || s.id}</option>`)
        .join("");

      UI.setHtml(
        document.getElementById("page-content"),
        `
        <div class="card mb-2">
          <div class="card-header"><h3>Send Message</h3></div>
          <form id="send-msg-form">
            <div class="flex gap-2 u-flex-wrap">
              <div class="form-group u-flex-1-minw-200">
                <label>Session</label>
                <select id="msg-session" required>${opts || "<option disabled>No sessions</option>"}</select>
              </div>
              <div class="form-group u-flex-1-minw-200">
                <label>Receiver</label>
                <input type="text" id="msg-receiver" placeholder="6281234567890" required />
              </div>
            </div>
            <div class="form-group">
              <label class="checkbox-label"><input type="checkbox" id="msg-is-group" /> Send to Group (Use Group JID)</label>
            </div>
            <div class="form-group">
              <label>Message Type</label>
              <select id="msg-type">
                <option value="text">Text</option>
                <option value="image">Image (URL)</option>
                <option value="document">Document (URL)</option>
                <option value="location">Location</option>
              </select>
            </div>
            <div class="form-group" id="msg-text-group">
              <label>Message</label>
              <textarea id="msg-text" placeholder="Type your message..." rows="3"></textarea>
            </div>
            <div class="form-group hidden" id="msg-url-group">
              <label>Media URL</label>
              <input type="url" id="msg-url" placeholder="https://example.com/image.jpg" />
            </div>
            <div class="form-group hidden" id="msg-caption-group">
              <label>Caption (Optional)</label>
              <input type="text" id="msg-caption" placeholder="Image caption" />
            </div>
            <div class="form-group hidden" id="msg-location-group">
              <label>Latitude / Longitude</label>
              <div class="flex gap-1">
                <input class="u-flex-1" type="text" id="msg-lat" placeholder="Latitude" />
                <input class="u-flex-1" type="text" id="msg-lng" placeholder="Longitude" />
              </div>
            </div>
            <button type="submit" class="btn btn-primary">Send Message</button>
          </form>
        </div>

        <div class="card ${canSendBulk() ? "" : "hidden"}">
          <div class="card-header"><h3>Bulk Send</h3></div>
          <form id="bulk-msg-form">
            <div class="form-group">
              <label>Session</label>
              <select id="bulk-session" required>${opts || "<option disabled>No sessions</option>"}</select>
            </div>
            <div class="form-group">
              <label>Recipients (one per line: phone,message)</label>
              <textarea id="bulk-data" rows="5" placeholder="6281234567890,Hello!&#10;6281234567891,Hi there!"></textarea>
            </div>
            <button type="submit" class="btn btn-primary">Send Bulk</button>
          </form>
          <div id="bulk-result" class="mt-2"></div>
        </div>`,
      );

      const preferredSession =
        window.App?.resolveSelectedSession?.(sessions) || sessions[0]?.sessionId || "";
      const msgSession = document.getElementById("msg-session");
      const bulkSession = document.getElementById("bulk-session");
      if (msgSession && preferredSession) msgSession.value = preferredSession;
      if (bulkSession && preferredSession) bulkSession.value = preferredSession;
      const remember = (value) => {
        window.App?.setSelectedSessionId?.(value);
        if (msgSession) msgSession.value = value;
        if (bulkSession) bulkSession.value = value;
      };
      msgSession?.addEventListener("change", (e) => remember(e.target.value));
      bulkSession?.addEventListener("change", (e) => remember(e.target.value));

      // Type switching
      document.getElementById("msg-type").addEventListener("change", (e) => {
        const v = e.target.value;
        document.getElementById("msg-text-group").classList.toggle("hidden", v !== "text");
        document
          .getElementById("msg-url-group")
          .classList.toggle("hidden", !["image", "document"].includes(v));
        document.getElementById("msg-caption-group").classList.toggle("hidden", v !== "image");
        document.getElementById("msg-location-group").classList.toggle("hidden", v !== "location");
      });

      // Send single
      document.getElementById("send-msg-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const session = document.getElementById("msg-session").value;
        const receiver = document.getElementById("msg-receiver").value.trim();
        const isGroup = document.getElementById("msg-is-group").checked;
        const type = document.getElementById("msg-type").value;
        let message = {};

        if (type === "text")
          message = {
            text: document.getElementById("msg-text").value,
          };
        else if (type === "image")
          message = {
            image: {
              url: document.getElementById("msg-url").value,
            },
            caption: document.getElementById("msg-caption").value || undefined,
          };
        else if (type === "document")
          message = {
            document: {
              url: document.getElementById("msg-url").value,
            },
            fileName: "file",
          };
        else if (type === "location")
          message = {
            location: {
              degreesLatitude: parseFloat(document.getElementById("msg-lat").value),
              degreesLongitude: parseFloat(document.getElementById("msg-lng").value),
            },
          };

        const result = await API.post(`/sessions/${session}/send`, {
          receiver,
          message,
          isGroup,
        });
        result.success ? Toast.success("Message sent!") : Toast.error(result.message);
      });

      // Bulk send
      document.getElementById("bulk-msg-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const session = document.getElementById("bulk-session").value;
        const lines = document.getElementById("bulk-data").value.trim().split("\n").filter(Boolean);
        const messages = lines.map((l) => {
          const [receiver, ...rest] = l.split(",");
          return {
            receiver: receiver.trim(),
            message: { text: rest.join(",").trim() },
          };
        });

        const result = await API.post(`/sessions/${session}/send`, {
          messages,
        });
        if (result.success) {
          Toast.success(`Bulk job created: ${result.data?.jobId || "queued"}`);
          UI.setHtml(
            document.getElementById("bulk-result"),
            `<p class="text-sm text-accent">Job: ${UI.escapeHtml(result.data?.jobId)} | Total: ${messages.length}</p>`,
          );
        } else {
          Toast.error(result.message);
        }
      });
    },

    async getSessions() {
      const result = await API.get("/sessions");
      return result.success ? result.data || [] : [];
    },
  };
})();
