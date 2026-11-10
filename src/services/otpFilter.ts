/**
 * Optional auto-reply suppression for OTP/verification messages.
 *
 * This is a deny/ignore list, not an allowlist: matching senders or phrases
 * skip the AI and static auto-reply. Messages are still stored and webhooks
 * still fire; only automatic responses are suppressed.
 *
 * Phrase lists are operator-maintained; no OTP phrase is built in. Smart mode
 * uses those phrases as positive signals and checks for built-in code shapes
 * near them. Exclude phrases are negative signals, so a promo/order message
 * does not get suppressed just because it contains a number.
 */
import type {
  OtpFilterConfig,
  OtpFilterDetectionMode,
  OtpFilterSensitivity,
} from "@/baileys/types";

export interface ResolvedOtpFilter {
  enabled: boolean;
  ignoredSenders: string[];
  detectionMode: OtpFilterDetectionMode;
  sensitivity: OtpFilterSensitivity;
  keywords: string[];
  excludeKeywords: string[];
}

function resolveDetectionMode(input?: OtpFilterConfig): OtpFilterDetectionMode {
  const explicit = input?.detectionMode;
  if (explicit === "keywords" || explicit === "smart") return explicit;
  // Backward-compatible migration for configs saved before Detection Mode.
  if (input?.smart === true) return "smart";
  if (input?.keywordFilter === true) return "keywords";
  return "smart";
}

const DEFAULT_SENSITIVITY: OtpFilterSensitivity = "balanced";
const SMART_THRESHOLDS: Record<OtpFilterSensitivity, number> = {
  conservative: 6,
  balanced: 5,
  aggressive: 4,
};

function uniqueLines(values: string[] | undefined, lower = false): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    const key = lower ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function resolveSensitivity(value: string | undefined): OtpFilterSensitivity {
  if (value === "conservative" || value === "aggressive") return value;
  return DEFAULT_SENSITIVITY;
}

export function resolveOtpFilter(input?: OtpFilterConfig): ResolvedOtpFilter {
  return {
    enabled: input?.enabled ?? false,
    ignoredSenders: uniqueLines(input?.ignoredSenders),
    detectionMode: resolveDetectionMode(input),
    sensitivity: resolveSensitivity(input?.sensitivity),
    keywords: uniqueLines(input?.keywords, true),
    excludeKeywords: uniqueLines(input?.excludeKeywords, true),
  };
}

function senderKeys(value: string): string[] {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/:\d+(?=@)/, "");
  const keys = new Set<string>([normalized]);
  const local = normalized.split("@")[0] ?? "";
  const digits = local.replace(/\D/g, "");
  if (digits) keys.add(digits);
  return [...keys];
}

function targetKeys(remoteJid?: string | null, participant?: string | null): string[] {
  const values = [remoteJid, participant].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return values.flatMap(senderKeys);
}

export interface OtpMatchInput {
  remoteJid?: string | null;
  participant?: string | null;
  text?: string | null;
}

export interface OtpMatchResult {
  ignored: boolean;
  reason?: "sender" | "keyword" | "smart";
  /** Smart-mode score, useful for logs and tuning without storing the code. */
  score?: number;
}

interface CodeCandidate {
  start: number;
  shape: number;
}

/** Find code-like tokens without treating every number or word as an OTP. */
function findCodeCandidates(text: string): CodeCandidate[] {
  const candidates: CodeCandidate[] = [];
  const seen = new Set<string>();
  const patterns = [
    /\b\d{4,8}\b/g,
    // Alphanumeric codes need both a digit and a letter; the lookaheads keep
    // ordinary words such as "PROMO" or "VERIFICATION" out.
    /\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{4,8}\b/gi,
    /\b\d{3}[- ]\d{3}\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0];
      const start = match.index ?? 0;
      const key = `${start}:${raw}`;
      if (seen.has(key)) {
        seen.add(key);
        continue;
      }
      const digits = raw.replace(/\D/g, "");
      const letters = raw.replace(/[^a-z]/gi, "");
      const compactLength = raw.replace(/[- ]/g, "").length;
      // Numeric codes are 4-8 digits; alphanumeric codes are 4-8 total
      // characters, so A1B2C3 must not be rejected for having only 3 digits.
      if (compactLength < 4 || compactLength > 8) continue;
      if (!digits) continue;
      if (letters.length === 0 && digits.length < 4) continue;
      seen.add(key);
      const shaped =
        (digits.length >= 6 && digits.length <= 8) || (digits.length > 0 && letters.length > 0)
          ? 1
          : 0;
      candidates.push({ start, shape: shaped });
    }
  }

  return candidates;
}

function phraseIndexes(text: string, keywords: string[]): number[] {
  const indexes: number[] = [];
  for (const keyword of keywords) {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(keyword, from);
      if (index < 0) break;
      indexes.push(index);
      from = index + keyword.length;
    }
  }
  return indexes;
}

function smartScore(text: string, filter: ResolvedOtpFilter): number {
  const phrases = phraseIndexes(text, filter.keywords);
  if (phrases.length === 0) return 0;

  // One explicit phrase is strong; extra distinct phrases add a little weight.
  let score = 3 + Math.min(phrases.length - 1, 1);

  let bestCandidateBonus = 0;
  for (const candidate of findCodeCandidates(text)) {
    const distance = Math.min(...phrases.map((index) => Math.abs(candidate.start - index)));
    if (distance > 80) continue;
    const bonus = 2 + (distance <= 40 ? 1 : 0) + candidate.shape;
    bestCandidateBonus = Math.max(bestCandidateBonus, bonus);
  }
  score += bestCandidateBonus;

  // Exclude phrases are penalties, not an automatic veto: a legitimate OTP
  // template can contain "if you did not receive..." alongside its code.
  if (filter.excludeKeywords.some((keyword) => text.includes(keyword))) {
    score -= 4;
  }

  return score;
}

export function matchOtpFilter(input: OtpMatchInput, filter: ResolvedOtpFilter): OtpMatchResult {
  if (!filter.enabled) return { ignored: false };

  const targets = targetKeys(input.remoteJid, input.participant);
  if (filter.ignoredSenders.length > 0) {
    const ignored = filter.ignoredSenders.flatMap(senderKeys).filter(Boolean);
    if (targets.some((target) => ignored.includes(target))) {
      return { ignored: true, reason: "sender" };
    }
  }

  if (filter.detectionMode === "smart") {
    const text = String(input.text ?? "").toLowerCase();
    if (!text || filter.keywords.length === 0) return { ignored: false, score: 0 };
    const score = smartScore(text, filter);
    if (score >= SMART_THRESHOLDS[filter.sensitivity]) {
      return { ignored: true, reason: "smart", score };
    }
    return { ignored: false, score };
  }

  if (filter.detectionMode === "keywords" && filter.keywords.length > 0) {
    const text = String(input.text ?? "").toLowerCase();
    if (!text) return { ignored: false };
    const excluded = filter.excludeKeywords.some((keyword) => text.includes(keyword));
    if (!excluded && filter.keywords.some((keyword) => text.includes(keyword))) {
      return { ignored: true, reason: "keyword" };
    }
  }

  return { ignored: false };
}
