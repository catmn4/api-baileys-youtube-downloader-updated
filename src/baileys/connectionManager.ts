import {
  deleteAuthState,
  getSavedSessionsWithMetadata,
  updateSessionMetadata,
} from "@/baileys/authState";
import { BaileysConnection, BaileysNotConnectedError } from "@/baileys/connection";
import type { SessionMetadata, SessionOptions } from "@/baileys/types";
import config from "@/config";
import logger from "@/lib/logger";
import { assertValidSessionId } from "@/lib/sessionId";
import { revokeApiKeysForSession } from "@/services/apiKeys";
import { errorToString } from "@/utils/validation";

/**
 * Manages all active WhatsApp sessions.
 */
class ConnectionManager {
  private connections = new Map<string, BaileysConnection>();

  /**
   * Reconnect all saved sessions on startup.
   */
  async reconnectSavedSessions(): Promise<void> {
    const saved = await getSavedSessionsWithMetadata<SessionMetadata>();

    if (saved.length === 0) {
      logger.info("No saved sessions to reconnect");
      return;
    }

    logger.info(
      "Reconnecting %d saved sessions: %o",
      saved.length,
      saved.map((s) => s.id),
    );

    for (const { id, metadata } of saved) {
      try {
        // Every persisted field must be restored here: connect() rewrites the
        // metadata file from these options, so a missing field is lost on restart.
        const connection = new BaileysConnection(id, {
          ownerId: metadata?.ownerId,
          clientName: metadata?.clientName,
          webhookUrl: metadata?.webhookUrl,
          webhookSecret: metadata?.webhookSecret,
          webhookSecretPrevious: metadata?.webhookSecretPrevious,
          webhookSecretPreviousExpiresAt: metadata?.webhookSecretPreviousExpiresAt,
          webhookEvents: metadata?.webhookEvents,
          includeMedia: metadata?.includeMedia,
          syncFullHistory: metadata?.syncFullHistory,
          autoReply: metadata?.autoReply,
          routing: metadata?.routing,
          ai: metadata?.ai,
          isReconnect: true,
          onConnectionClose: () => {
            this.connections.delete(id);
            logger.debug("Session closed: %s (active: %d)", id, this.connections.size);
          },
        });

        this.connections.set(id, connection);
        await connection.connect();
        logger.info("Reconnected session: %s", id);
      } catch (error) {
        logger.error("Failed to reconnect session %s: %s", id, errorToString(error));
      }
    }
  }

  /**
   * Create or reconnect a session.
   */
  async createSession(
    sessionId: string,
    options: SessionOptions,
  ): Promise<{ qrCode?: string; pairingCode?: string }> {
    assertValidSessionId(sessionId);
    // If session exists and is connected, return existing state
    const existing = this.connections.get(sessionId);
    if (existing?.isConnected) {
      return { qrCode: existing.qrCode ?? undefined };
    }

    // If exists but not connected, clean up
    if (existing) {
      await existing.destroy();
      this.connections.delete(sessionId);
    }

    // Enforce maximum session limit
    if (this.connections.size >= config.maxSessions) {
      throw new Error(
        `Maximum session limit (${config.maxSessions}) reached. Delete unused sessions first.`,
      );
    }

    const connection = new BaileysConnection(sessionId, {
      ...options,
      onConnectionClose: () => {
        this.connections.delete(sessionId);
        options.onConnectionClose?.();
        logger.debug("Session closed: %s (active: %d)", sessionId, this.connections.size);
      },
    });

    this.connections.set(sessionId, connection);
    const result = await connection.connect();
    logger.info("Session created: %s (active: %d)", sessionId, this.connections.size);

    return result;
  }

  /**
   * Reconnect one saved session without creating or deleting credentials.
   *
   * Managers may reconnect assigned sessions, but must not go through the
   * create endpoint (which can opt into freshAuth/delete). Metadata is restored
   * so webhook/AI/routing settings survive the reconnect.
   */
  async reconnectSession(sessionId: string): Promise<{ qrCode?: string; pairingCode?: string }> {
    assertValidSessionId(sessionId);
    const existing = this.connections.get(sessionId);
    if (existing?.isConnected) {
      return { qrCode: existing.qrCode ?? undefined };
    }

    const saved = await getSavedSessionsWithMetadata<SessionMetadata>();
    const metadata =
      saved.find((entry) => entry.id === sessionId)?.metadata ??
      existing?.getSessionMetadata() ??
      null;
    if (!metadata) {
      throw new Error(`Session "${sessionId}" has no saved auth state`);
    }

    if (existing) {
      await existing.destroy();
      this.connections.delete(sessionId);
    }

    if (this.connections.size >= config.maxSessions) {
      throw new Error(
        `Maximum session limit (${config.maxSessions}) reached. Delete unused sessions first.`,
      );
    }

    const connection = new BaileysConnection(sessionId, {
      ownerId: metadata.ownerId,
      clientName: metadata.clientName,
      webhookUrl: metadata.webhookUrl,
      webhookSecret: metadata.webhookSecret,
      webhookSecretPrevious: metadata.webhookSecretPrevious,
      webhookSecretPreviousExpiresAt: metadata.webhookSecretPreviousExpiresAt,
      webhookEvents: metadata.webhookEvents,
      includeMedia: metadata.includeMedia,
      syncFullHistory: metadata.syncFullHistory,
      autoReply: metadata.autoReply,
      routing: metadata.routing,
      ai: metadata.ai,
      isReconnect: true,
      onConnectionClose: () => {
        this.connections.delete(sessionId);
        logger.debug("Session closed: %s (active: %d)", sessionId, this.connections.size);
      },
    });

    this.connections.set(sessionId, connection);
    try {
      const result = await connection.connect();
      logger.info("Session reconnected: %s (active: %d)", sessionId, this.connections.size);
      return result;
    } catch (error) {
      this.connections.delete(sessionId);
      throw error;
    }
  }

