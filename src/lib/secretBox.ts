/**
 * Secret storage for per-number configuration.
 *
 * Credentials that belong to a single WhatsApp number (RAG endpoint tokens,
 * provider keys) live in the session metadata instead of the environment, so
 * each user keeps control of their own. Metadata is persisted as plain JSON or
 * in Redis, therefore anything sensitive is encrypted here before writing.
 *
 * Blob format: v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
 *
 * Without CONFIG_ENC_KEY the value is stored with a "plain:" prefix instead
 * (encryptionConfigured() === false lets the caller warn the operator). The
 * derived key uses SHA-256 so any passphrase length works.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_LENGTH = 16;
const VERSION = "v1";
const PLAIN_PREFIX = "plain:";
const IV_BYTES = 12;

/** Derive a stable 32-byte key from CONFIG_ENC_KEY, or null when unset. */
function encryptionKey(): Buffer | null {
  const raw = process.env.CONFIG_ENC_KEY;
  if (!raw || !raw.trim()) return null;
  return createHash("sha256").update(raw).digest();
}

/** True when CONFIG_ENC_KEY is set, i.e. secrets are stored encrypted. */
export function encryptionConfigured(): boolean {
  return encryptionKey() !== null;
}

/**
 * Encrypt a secret for storage. Empty input yields null (nothing to store).
 * Falls back to a "plain:"-prefixed value when no key is configured.
 */
export function encryptSecret(plain: string | undefined | null): string | null {
  const value = typeof plain === "string" ? plain.trim() : "";
  if (!value) return null;

  const key = encryptionKey();
  if (!key) return `${PLAIN_PREFIX}${value}`;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** True when the stored blob uses the encrypted format. */
export function isEncrypted(blob: string | undefined | null): boolean {
  return typeof blob === "string" && blob.startsWith(`${VERSION}:`);
}

/** Decrypt a stored secret. Returns null when it cannot be read. */
export function decryptSecret(blob: string | undefined | null): string | null {
  if (!blob) return null;
  if (blob.startsWith(PLAIN_PREFIX)) return blob.slice(PLAIN_PREFIX.length);
  if (!isEncrypted(blob)) return null;

  const key = encryptionKey();
  if (!key) return null;

  const parts = blob.split(":");
  if (parts.length !== 4) return null;
  const [, ivB64, tagB64, dataB64] = parts;

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"), {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Short hint of a secret for logs and dashboards: first 4 + last 4 characters.
 * Never use the result as a credential — it is display-only.
 */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return "";
  const text = value.trim();
  if (text.length <= 8) return "••••";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

const SECRET_KEY_PATTERN =
  /^(credentials|credential|token|apikey|api_key|secret|authorization|password)$/i;

/** Display-only tree produced by redactCredentials. */
export type RedactedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | RedactedValue[]
  | { [key: string]: RedactedValue };

/**
 * Deep copy of a value with credential-bearing keys replaced by
 * "[redacted]", safe to pass to a logger. The result is display data only and
 * must not be fed back into the application.
 */
export function redactCredentials(input: unknown): RedactedValue {
  if (Array.isArray(input)) {
    return input.map((item) => redactCredentials(item));
  }
  if (input === null || input === undefined) {
    return input;
  }
  switch (typeof input) {
    case "string":
    case "number":
    case "boolean":
      return input;
    case "bigint":
      return input.toString();
    case "object": {
      const output: Record<string, RedactedValue> = {};
      for (const [key, value] of Object.entries(input)) {
        output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactCredentials(value);
      }
      return output;
    }
    default:
      // Functions and symbols have nothing sensible to display.
      return "[redacted]";
  }
}
