import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import config from "@/config";
import { loadDashboard } from "@/dashboard/loader";
import { generateOpenApiSpec } from "@/docs/openapi";
import appLogger from "@/lib/logger";
import { isSecureRequest } from "@/lib/request";
import { error, success } from "@/lib/response";
import { serveFile } from "@/lib/runtime";
import { authMiddleware } from "@/middleware/auth";
import { generalRateLimit } from "@/middleware/rateLimit";
import chatRoutes from "@/routes/chat";
import groupRoutes from "@/routes/group";
import mediaRoutes from "@/routes/media";
import messageRoutes from "@/routes/messages";
import profileRoutes from "@/routes/profile";
import sessionRoutes from "@/routes/session";
import statusRoutes from "@/routes/status";
import storyRoutes from "@/routes/story";

const app = new Hono();

// ── Global Middleware ───────────────────────────────
// CORS: never reflect arbitrary origins. An explicit CORS_ORIGIN list is
// honoured as-is; with the default "*" only same-origin requests are reflected,
// which keeps the public API usable from its own host without allowing
// cross-site credentialed reads.
const resolveCorsOrigin = (origin: string, c: Context) => {
  if (!origin) return origin; // curl / server-to-server: no CORS needed
  const configured = config.corsOrigin;
  if (configured !== "*") {
    return Array.isArray(configured)
      ? configured.includes(origin)
        ? origin
        : null
      : configured === origin
        ? origin
        : null;
  }
  try {
    const host = c.req.header("host");
    return host && new URL(origin).host === host ? origin : null;
  } catch {
    return null;
  }
};

const corsMiddleware = cors({ origin: resolveCorsOrigin });
app.use("*", corsMiddleware);

// Request ID: echo an incoming x-request-id (for tracing across reverse
// proxies) or mint a short one; every response carries it back.
app.use("*", async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const requestId =
    incoming || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  c.header("x-request-id", requestId);
  await next();
});

// Strict CSP: the dashboard ships no inline scripts or styles, so both
// directives stay at 'self'. 'report-sample' asks the browser to include the
// offending snippet, but support varies (Safari may omit it), so a report can
// still arrive with an empty sample. Violations are reported to
// /dashboard/csp-report so the real source is read from logs, not guessed.
const CDN_SCRIPT = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
];
const CDN_STYLE = [...CDN_SCRIPT, "https://fonts.googleapis.com"];
const CDN_FONT = ["https://fonts.gstatic.com"];
const CDN_IMG = [...CDN_SCRIPT];
const CDN_CONNECT = ["https://cdn.jsdelivr.net", "https://unpkg.com"];

/**
 * Build the CSP from the defaults plus configurable origins.
 *
 * CDNs are allowed by default (pinned assets are common practice); set
 * CSP_CDN=false for a same-origin-only policy. Extra origins can be added per
 * directive, so a specific CDN never requires disabling CSP.
 */
function buildCsp(): string {
  const { cdn, extra } = config.csp;
  const uniq = (list: string[]) => [...new Set(list.filter(Boolean))];

  const script = uniq([
    "\x27self\x27",
    "\x27report-sample\x27",
    ...(cdn ? CDN_SCRIPT : []),
    ...extra.script,
  ]);
  const style = uniq([
    "\x27self\x27",
    "\x27report-sample\x27",
    ...(cdn ? CDN_STYLE : []),
    ...extra.style,
  ]);
  const styleElem = uniq(["\x27self\x27", ...(cdn ? CDN_STYLE : []), ...extra.style]);
  const font = uniq(["\x27self\x27", "data:", ...(cdn ? CDN_FONT : []), ...extra.font]);
  const img = uniq(["\x27self\x27", "data:", ...(cdn ? CDN_IMG : []), ...extra.img]);
  const connect = uniq(["\x27self\x27", ...(cdn ? CDN_CONNECT : []), ...extra.connect]);

  return [
    "default-src \x27self\x27",
    `script-src ${script.join(" ")}`,
    `style-src ${style.join(" ")}`,
    // WebKit attaches a UA inline style to native <select> (text-overflow).
    "style-src-attr \x27unsafe-inline\x27",
    `style-src-elem ${styleElem.join(" ")}`,
    `img-src ${img.join(" ")}`,
    `font-src ${font.join(" ")}`,
    `connect-src ${connect.join(" ")}`,
    "frame-ancestors \x27none\x27",
    "base-uri \x27self\x27",
    "form-action \x27self\x27",
    "object-src \x27none\x27",
    "report-uri /dashboard/csp-report",
    "report-to csp",
  ].join("; ");
}

const DASHBOARD_CSP = buildCsp();

const CSP_HEADER = config.cspReportOnly
  ? "Content-Security-Policy-Report-Only"
  : "Content-Security-Policy";

const CSP_REPORT_TO =
  '{"group":"csp","max_age":10800,"endpoints":[{"url":"/dashboard/csp-report"}]}';

