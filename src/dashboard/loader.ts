/**
 * Modular Dashboard Loader
 *
 * Checks if dashboard UI files exist. If present, mounts:
 * - Static file serving for dashboard-ui/
 * - Dashboard auth routes
 * - Dashboard API routes
 *
 * If absent or disabled, logs an info message. Never throws.
 */
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { Hono } from "hono";
import config from "@/config";
import dashboardApi from "@/dashboard/api";
import dashboardAuth from "@/dashboard/auth";
import logger from "@/lib/logger";
import { fileExists, serveFile } from "@/lib/runtime";

const DASHBOARD_UI_DIR = join(process.cwd(), "src", "dashboard-ui");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function loadDashboard(app: Hono): boolean {
  if (!config.dashboard.enabled) {
    logger.info("[Dashboard] Dashboard is disabled via DASHBOARD_ENABLED=false");
    return false;
  }

  if (!existsSync(DASHBOARD_UI_DIR)) {
    logger.info("[Dashboard] Dashboard UI directory not found at %s — skipping", DASHBOARD_UI_DIR);
    return false;
  }

  // Mount dashboard auth routes
  app.route("/dashboard/api/auth", dashboardAuth);

  // Mount dashboard API routes
  app.route("/dashboard/api", dashboardApi);

  // Serve static files using runtime-agnostic helpers
  app.get("/dashboard/*", async (c) => {
    const rawPath = c.req.path;

    // Redirect /dashboard to /dashboard/ so relative URLs resolve correctly
    if (rawPath === "/dashboard" || rawPath === "/dashboard/") {
      if (rawPath === "/dashboard") {
        return c.redirect("/dashboard/");
      }
      const indexPath = join(DASHBOARD_UI_DIR, "index.html");
      if (await fileExists(indexPath)) {
        return serveFile(indexPath, "text/html; charset=utf-8");
      }
    }

    // Strip /dashboard/ prefix to get relative file path
    const filePath = rawPath.replace(/^\/dashboard\//, "");
    if (!filePath) {
      const indexPath = join(DASHBOARD_UI_DIR, "index.html");
      return serveFile(indexPath, "text/html; charset=utf-8");
    }

    const fullPath = resolve(join(DASHBOARD_UI_DIR, filePath));

    // Prevent path traversal attacks
    if (!fullPath.startsWith(resolve(DASHBOARD_UI_DIR))) {
      return c.json({ success: false, message: "Forbidden" }, 403);
    }

    if (await fileExists(fullPath)) {
      const ext = extname(fullPath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      return serveFile(fullPath, contentType);
    }

    // SPA fallback — return index.html for non-file routes (e.g. hash routes)
    const indexPath = join(DASHBOARD_UI_DIR, "index.html");
    if (await fileExists(indexPath)) {
      return serveFile(indexPath, "text/html; charset=utf-8");
    }

    return c.json({ success: false, message: "Not found" }, 404);
  });

  logger.info("📊 Dashboard at: http://%s:%d/dashboard", config.host, config.port);
  return true;
}

export default loadDashboard;
