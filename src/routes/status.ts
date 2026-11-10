import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import connectionManager from "@/baileys/connectionManager";
import config from "@/config";
import { success } from "@/lib/response";

const statusRoutes = new Hono();

const pkgPath = path.join(process.cwd(), "package.json");
let cachedPkg: Record<string, unknown>;
try {
  cachedPkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
} catch {
  cachedPkg = {
    name: "Baileys WA API",
    version: "1.0.0",
    description: "WhatsApp REST API powered by Baileys",
  };
}

/**
 * GET /status
 * Server health check and info.
 */
statusRoutes.get("/", (c) => {
  const sessions = connectionManager.listSessions();
  const pkg = cachedPkg;

  return success(c, {
    name: String(pkg.name || "Baileys WA API"),
    version: `v${String(pkg.version || "1.0.0")}`,
    description: String(pkg.description || "WhatsApp REST API powered by Baileys"),
    environment: config.env,
    uptime: process.uptime(),
    redis: config.redis.enabled ? "enabled" : "disabled",
    activeSessions: sessions.length,
    connectedSessions: sessions.filter((s) => s.connected).length,
  });
});

export default statusRoutes;
