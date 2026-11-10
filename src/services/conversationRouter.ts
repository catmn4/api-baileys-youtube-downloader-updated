/**
 * Per-conversation batching and human-pause state for the AI agent.
 *
 * Two behaviours, both timer-driven (never polled):
 *
 * 1. Debounce — inbound texts are collected and forwarded once the chat has
 *    been idle for `batchIdleMs`, capped by `batchMaxWaitMs` from the first
 *    message and by `maxBatchMessages`. A new message resets the idle timer.
 * 2. Human pause — after human activity the conversation stays human-owned
 *    until `pausedUntil`. Messages keep accumulating meanwhile; when the pause
 *    expires the backlog is flushed as a single prompt.
 *
 * There is exactly one armed timer per conversation. `epoch` invalidates timers
 * from a previous state, so a stale callback can never fire a reply.
 */
import type { WAMessage } from "@whiskeysockets/baileys";
import type { AgentReplyResult } from "@/services/aiAgent";
import type { ResolvedRouting } from "@/services/routing";

/** Minimal logger surface used by the router. */
export interface RouterLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export interface RouterGeneration {
  ok: boolean;
  text?: string | null;
  error?: string;
}

export interface ConversationRouterOptions {
  sessionId: string;
  /** Routing config resolved at call time (config may change at runtime). */
  getRouting: () => ResolvedRouting;
  /** True when the AI may answer right now (enabled, window open, configured). */
  isAiEligible: () => boolean;
  /** Generate a reply for the accumulated texts. */
  generateReply: (input: {
    conversationId: string;
    texts: string[];
    /** Image messages from this batch, for opt-in vision. */
    media?: WAMessage[];
  }) => Promise<RouterGeneration | AgentReplyResult>;
  /** Deliver a generated text back to the chat. */
  deliver: (conversationId: string, text: string, lastMessage: WAMessage) => Promise<void>;
  /** Called when generation fails, so the caller can send the static fallback. */
  onFailure?: (conversationId: string, lastMessage: WAMessage) => Promise<void>;
  logger: RouterLogger;
}

interface ConversationState {
  texts: string[];
  media: WAMessage[];
  lastMessage: WAMessage | null;
  firstAt: number;
  pausedUntil: number;
  /** While set, inbound messages are ignored (abuse control). */
  mutedUntil: number;
  timer: ReturnType<typeof setTimeout> | null;
  epoch: number;
  flushing: boolean;
}

export class ConversationRouter {
  private readonly options: ConversationRouterOptions;
  private readonly conversations = new Map<string, ConversationState>();

  constructor(options: ConversationRouterOptions) {
    this.options = options;
  }

  /** Queue inbound texts (and image messages for vision) for a conversation. */
  enqueue(
    conversationId: string,
    texts: string[],
    lastMessage: WAMessage,
    media: WAMessage[] = [],
  ): void {
    if (texts.length === 0) return;
    const routing = this.options.getRouting();
    const state = this.ensure(conversationId);
    const now = Date.now();

    // Muted: ignore everything until the mute expires. Nothing is queued, so
    // no backlog is answered later — a fresh message after the mute resumes.
    if (state.mutedUntil > now) {
      this.options.logger.debug(
        "[%s] Dropping message for %s during mute",
        this.options.sessionId,
        conversationId,
      );
      return;
    }

    state.texts.push(...texts);
    state.media.push(...media);
    state.lastMessage = lastMessage;
    if (state.firstAt === 0) state.firstAt = now;
    if (state.texts.length > routing.maxBatchMessages) {
      state.texts = state.texts.slice(-routing.maxBatchMessages);
    }
    if (state.media.length > 2) {
      state.media = state.media.slice(-2);
    }

    if (state.pausedUntil > now) {
      this.arm(conversationId, state.pausedUntil);
      return;
    }

    // Idle debounce, but never beyond batchMaxWaitMs from the first message.
    const idleTarget = now + routing.batchIdleMs;
    const hardTarget = state.firstAt + routing.batchMaxWaitMs;
    this.arm(conversationId, Math.min(idleTarget, hardTarget));

    if (state.texts.length >= routing.maxBatchMessages) {
      this.flush(conversationId);
    }
  }

  /**
   * Keep the conversation human-owned until `until` (absolute epoch ms).
   * A shorter/older deadline never shortens an active pause.
   */
  pause(conversationId: string, until: number, reason = "human_active"): void {
    const state = this.ensure(conversationId);
    if (until <= state.pausedUntil) return;
    state.pausedUntil = until;
    state.epoch += 1;
    this.options.logger.info(
      "[%s] AI paused for %s until %s (%s)",
      this.options.sessionId,
      conversationId,
      new Date(until).toISOString(),
      reason,
    );
    if (state.texts.length > 0) this.arm(conversationId, state.pausedUntil);
  }

