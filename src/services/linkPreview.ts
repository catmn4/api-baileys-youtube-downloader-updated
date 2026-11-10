/**
 * Fetch tiny OpenGraph/title previews for URLs contained in customer text.
 *
 * This is intentionally *not* a general web fetch: only http(s), DNS answers
 * are checked for private addresses, redirects are rejected, responses are
 * capped and only title/description fields are extracted. The result is
 * untrusted text and must be placed in the user/data portion of the prompt.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateAddress, validateOutboundUrl } from "@/lib/urlGuard";

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;
const MAX_URLS = 2;
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface Preview {
  url: string;
  title: string;
  description: string;
}

const cache = new Map<string, { at: number; preview: Preview | null }>();

export function extractUrls(texts: string[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(URL_PATTERN)) {
      const raw = match[0].replace(/[.,;:!?]+$/, "");
      if (!found.includes(raw)) found.push(raw);
      if (found.length >= MAX_URLS) return found;
    }
  }
  return found;
}

async function hostIsSafe(url: URL): Promise<boolean> {
  const invalid = validateOutboundUrl(url.toString(), { blockInternal: true });
  if (invalid) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const answers = await lookup(host, { all: true, verbatim: true });
    return answers.length > 0 && answers.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

function decode(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
}

function field(html: string, pattern: RegExp): string {
  const match = html.match(pattern);
  return match?.[1] ? decode(match[1]).replace(/\s+/g, " ").trim().slice(0, 300) : "";
}

function parsePreview(url: string, html: string): Preview {
  return {
    url,
    title:
      field(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      field(html, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
      field(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description:
      field(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
      field(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
  };
}

async function readLimitedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) return text.slice(0, MAX_BYTES);
    text += decoder.decode(value, { stream: true });
  }
  return text.slice(0, MAX_BYTES);
}

async function fetchPreview(url: URL): Promise<Preview | null> {
  if (!(await hostIsSafe(url))) return null;
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok || (response.status >= 300 && response.status < 400)) return null;
    if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "")) {
      return null;
    }
    const raw = await readLimitedText(response);
    return parsePreview(url.toString(), raw);
  } catch {
    return null;
  }
}

/** Return a compact, untrusted link-context block for the current turn. */
export async function collectLinkContext(texts: string[], now = Date.now()): Promise<string> {
  const urls = extractUrls(texts);
  if (urls.length === 0) return "";

  const rows: string[] = [];
  for (const raw of urls) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    const cached = cache.get(parsed.toString());
    let preview: Preview | null;

    if (cached && now - cached.at < CACHE_TTL_MS) {
      preview = cached.preview;
    } else {
      preview = await fetchPreview(parsed);
      cache.set(parsed.toString(), { at: now, preview });
      if (cache.size > 100) cache.delete(cache.keys().next().value ?? "");
    }

    if (preview && (preview.title || preview.description)) {
      rows.push(
        `- ${preview.url}${preview.title ? ` — ${preview.title}` : ""}${preview.description ? `: ${preview.description}` : ""}`,
      );
    }
  }

  return rows.length > 0 ? `<link_previews>\n${rows.join("\n")}\n</link_previews>` : "";
}
