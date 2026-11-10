import type { Context } from "hono";
import config from "@/config";
import { publicErrorMessage } from "@/lib/errorMessage";
import logger from "@/lib/logger";

/**
 * Standardized API response envelope.
 *
 * Success: { success: true, message, data?, requestId }
 * Error:   { success: false, message, code?, requestId }
 *
 * `code` is a stable machine-readable error code derived from the HTTP status
 * (overridable via the optional 4th arg) so third-party integrators can branch
 * on it instead of parsing free-text messages. `requestId` is echoed from the
 * incoming `x-request-id` header (or generated) for end-to-end traceability.
 *
 * Shape is backward-compatible: the original { success, message, data? }
 * fields are unchanged; `code` and `requestId` are additive.
 */

const ERROR_CODES = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  402: "PAYMENT_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  410: "GONE",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "UNPROCESSABLE_ENTITY",
  425: "TOO_EARLY",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  501: "NOT_IMPLEMENTED",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT",
} as const;

function codeForStatus(status: number): string {
  return ERROR_CODES[status as keyof typeof ERROR_CODES] || `HTTP_${status}`;
}

function requestIdFor(c: Context): string {
  const incoming = c.req.header("x-request-id");
  if (incoming) return incoming;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  code?: string;
  requestId?: string;
  /** Actionable next step for the caller. */
  hint?: string;
  /** Request field that caused the rejection. */
  field?: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export interface ErrorExtra {
  hint?: string;
  field?: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export function success<T>(c: Context, data?: T, message = "Success", status = 200) {
  const body: ApiResponse<T> = {
    success: true,
    message,
    requestId: requestIdFor(c),
  };
  if (data !== undefined) body.data = data;
  return c.json(body, status as 200);
}

export function error(
  c: Context,
  message: string,
  status = 500,
  code?: string,
  extra: ErrorExtra = {},
) {
  const safeMessage = publicErrorMessage(message, status, config.env);
  if (safeMessage !== message) {
    logger.error("[api] suppressed internal error (status %d): %s", status, message);
  }

  const body: ApiResponse = {
    success: false,
    message: safeMessage,
    code: code || codeForStatus(status),
    requestId: requestIdFor(c),
  };
  if (extra.hint) body.hint = extra.hint;
  if (extra.field) body.field = extra.field;
  if (extra.details) body.details = extra.details;
  if (extra.retryable !== undefined) body.retryable = extra.retryable;
  return c.json(body, status as 500);
}

export default { success, error };