// Reporting API v1 (Chrome 96+): report-to resolves group names from this header,
// not from the legacy Report-To header above.
const CSP_REPORTING_ENDPOINTS = 'csp="/dashboard/csp-report"';

app.use("*", async (c, next) => {
  const applyHeaders = (target: Headers) => {
    target.set("X-Frame-Options", "DENY");
    target.set("X-Content-Type-Options", "nosniff");
    target.set("Referrer-Policy", "no-referrer");
    target.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    target.set(CSP_HEADER, DASHBOARD_CSP);
    target.set("Report-To", CSP_REPORT_TO);
    target.set("Reporting-Endpoints", CSP_REPORTING_ENDPOINTS);
    if (isSecureRequest(c)) {
      target.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
  };

  // Context headers: needed before the handler so streaming responses (SSE)
  // carry them when the stream starts.
  c.header("X-Frame-Options", "DENY");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(CSP_HEADER, DASHBOARD_CSP);
  c.header("Report-To", CSP_REPORT_TO);
  c.header("Reporting-Endpoints", CSP_REPORTING_ENDPOINTS);
  if (isSecureRequest(c)) {
    c.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  await next();

  // Static dashboard files return a raw Response, which discards context
  // headers, so apply them to the final response as well.
  try {
    if (c.res?.headers) applyHeaders(c.res.headers);
  } catch {
    // Immutable headers (stream already started): the pre-set ones apply.
  }
});

// Behind a trusted proxy, refuse plain HTTP for the dashboard (cookies use the
// Secure flag, so an http request would silently lose the session anyway).
if (config.env === "production" && config.trustProxy) {
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/dashboard") && !isSecureRequest(c)) {
      const host = c.req.header("host") ?? "";
      return c.redirect(`https://${host}${c.req.path}`, 308);
    }
    return next();
  });
}

// The dashboard is same-origin by design: reject requests that carry a foreign
// Origin header, so a compromised/malicious page cannot drive dashboard APIs.
app.use("/dashboard/*", async (c, next) => {
  // CSP reports arrive with an opaque origin ("null") and credentials omitted;
  // the endpoint is validated by content type, size and rate limit instead.
  if (c.req.path === "/dashboard/csp-report") return next();

  const origin = c.req.header("origin");
  if (origin) {
    const host = c.req.header("host") ?? "";
    try {
      if (new URL(origin).host !== host) {
        return c.json({ success: false, message: "Cross-origin dashboard request rejected" }, 403);
      }
    } catch {
      return c.json({ success: false, message: "Invalid Origin header" }, 403);
    }
  }
  return next();
});

// Body size limit: 10MB max to prevent DoS
app.use("*", bodyLimit({ maxSize: 10 * 1024 * 1024 }));

// General rate limit: 100 req/min per IP (production only)
if (config.env === "production") {
  app.use("*", generalRateLimit);
}

if (config.env === "development") {
  app.use("*", honoLogger());
}

// ── Error Handler ───────────────────────────────────
app.onError((err, c) => {
  appLogger.error("Unhandled error: %s", err.stack || err.message);
  const message = config.env === "development" ? err.message : "Internal server error";
  return error(c, message, 500);
});

// ── OpenAPI / Swagger Documentation ─────────────────

// Cache package.json at startup instead of reading on every request
const pkgPath = path.join(process.cwd(), "package.json");
let cachedPkg: Record<string, unknown>;
try {
  cachedPkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
} catch {
  cachedPkg = { name: "Baileys WA API", version: "1.0.0", description: "" };
}

// Swagger UI is self-hosted from node_modules: a CDN build would be blocked by
// the strict CSP (script-src self) and would not work offline.
const SWAGGER_DIST = path.join(process.cwd(), "node_modules", "swagger-ui-dist");

const SWAGGER_INIT = [
  "window.ui = SwaggerUIBundle({",
  '  url: "/openapi.json",',
  '  dom_id: "#swagger-ui",',
  "  deepLinking: true,",
  "  presets: [SwaggerUIBundle.presets.apis],",
  '  layout: "BaseLayout",',
  "  tryItOutEnabled: false",
  "});",
].join("\n");

/** Version and SRI hashes come from the installed package, so the CDN build is pinned. */
const SWAGGER_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(SWAGGER_DIST, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version || "5";
  } catch {
    return "5";
  }
})();

function sriFor(file: string): string {
  try {
    const digest = createHash("sha384")
      .update(fs.readFileSync(path.join(SWAGGER_DIST, file)))
      .digest("base64");
    return `integrity="sha384-${digest}" crossorigin="anonymous"`;
  } catch {
    return "";
  }
}

const DOCS_HTML_LOCAL =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n<title>API Documentation</title>\n<link rel="stylesheet" href="/docs-assets/swagger-ui.css" />\n</head>\n<body>\n<div id="swagger-ui"></div>\n<script src="/docs-assets/swagger-ui-bundle.js"></script>\n<script src="/docs-assets/swagger-init.js"></script>\n</body>\n</html>';

