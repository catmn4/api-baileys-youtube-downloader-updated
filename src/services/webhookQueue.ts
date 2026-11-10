import config from "@/config";

/**
 * Global Webhook Queue to prevent memory leaks and EMFILE errors
 * during traffic spikes or when the webhook server is slow/down.
 */

class ConcurrencyQueue {
  private concurrency: number;
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  async add<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  get pending() {
    return this.queue.length;
  }
}

// Allow up to concurrent webhook delivery fetches globally.
// This prevents NodeJS from crashing with EMFILE or OOM during massive spikes.
// Can be customized via WEBHOOK_CONCURRENCY in .env
export const webhookQueue = new ConcurrencyQueue(config.webhook.concurrency);

/**
 * Token-bucket rate limiter PER RECEIVER URL.
 *
 * When many events fire for the same webhook endpoint (e.g. a busy chat with
 * a burst of messages.update), the global concurrency queue alone does not
 * stop us from hammering one third-party server with a flood of requests —
 * which can get our IP rate-limited or banned by the receiver.
 *
 * Design:
 * - One logical bucket per URL, capacity `ratePerMin` tokens, refilled
 *   continuously (ratePerMin tokens per 60s).
 * - waitForSlot() resolves when a token is available; if the bucket is empty
 *   it waits until the next refill, bounded by maxWaitMs. On timeout it
 *   proceeds anyway (fail-open: we never drop events, only delay them).
 * - Buckets are evicted after `idleTtlMs` of inactivity so long-lived
 *   processes do not accumulate unbounded state for many distinct URLs.
 *
 * Enabled only when WEBHOOK_RATE_PER_MIN > 0; default 0 = disabled (legacy).
 */
class PerUrlRateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number; lastUsed: number }>();
  private readonly ratePerMin: number;
  private readonly maxWaitMs: number;
  private readonly idleTtlMs = 5 * 60 * 1000;

  constructor(ratePerMin: number, maxWaitMs: number) {
    this.ratePerMin = ratePerMin;
    this.maxWaitMs = maxWaitMs;
  }

  get enabled() {
    return this.ratePerMin > 0;
  }

  private bucketFor(url: string) {
    const now = Date.now();
    let bucket = this.buckets.get(url);
    if (!bucket) {
      bucket = { tokens: this.ratePerMin, lastRefill: now, lastUsed: now };
      this.buckets.set(url, bucket);
      return bucket;
    }
    // Refill continuously based on elapsed time.
    const elapsedMs = now - bucket.lastRefill;
    if (elapsedMs > 0) {
      const refill = (elapsedMs / 60000) * this.ratePerMin;
      bucket.tokens = Math.min(this.ratePerMin, bucket.tokens + refill);
      bucket.lastRefill = now;
    }
    bucket.lastUsed = now;
    return bucket;
  }

  private sweepIdle() {
    const now = Date.now();
    for (const [url, b] of this.buckets) {
      if (now - b.lastUsed > this.idleTtlMs) this.buckets.delete(url);
    }
  }

  /**
   * Wait until a token is available (or maxWaitMs elapses). Resolves with the
   * number of ms actually waited. Callers should then proceed to send.
   */
  async waitForSlot(url: string): Promise<number> {
    if (!this.enabled) return 0;
    const bucket = this.bucketFor(url);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    // Bucket empty — wait for the next refill interval, bounded.
    const started = Date.now();
    while (Date.now() - started < this.maxWaitMs) {
      await new Promise((r) => setTimeout(r, 250));
      const b = this.bucketFor(url); // refills as time passes
      if (b.tokens >= 1) {
        b.tokens -= 1;
        break;
      }
    }
    this.sweepIdle();
    return Date.now() - started;
  }

  get stats() {
    return { buckets: this.buckets.size, ratePerMin: this.ratePerMin };
  }
}

export const webhookRateLimiter = new PerUrlRateLimiter(
  config.webhook.ratePerMin,
  config.webhook.rateMaxWaitMs,
);

/**
 * Per-URL circuit breaker.
 *
 * Problem: when a receiver is down, every event still burns N retry attempts
 * against a dead endpoint (timeouts, backoff sleeps) before failing — wasting
 * queue slots and hammering the target.
 *
 * Design:
 * - Track consecutive failures per URL. On success the counter resets.
 * - After `failureThreshold` consecutive failures the circuit opens for
 *   `resetMs`; while open, beforeSend() returns false and the caller skips
 *   the network call (event is logged + dead-lettered when enabled).
 * - After the cooldown a single probe delivery is allowed (half-open); if it
 *   succeeds the circuit closes, if it fails it reopens.
 * - Enabled only when failureThreshold > 0 (WEBHOOK_CIRCUIT_FAILURES).
 *   Unlike the rate limiter this defaults ON (5 failures / 30s reset) — it
 *   never drops events permanently, only pauses a dead endpoint.
 */
class PerUrlCircuitBreaker {
  private state = new Map<string, { failures: number; openUntil: number; halfOpen: boolean }>();
  private readonly failureThreshold: number;
  private readonly resetMs: number;

  constructor(failureThreshold: number, resetMs: number) {
    this.failureThreshold = failureThreshold;
    this.resetMs = resetMs;
  }

  get enabled() {
    return this.failureThreshold > 0;
  }

  /**
   * Ask whether a delivery to `url` may proceed right now. Returns false when
   * the circuit is open (delivery should be skipped/logged).
   */
  beforeSend(url: string): boolean {
    if (!this.enabled) return true;
    const now = Date.now();
    const entry = this.state.get(url);
    if (!entry) return true;
    if (entry.openUntil === 0) return true; // closed
    if (now < entry.openUntil) return false; // still cooling down
    // Cooldown elapsed — allow a single half-open probe delivery.
    entry.halfOpen = true;
    return true;
  }

  /** Record a successful delivery; closes/resets the circuit for this URL. */
  recordSuccess(url: string) {
    if (!this.enabled) return;
    const entry = this.state.get(url);
    if (!entry) return;
    entry.failures = 0;
    entry.openUntil = 0;
    entry.halfOpen = false;
  }

  /** Record a failed delivery; opens the circuit after the threshold. */
  recordFailure(url: string) {
    if (!this.enabled) return;
    const now = Date.now();
    const entry = this.state.get(url) ?? { failures: 0, openUntil: 0, halfOpen: false };
    // A half-open probe that failed reopens immediately.
    if (entry.halfOpen) {
      entry.openUntil = now + this.resetMs;
      entry.halfOpen = false;
    }
    entry.failures += 1;
    if (entry.failures >= this.failureThreshold && entry.openUntil === 0) {
      entry.openUntil = now + this.resetMs;
    }
    this.state.set(url, entry);
  }

  get stats() {
    let open = 0;
    for (const e of this.state.values()) {
      if (e.openUntil > Date.now()) open += 1;
    }
    return { urls: this.state.size, open, threshold: this.failureThreshold, resetMs: this.resetMs };
  }
}

export const webhookCircuitBreaker = new PerUrlCircuitBreaker(
  config.webhook.circuitFailures,
  config.webhook.circuitResetMs,
);
