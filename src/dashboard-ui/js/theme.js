/** Theme Toggle — persists to localStorage */
(() => {
  const saved = localStorage.getItem("wa-dashboard-theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);

  window.ThemeManager = {
    toggle() {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("wa-dashboard-theme", next);
    },
    get() {
      return document.documentElement.getAttribute("data-theme");
    },
  };
})();
