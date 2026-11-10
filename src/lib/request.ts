/**
 * Request helpers shared by the HTTP layer.
 */
import type { Context } from "hono";
import config from "@/config";

/**
 * True when the request reached us over HTTPS, either directly or through a
 * trusted reverse proxy (TRUST_PROXY=true). Used to decide the cookie Secure
 * flag, HSTS and the production HTTPS redirect.
 */
export function isSecureRequest(c: Context): boolean {
  if (config.trustProxy) {
    const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    if (proto) return proto === "https";
  }
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}
