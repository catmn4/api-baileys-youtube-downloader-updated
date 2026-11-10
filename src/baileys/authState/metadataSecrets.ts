/**
 * Session metadata is persisted as JSON or Redis hashes, so credential fields
 * inside it must not be stored in plaintext. Only the webhook secret is
 * encrypted here; AI credentials already travel through their own encrypted
 * fields.
 *
 * Read path is backward compatible:
 * - legacy plaintext (no prefix) is returned as-is and re-encrypted on the
 *   next write,
 * - `plain:` prefixes (no CONFIG_ENC_KEY) and `v1:` blobs are decoded,
 * - an unreadable blob becomes undefined instead of being used as a secret.
 */
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/secretBox";

type MetadataRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MetadataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function encodeMetadataSecrets<T>(metadata: T): T {
  if (!isRecord(metadata)) return metadata;
  let next = metadata;
  for (const key of ["webhookSecret", "webhookSecretPrevious"] as const) {
    const secret = next[key];
    if (typeof secret !== "string" || secret.length === 0) continue;
    // Already stored in a recognized format: do not double-encrypt on every save.
    if (isEncrypted(secret) || secret.startsWith("plain:")) continue;
    next = { ...next, [key]: encryptSecret(secret) };
  }
  return next as T;
}

export function decodeMetadataSecrets<T>(metadata: T): T {
  if (!isRecord(metadata)) return metadata;
  let next = metadata;
  for (const key of ["webhookSecret", "webhookSecretPrevious"] as const) {
    const secret = next[key];
    if (typeof secret !== "string" || secret.length === 0) continue;
    if (!isEncrypted(secret) && !secret.startsWith("plain:")) continue; // legacy
    next = { ...next, [key]: decryptSecret(secret) ?? undefined };
  }
  return next as T;
}
