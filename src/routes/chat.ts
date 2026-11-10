import type {
  AnyMessageContent,
  ChatModification,
  MessageReceiptType,
  proto,
  WAMessage,
} from "@whiskeysockets/baileys";
import { Hono } from "hono";
import { BaileysNotConnectedError } from "@/baileys/connection";
import connectionManager from "@/baileys/connectionManager";
import { downloadMediaFromMessages } from "@/baileys/helpers/downloadMedia";
import type { BroadcastMessage } from "@/baileys/types";
import { error, success } from "@/lib/response";
import { authMiddleware } from "@/middleware/auth";
import { bulkRateLimit, sendRateLimit } from "@/middleware/rateLimit";
import { sessionValidator } from "@/middleware/sessionValidator";
import {
  chatModifySchema,
  deleteMessageSchema,
  downloadMediaSchema,
  editMessageSchema,
  fetchHistorySchema,
  forwardMessageSchema,
  handoffSchema,
  onWhatsAppSchema,
  presenceSchema,
  readMessagesSchema,
  sendBulkSchema,
  sendMessageSchema,
  sendMessageStaticSchema,
  sendPollSchema,
  sendReactionSchema,
  sendReceiptsSchema,
} from "@/schemas/chat";
import {
  cancelBroadcastJob,
  createBroadcastJob,
  getBroadcastJob,
  listBroadcastJobs,
} from "@/services/broadcastQueue";
import { formatGroup, formatPhone } from "@/utils/phone";

const chatRoutes = new Hono();

chatRoutes.use("*", authMiddleware);

async function sendMessageHandler(
  sessionId: string,
  payload: {
    receiver: string;
    message: Record<string, unknown>;
    isGroup?: boolean;
    quoted?: unknown;
  },
) {
  const session = connectionManager.getSession(sessionId);
  const jid = payload.isGroup ? formatGroup(payload.receiver) : formatPhone(payload.receiver);

  // Optionally verify number exists
  if (!payload.isGroup) {
    const exists = await session.isOnWhatsApp(jid);
    if (!exists) {
      throw new Error("The receiver number is not registered on WhatsApp");
    }
  }

  return session.sendMessage(jid, payload.message as AnyMessageContent, {
    quoted: payload.quoted as WAMessage,
  });
}

/**
 * POST /chats/send
 * Static endpoint for third-party integrations. Session ID is provided in body.
 */
chatRoutes.post("/send", sendRateLimit, async (c) => {
  const parsed = sendMessageStaticSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  const { sessionId, receiver, message, isGroup, quoted } = parsed.data;

  try {
    const result = await sendMessageHandler(sessionId, { receiver, message, isGroup, quoted });
    return success(
      c,
      {
        key: result?.key,
        messageTimestamp: result?.messageTimestamp,
      },
      "Message sent successfully",
    );
  } catch (err) {
    if (err instanceof BaileysNotConnectedError) {
      return error(c, err.message, 404);
    }
    const messageText = (err as Error).message;
    if (messageText.includes("not registered on WhatsApp")) {
      return error(c, messageText, 400);
    }
    return error(c, `Failed to send message: ${messageText}`);
  }
});

/**
 * POST /chats/:sessionId/send
 * Send a message (text, image, video, audio, document, sticker, location, contact, poll).
 */