  /**
   * Get an active connection by session ID.
   */
  getSession(sessionId: string): BaileysConnection {
    const conn = this.connections.get(sessionId);
    if (!conn) throw new BaileysNotConnectedError();
    return conn;
  }

  /**
   * Check if a session exists.
   */
  hasSession(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  /**
   * Get session status.
   */
  getSessionStatus(sessionId: string): {
    exists: boolean;
    connected: boolean;
    user: unknown;
    qrCode: string | null;
  } {
    const conn = this.connections.get(sessionId);
    return {
      exists: !!conn,
      connected: conn?.isConnected ?? false,
      user: conn?.user ?? null,
      qrCode: conn?.qrCode ?? null,
    };
  }

  /**
   * List all active sessions.
   */
  listSessions(): Array<{
    sessionId: string;
    ownerId: string;
    connected: boolean;
    user: unknown;
    webhookUrl: string;
    hasWebhookSecret: boolean;
    webhookSecretLast4: string;
    webhookEvents: string[];
    autoReply: SessionMetadata["autoReply"];
    /** Epoch ms of the newest known chat activity, or null when never seen. */
    lastActiveAt: number | null;
  }> {
    return [...this.connections.entries()].map(([id, conn]) => {
      const secret = conn.getOptions().webhookSecret || "";
      let lastActiveAt: number | null = null;
      for (const chat of conn.getStore().chats.values()) {
        const timestamp = Number(chat.conversationTimestamp || 0);
        if (timestamp > 0) {
          lastActiveAt = Math.max(lastActiveAt ?? 0, timestamp * 1000);
        }
      }
      return {
        sessionId: id,
        ownerId: conn.getOptions().ownerId || "",
        connected: conn.isConnected,
        user: conn.user,
        webhookUrl: conn.getOptions().webhookUrl || "",
        hasWebhookSecret: secret.length > 0,
        webhookSecretLast4: secret ? secret.slice(-4) : "",
        webhookEvents: conn.getOptions().webhookEvents || [],
        autoReply: conn.getOptions().autoReply,
        lastActiveAt,
      };
    });
  }

  /**
   * Delete a session and its auth state.
   */
  async deleteSession(sessionId: string): Promise<void> {
    assertValidSessionId(sessionId);
    const conn = this.connections.get(sessionId);
    if (conn) {
      // Tombstone first: close events can fire twice and would rewrite the file.
      conn.markDeleted();
      await conn.logout();
      this.connections.delete(sessionId);
    }
    await deleteAuthState(sessionId);

    // Credentials scoped to this session must not outlive it: otherwise a
    // recreated session with the same id would silently reuse an old key.
    const revokedKeys = await revokeApiKeysForSession(sessionId);
    if (revokedKeys > 0) {
      logger.info("Revoked %d API key(s) bound to deleted session %s", revokedKeys, sessionId);
    }

    logger.info("Session deleted: %s (active: %d)", sessionId, this.connections.size);
  }

  /**
   * Update runtime session settings and persist metadata.
   */
  async updateSessionSettings(sessionId: string, options: Partial<SessionOptions>): Promise<void> {
    const conn = this.connections.get(sessionId);
    if (!conn) throw new BaileysNotConnectedError();

    conn.updateOptions(options);
    await updateSessionMetadata(sessionId, conn.getSessionMetadata());
    logger.info("Session settings updated: %s", sessionId);
  }

  /**
   * Graceful shutdown — save all stores and clean up.
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down %d sessions...", this.connections.size);
    const promises = [...this.connections.values()].map((conn) => conn.destroy());
    await Promise.allSettled(promises);
    this.connections.clear();
  }
}

// Singleton
const connectionManager = new ConnectionManager();
export default connectionManager;
