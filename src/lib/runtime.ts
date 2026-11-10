/**
 * Runtime Abstraction Layer
 *
 * Detects Bun vs Node.js and provides unified APIs for:
 * - Password hashing (bcryptjs — same format on both runtimes)
 * - File serving (Bun.file vs fs.readFileSync)
 *
 * On Bun: zero overhead, delegates to native APIs where faster
 * On Node.js: uses npm packages as fallback
 */

import { existsSync, readFileSync } from "node:fs";
import bcrypt from "bcryptjs";

/** true when running under Bun runtime */
export const isBun = typeof globalThis.Bun !== "undefined";

// ── Password Hashing (bcryptjs — portable, same hash format) ──

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── File Serving ────────────────────────────────────

/**
 * Check if a file exists at the given path.
 */
export async function fileExists(path: string): Promise<boolean> {
  if (isBun) {
    return Bun.file(path).exists();
  }
  return existsSync(path);
}

/**
 * Serve a file as a Response object.
 */
export async function serveFile(
  path: string,
  contentType: string,
  cacheControl = "no-cache",
): Promise<Response> {
  if (isBun) {
    return new Response(Bun.file(path), {
      headers: { "Content-Type": contentType, "Cache-Control": cacheControl },
    });
  }
  // Node.js fallback
  const data = readFileSync(path);
  return new Response(data, {
    headers: { "Content-Type": contentType, "Cache-Control": cacheControl },
  });
}