chatRoutes.post("/:sessionId/send", sessionValidator, sendRateLimit, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = sendMessageSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { receiver, message, isGroup, quoted } = parsed.data;

  try {
    const result = await sendMessageHandler(sessionId, { receiver, message, isGroup, quoted });

    return success(
      c,
      {
        key: result?.key,
        messageTimestamp: result?.messageTimestamp,
      },
      "Message sent successfully",
    );
  } catch (err) {
    if (err instanceof BaileysNotConnectedError) {
      return error(c, err.message, 404);
    }
    return error(c, `Failed to send message: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/reaction
 * Send a reaction to a message.
 */
chatRoutes.post("/:sessionId/reaction", sessionValidator, sendRateLimit, async (c) => {
  const parsed = sendReactionSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  const session = connectionManager.getSession(c.req.param("sessionId") as string);
  const { jid, messageId, text } = parsed.data;

  const reactionMessage = {
    react: {
      text,
      key: {
        remoteJid: jid,
        id: messageId,
        fromMe: false, // This will be handled by baileys automatically based on actual msg or just required structural keys
      },
    },
  };

  const result = await session.sendMessage(jid, reactionMessage);
  return success(c, result, "Reaction sent");
});

/**
 * POST /chats/:sessionId/poll
 * Send a poll message.
 */
chatRoutes.post("/:sessionId/poll", sessionValidator, sendRateLimit, async (c) => {
  const parsed = sendPollSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  const session = connectionManager.getSession(c.req.param("sessionId") as string);
  const { receiver, name, values, selectableCount } = parsed.data;

  const pollMessage = {
    poll: {
      name,
      values,
      selectableCount,
    },
  };

  const result = await session.sendMessage(receiver, pollMessage as AnyMessageContent);
  return success(c, result, "Poll sent");
});

/**
 * POST /chats/:sessionId/send-bulk

 * Send bulk messages with anti-spam delays.
 * Returns a broadcast job ID for tracking progress.
 */
chatRoutes.post("/:sessionId/send-bulk", sessionValidator, bulkRateLimit, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = sendBulkSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { messages } = parsed.data;

  try {
    const job = await createBroadcastJob(sessionId, messages as BroadcastMessage[]);
    return success(
      c,
      {
        jobId: job.id,
        total: job.total,
        status: job.status,
      },
      "Broadcast job created",
    );
  } catch (err) {
    return error(c, `Failed to create broadcast job: ${(err as Error).message}`);
  }
});

/**
 * GET /chats/:sessionId/broadcast/:jobId
 * Get broadcast job status.
 */
chatRoutes.get("/:sessionId/broadcast/:jobId", sessionValidator, (c) => {
  const jobId = c.req.param("jobId") ?? "";
  const job = getBroadcastJob(jobId);
  if (!job) return error(c, "Broadcast job not found", 404);
  return success(c, job);
});

/**
 * DELETE /chats/:sessionId/broadcast/:jobId
 * Cancel a running broadcast job.
 */
chatRoutes.delete("/:sessionId/broadcast/:jobId", sessionValidator, (c) => {
  const jobId = c.req.param("jobId") ?? "";
  const cancelled = cancelBroadcastJob(jobId);
  if (!cancelled) return error(c, "Job not found or not running", 404);
  return success(c, null, "Broadcast job cancelled");
});

/**
 * GET /chats/:sessionId/broadcast
 * List all broadcast jobs for a session.
 */
chatRoutes.get("/:sessionId/broadcast", sessionValidator, (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jobs = listBroadcastJobs(sessionId);
  return success(c, jobs);
});

/**
 * POST /chats/:sessionId/forward
 * Forward a message.
 */
chatRoutes.post("/:sessionId/forward", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = forwardMessageSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { receiver, isGroup, forward } = parsed.data;

  try {
    const session = connectionManager.getSession(sessionId);
    const jid = isGroup ? formatGroup(receiver) : formatPhone(receiver);
    const store = session.getStore();

    const messages = store.loadMessages(forward.remoteJid, 25);
    const msgToForward = messages.find((m) => m.key.id === forward.id);

    if (!msgToForward) {
      return error(c, "Message not found in store", 404);
    }

    await session.sendMessage(jid, { forward: msgToForward });
    return success(c, null, "Message forwarded successfully");
  } catch (err) {
    return error(c, `Failed to forward message: ${(err as Error).message}`);
  }
});

/**
 * DELETE /chats/:sessionId/message
 * Delete a message for everyone.
 */
chatRoutes.delete("/:sessionId/message", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = deleteMessageSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { jid, key } = parsed.data;

  try {
    const session = connectionManager.getSession(sessionId);
    await session.deleteMessage(jid, key as proto.IMessageKey & { id: string });
    return success(c, null, "Message deleted successfully");
  } catch (err) {
    return error(c, `Failed to delete message: ${(err as Error).message}`);
  }
});

/**
 * PATCH /chats/:sessionId/message
 * Edit a previously sent message.
 */
chatRoutes.patch("/:sessionId/message", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = editMessageSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { jid, key, messageContent } = parsed.data;

  try {
    const session = connectionManager.getSession(sessionId);
    const result = await session.editMessage(
      jid,
      key as proto.IMessageKey,
      messageContent as AnyMessageContent,
    );
    return success(
      c,
      {
        key: result?.key,
        messageTimestamp: result?.messageTimestamp,
      },
      "Message edited successfully",
    );
  } catch (err) {
    return error(c, `Failed to edit message: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/read
 * Mark messages as read.
 */
chatRoutes.post("/:sessionId/read", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = readMessagesSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  try {
    const session = connectionManager.getSession(sessionId);
    await session.readMessages(parsed.data.keys as proto.IMessageKey[]);
    return success(c, null, "Messages marked as read");
  } catch (err) {
    return error(c, `Failed to read messages: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/presence
 * Send presence update (typing, recording, etc.).
 */
chatRoutes.post("/:sessionId/presence", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = presenceSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { type, jid } = parsed.data;

  try {
    const session = connectionManager.getSession(sessionId);
    await session.sendPresenceUpdate(type, jid);
    return success(c, null, "Presence updated");
  } catch (err) {
    return error(c, `Failed to send presence: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/on-whatsapp
 * Check if phone numbers are registered on WhatsApp.
 */
chatRoutes.post("/:sessionId/on-whatsapp", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = onWhatsAppSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { jids } = parsed.data;

  try {
    const session = connectionManager.getSession(sessionId);
    const results = await session.onWhatsApp(...jids);
    return success(c, results);
  } catch (err) {
    return error(c, `Failed to check WhatsApp status: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/chat-modify
 * Chat modification (mark read/unread, archive, etc.).
 */
chatRoutes.post("/:sessionId/chat-modify", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = chatModifySchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  try {
    const session = connectionManager.getSession(sessionId);
    await session.chatModify(parsed.data.mod as ChatModification, parsed.data.jid);
    return success(c, null, "Chat modified successfully");
  } catch (err) {
    return error(c, `Failed to modify chat: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/fetch-history
 * Fetch message history.
 */
chatRoutes.post("/:sessionId/fetch-history", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = fetchHistorySchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  try {
    const session = connectionManager.getSession(sessionId);
    await session.fetchMessageHistory(
      parsed.data.count,
      parsed.data.oldestMsgKey as proto.IMessageKey,
      parsed.data.oldestMsgTimestamp,
    );
    return success(c, null, "Message history fetch initiated");
  } catch (err) {
    return error(c, `Failed to fetch history: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/send-receipts
 * Send message receipts.
 */
chatRoutes.post("/:sessionId/send-receipts", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = sendReceiptsSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  try {
    const session = connectionManager.getSession(sessionId);
    await session.sendReceipts(
      parsed.data.keys as proto.IMessageKey[],
      parsed.data.type as MessageReceiptType,
    );
    return success(c, null, "Receipts sent");
  } catch (err) {
    return error(c, `Failed to send receipts: ${(err as Error).message}`);
  }
});

/**
 * GET /chats/:sessionId/list
 * Get chat list from in-memory store.
 */
chatRoutes.get("/:sessionId/list", sessionValidator, (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const isGroup = c.req.query("isGroup") === "true";

  try {
    const session = connectionManager.getSession(sessionId);
    const chatList = session.getStore().getChatList(isGroup);
    return success(c, chatList);
  } catch (err) {
    return error(c, `Failed to get chat list: ${(err as Error).message}`);
  }
});

/**
 * GET /chats/:sessionId/conversation/:jid
 * Get messages from a specific chat conversation.
 */
chatRoutes.get("/:sessionId/conversation/:jid", sessionValidator, (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = c.req.param("jid") ?? "";
  const limit = Math.min(Math.max(Number(c.req.query("limit") || "25"), 1), 500);

  try {
    const session = connectionManager.getSession(sessionId);
    const messages = session.getStore().loadMessages(jid, limit);
    return success(c, messages);
  } catch (err) {
    return error(c, `Failed to get conversation: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/download-media
 * Download media from a stored message.
 */
chatRoutes.post("/:sessionId/download-media", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = downloadMediaSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { remoteJid, messageId } = parsed.data;

  try {
    const session = connectionManager.getSession(sessionId);
    const msg = session.getStore().getMessage(remoteJid, messageId);
    if (!msg) {
      return error(c, "Message not found in store", 404);
    }

    const media = await downloadMediaFromMessages([msg], { includeBase64: true });
    return success(c, media);
  } catch (err) {
    return error(c, `Failed to download media: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/handoff
 *
 * AI -> human takeover. Pausing a conversation stops the AI from answering it
 * for `pauseMinutes` (default 30, clamped 1..1440), even while the AI window is
 * open, so the agent can take over without the bot talking over them.
 */
chatRoutes.post("/:sessionId/handoff", sessionValidator, async (c) => {
  const parsed = handoffSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  try {
    const session = connectionManager.getSession(c.req.param("sessionId") as string);
    const reason = parsed.data.reason ?? "ai_handoff";
    const result = session.pauseAi(
      parsed.data.conversationId,
      (parsed.data.pauseMinutes ?? 30) * 60_000,
      reason,
    );
    return success(c, { ...result, reason }, "AI paused for this conversation");
  } catch (err) {
    return error(c, (err as Error).message, 404);
  }
});

export default chatRoutes;
