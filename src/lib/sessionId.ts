/**
 * Session ids become filesystem paths (sessions/md_<id>) and Redis keys, so the
 * format is enforced at every storage boundary — not only in HTTP routes.
 */
export const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export function assertValidSessionId(value: unknown): asserts value is string {
  if (!isValidSessionId(value)) {
    throw new Error("Invalid session id (allowed: letters, digits, _ and -, max 64)");
  }
}
