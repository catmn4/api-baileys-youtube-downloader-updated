import pino from "pino";
import config from "@/config";

const logger = pino({
  level: config.logLevel,
  transport:
    config.env === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});

export const baileysLogger = pino({
  level: config.baileys.logLevel,
  transport:
    config.env === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});

/**
 * Deep sanitize an object by omitting sensitive keys.
 */
// pi-lens-ignore: no-unknown-returns -- generic sanitizer for arbitrary log payloads; narrowing the return type would be a lie
export function deepSanitizeObject(obj: unknown, options: { omitKeys?: string[] } = {}): unknown {
  const { omitKeys = [] } = options;
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Buffer.isBuffer(obj)) return "[Buffer]";
  if (ArrayBuffer.isView(obj)) return "[TypedArray]";

  if (Array.isArray(obj)) {
    return obj.map((item) => deepSanitizeObject(item, options));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (omitKeys.includes(key)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = deepSanitizeObject(value, options);
    }
  }
  return sanitized;
}

export default logger;
