/**
 * Outbound URL guard for configured integrations.
 *
 * The allowlist itself is the configuration (only URLs an operator stored are
 * ever called); this module adds a protocol check and an optional private-host
 * block for deployments that must not reach internal networks.
 */

import { isIP } from "node:net";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /\.local$/i,
  /\.internal$/i,
];

/**
 * True when the hostname points at a private/loopback/link-local target.
 * Hostnames are matched textually — deliberately no DNS resolution here, so a
 * lookup failure can never turn into an allow.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return isPrivateAddress(host);
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host.startsWith("fe80")) return true;
  return false;
}

/**
 * Validate an outbound URL before it is fetched.
 * Returns an error message, or null when the URL is acceptable.
 */
export function validateOutboundUrl(
  raw: string,
  options: { blockInternal: boolean },
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "Invalid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Unsupported protocol: ${parsed.protocol}`;
  }
  if (options.blockInternal && isPrivateHost(parsed.hostname)) {
    return "Target host is internal/private (blocked by AI_TOOL_BLOCK_INTERNAL)";
  }
  return null;
}

/**
 * True for IPv4/IPv6 addresses that must not be reachable by untrusted URLs:
 * loopback, RFC1918, CGNAT, link-local, multicast/reserved and IPv6 ULA.
 * Call this on every DNS answer as well as on literal IP hosts.
 */
export function isPrivateAddress(address: string): boolean {
  const addr = address.toLowerCase().replace(/^\[|\]$/g, "");

  if (isIP(addr) === 4) {
    const [a, b] = addr.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 0 || b === 168)) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  if (isIP(addr) === 6) {
    if (addr === "::" || addr === "::1") return true;
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    // Hex form of an IPv4-mapped address, e.g. ::ffff:7f00:1.
    const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return isPrivateAddress(
        `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`,
      );
    }
    if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // fc00::/7
    if (/^fe[89ab]/.test(addr)) return true; // fe80::/10
    if (addr.startsWith("ff")) return true; // multicast
    return false;
  }

  return false;
}
