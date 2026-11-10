export function asyncSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Human-like delay distribution — mix of short typical gaps with occasional
 * longer "pauses", avoiding the perfectly-uniform cadence of an automated
 * sender:
 *   - 70%: short human-ish gap (lower part of the range, still >= lo)
 *   - 20%: full-range random
 *   - 10%: occasional long pause (1.5x–3x hi) — feels like the sender paused
 */
export function humanDelay(lo: number, hi: number): number {
  const r = Math.random();
  if (r < 0.7) {
    // 70%: short, human-ish gap (lower half of range, still >= lo)
    const mid = lo + (hi - lo) * 0.45;
    return Math.floor(lo + Math.random() * (mid - lo));
  }
  if (r < 0.9) {
    // 20%: full-range random
    return randomDelay(lo, hi);
  }
  // 10%: occasional long pause (1.5x–3x hi) — feels like the sender got busy
  return Math.floor(hi * 1.5 + Math.random() * hi * 1.5);
}

/**
 * Pick a delay honoring the caller's chosen distribution. When `human` is
 * requested the human-like distribution is used; otherwise plain uniform.
 */
export function distributedDelay(
  distribution: "uniform" | "human",
  lo: number,
  hi: number,
): number {
  return distribution === "human" ? humanDelay(lo, hi) : randomDelay(lo, hi);
}