const DOCS_HTML_CDN = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>API Documentation</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css" ${sriFor("swagger-ui.css")} />
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" ${sriFor("swagger-ui-bundle.js")}></script>
<script src="/docs-assets/swagger-init.js"></script>
</body>
</html>`;

// CDN by default (pinned + SRI); set DOCS_ASSETS=local for an offline install.
const DOCS_HTML = config.csp.docsAssets === "cdn" ? DOCS_HTML_CDN : DOCS_HTML_LOCAL;

const SWAGGER_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
};

app.get("/docs", (c) => c.html(DOCS_HTML));

app.get("/docs-assets/:file", async (c) => {
  const file = c.req.param("file") ?? "";
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) return c.notFound();

  if (file === "swagger-init.js") {
    return c.body(SWAGGER_INIT, 200, {
      "Content-Type": "application/javascript; charset=utf-8",
    });
  }

  const contentType = SWAGGER_TYPES[path.extname(file).toLowerCase()];
  if (!contentType) return c.notFound();

  const fullPath = path.join(SWAGGER_DIST, file);
  if (!fullPath.startsWith(SWAGGER_DIST + path.sep)) return c.notFound();
  if (!fs.existsSync(fullPath)) return c.notFound();

  return serveFile(fullPath, contentType);
});

app.get("/openapi.json", (_c) => {
  const pkg = cachedPkg;
  const spec = generateOpenApiSpec(pkg, config.port);
  return new Response(JSON.stringify(spec, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
});

// ── Routes ──────────────────────────────────────────
app.route("/status", statusRoutes);
// CSP violation reports. Browsers POST here for report-uri (Safari/legacy) and
// report-to (Chrome). The log line carries the directive, source file, line and
// sample, which is what identifies the real source of a violation.
const cspReportCounts = new Map<string, { count: number; resetAt: number }>();

app.post("/dashboard/csp-report", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const entry = cspReportCounts.get(ip);
  if (!entry || entry.resetAt < now) {
    cspReportCounts.set(ip, { count: 1, resetAt: now + 60_000 });
  } else if (entry.count >= 120) {
    return c.body(null, 204);
  } else {
    entry.count += 1;
  }

  const raw = await c.req.text().catch(() => "");
  if (!raw || raw.length > 8192) return c.body(null, 204);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.body(null, 204);
  }

  const reports: Array<Record<string, unknown>> = [];
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const body = (item as Record<string, unknown>)?.body;
      if (body && typeof body === "object") reports.push(body as Record<string, unknown>);
    }
  } else if (payload && typeof payload === "object") {
    const legacy = (payload as Record<string, unknown>)["csp-report"];
    if (legacy && typeof legacy === "object") reports.push(legacy as Record<string, unknown>);
  }

  for (const report of reports.slice(0, 5)) {
    appLogger.warn(
      "[CSP-REPORT] %s",
      JSON.stringify({
        directive: report["effective-directive"] ?? report.effectiveDirective ?? "",
        blocked: String(
          report["blocked-uri"] ?? report.blockedURL ?? report.blockedURI ?? "",
        ).slice(0, 300),
        document: String(
          report["document-uri"] ?? report.documentURL ?? report.documentURI ?? "",
        ).slice(0, 300),
        source: String(report["source-file"] ?? report.sourceFile ?? "").slice(0, 300),
        line: report["line-number"] ?? report.lineNumber ?? null,
        sample: String(report["script-sample"] ?? report.sample ?? "").slice(0, 200),
        ua: (c.req.header("user-agent") || "").slice(0, 160),
      }),
    );
  }

  return c.body(null, 204);
});

app.route("/sessions", sessionRoutes);
// Canonical versioned path, with the original /messages kept as an alias.
app.route("/api/v1/messages", messageRoutes);
app.route("/messages", messageRoutes);
app.route("/chats", chatRoutes);
app.route("/groups", groupRoutes);
app.route("/profile", profileRoutes);
app.route("/media", mediaRoutes);
app.route("/story", storyRoutes);

// ── Config Endpoints ────────────────────────────────
app.get("/config/simulation", authMiddleware, (c) => {
  return success(c, {
    typingBeforeSend: config.simulation.typingBeforeSend,
    typingDelayMinMs: config.simulation.typingDelayMinMs,
    typingDelayMaxMs: config.simulation.typingDelayMaxMs,
    autoReadMessages: config.simulation.autoReadMessages,
    autoMarkOnline: config.simulation.autoMarkOnline,
    rejectCalls: config.simulation.rejectCalls,
  });
});

// ── Dashboard (modular — never breaks main API) ────
try {
  loadDashboard(app);
} catch (err) {
  appLogger.warn("Dashboard failed to load: %s", (err as Error).message);
}

// ── 404 Handler ─────────────────────────────────────
app.notFound((c) => {
  return c.json({ success: false, message: "Route not found" }, 404);
});

export default app;
