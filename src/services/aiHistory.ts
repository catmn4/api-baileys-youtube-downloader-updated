/**
 * History selection for the AI prompt.
 *
 * Kept pure so the limits are testable without a WhatsApp connection: callers
 * map stored messages to entries, and this decides what reaches the model.
 */
export interface HistoryEntry {
  text: string;
  fromMe: boolean;
  /** Unix epoch milliseconds. */
  timestamp: number;
}

export interface HistoryLimits {
  /** Hard cap on messages kept (oldest dropped first). */
  maxMessages: number;
  /** Drop anything older than this many milliseconds. 0 disables the age cap. */
  maxAgeMs: number;
  /** Character budget for the whole history block. 0 disables the budget. */
  maxChars: number;
  /** Injectable clock for tests. */
  now?: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function selectHistory(entries: HistoryEntry[], limits: HistoryLimits): ChatTurn[] {
  const now = limits.now ?? Date.now();
  const cutoff = limits.maxAgeMs > 0 ? now - limits.maxAgeMs : Number.NEGATIVE_INFINITY;

  const fresh = entries
    .filter((entry) => entry.text.length > 0 && entry.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp);

  // Walk from the newest backwards so the character budget keeps recent turns.
  const kept: HistoryEntry[] = [];
  let chars = 0;
  for (let index = fresh.length - 1; index >= 0; index -= 1) {
    const entry = fresh[index];
    if (!entry) continue;
    if (kept.length >= limits.maxMessages) break;

    const cost = entry.text.length;
    if (limits.maxChars > 0 && kept.length > 0 && chars + cost > limits.maxChars) break;

    // Always keep the newest turn, truncated if it alone exceeds the budget.
    const content =
      limits.maxChars > 0 && kept.length === 0 && cost > limits.maxChars
        ? entry.text.slice(0, limits.maxChars)
        : entry.text;

    kept.push({ ...entry, text: content });
    chars += content.length;
  }

  // kept is newest-first; emit oldest-first without mutating it.
  return kept.map((_, offset) => {
    const entry = kept[kept.length - 1 - offset];
    return { role: entry.fromMe ? ("assistant" as const) : ("user" as const), content: entry.text };
  });
}
