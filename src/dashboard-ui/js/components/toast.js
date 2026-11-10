/** Toast Notifications */
(() => {
  const icons = { success: "✓", error: "✕", info: "ℹ", warning: "⚠" };

  window.Toast = {
    show(message, type = "info", duration = 4000) {
      const container = document.getElementById("toast-container");
      const toast = document.createElement("div");
      toast.className = `toast ${type}`;
      UI.setHtml(
        toast,
        `<span class="toast-icon">${icons[type] || ""}</span><span class="toast-message">${UI.escapeHtml(message)}</span>`,
      );
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(100%)";
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },
    success(msg) {
      this.show(msg, "success");
    },
    error(msg) {
      this.show(msg, "error");
    },
    info(msg) {
      this.show(msg, "info");
    },
    warning(msg) {
      this.show(msg, "warning");
    },
  };
})();