  /** True while the conversation is human-owned. */
  isPaused(conversationId: string): boolean {
    const state = this.conversations.get(conversationId);
    return Boolean(state && state.pausedUntil > Date.now());
  }

  /**
   * Ignore every inbound message for this conversation until `until`. Pending
   * texts are discarded: a human/abuser already saw them, and answering them
   * after the mute would be a stale reply. A new message afterwards resumes
   * normal handling.
   */
  mute(conversationId: string, until: number): void {
    const state = this.ensure(conversationId);
    state.mutedUntil = Math.max(state.mutedUntil, until);
    state.texts = [];
    state.media = [];
    state.firstAt = 0;
    state.epoch += 1;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.options.logger.warn(
      "[%s] Muted %s until %s",
      this.options.sessionId,
      conversationId,
      new Date(state.mutedUntil).toISOString(),
    );
  }

  /** True while the conversation is muted. */
  isMuted(conversationId: string): boolean {
    const state = this.conversations.get(conversationId);
    return Boolean(state && state.mutedUntil > Date.now());
  }

  /** Drop all timers and pending state (session shutdown). */
  dispose(): void {
    for (const state of this.conversations.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.texts = [];
      state.media = [];
    }
    this.conversations.clear();
  }

  private ensure(conversationId: string): ConversationState {
    const existing = this.conversations.get(conversationId);
    if (existing) return existing;
    const created: ConversationState = {
      texts: [],
      media: [],
      lastMessage: null,
      firstAt: 0,
      pausedUntil: 0,
      mutedUntil: 0,
      timer: null,
      epoch: 0,
      flushing: false,
    };
    this.conversations.set(conversationId, created);
    return created;
  }

  /** Arm (or re-arm) the single timer for this conversation. */
  private arm(conversationId: string, at: number): void {
    const state = this.ensure(conversationId);
    if (state.timer) clearTimeout(state.timer);
    const epoch = state.epoch;
    const delay = Math.max(0, at - Date.now());
    state.timer = setTimeout(() => {
      if (epoch !== state.epoch) return; // stale timer
      const routing = this.options.getRouting();
      const now = Date.now();
      if (state.pausedUntil > now) {
        this.arm(conversationId, state.pausedUntil);
        return;
      }
      if (state.firstAt > 0 && now < state.firstAt + routing.batchIdleMs) {
        // A message arrived after the timer was armed: wait for the idle gap.
        this.arm(conversationId, state.firstAt + routing.batchIdleMs);
        return;
      }
      void this.flush(conversationId);
    }, delay);
    // Do not keep the process alive because of a pending reply timer.
    if (typeof state.timer === "object" && "unref" in state.timer) state.timer.unref();
  }

  private async flush(conversationId: string): Promise<void> {
    const state = this.conversations.get(conversationId);
    if (!state || state.flushing) return;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.texts.length === 0) {
      this.conversations.delete(conversationId);
      return;
    }
    if (state.pausedUntil > Date.now()) {
      this.arm(conversationId, state.pausedUntil);
      return;
    }
    if (!this.options.isAiEligible()) {
      this.options.logger.debug(
        "[%s] AI not eligible for %s — dropping %d pending message(s)",
        this.options.sessionId,
        conversationId,
        state.texts.length,
      );
      state.texts = [];
      state.media = [];
      state.firstAt = 0;
      return;
    }

    state.flushing = true;
    const texts = [...state.texts];
    const media = [...state.media];
    const lastMessage = state.lastMessage;
    state.texts = [];
    state.media = [];
    state.firstAt = 0;

    try {
      const result = await this.options.generateReply({ conversationId, texts, media });
      if (!result.ok) {
        this.options.logger.warn(
          "[%s] AI reply failed for %s: %s",
          this.options.sessionId,
          conversationId,
          result.error ?? "unknown error",
        );
        if (this.options.onFailure && lastMessage) {
          try {
            await this.options.onFailure(conversationId, lastMessage);
          } catch (error) {
            this.options.logger.warn(
              "[%s] Fallback delivery failed for %s: %s",
              this.options.sessionId,
              conversationId,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        return;
      }
      const text = result.text?.trim();
      if (!text) return; // dispatched elsewhere (webhook driver) or empty
      if (lastMessage) await this.options.deliver(conversationId, text, lastMessage);
    } catch (error) {
      this.options.logger.warn(
        "[%s] AI delivery failed for %s: %s",
        this.options.sessionId,
        conversationId,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      state.flushing = false;
      if (state.texts.length === 0 && state.pausedUntil <= Date.now()) {
        this.conversations.delete(conversationId);
      }
    }
  }
}
