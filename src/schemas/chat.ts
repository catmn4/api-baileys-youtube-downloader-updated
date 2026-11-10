/**
 * Zod Validation Schemas — Chat Routes
 */
import { z } from "zod";

export const sendMessageSchema = z.object({
  receiver: z.string().min(1, "Receiver is required"),
  message: z
    .record(z.string(), z.unknown())
    .refine((obj) => Object.keys(obj).length > 0, "Message content is required"),
  isGroup: z.boolean().optional().default(false),
  quoted: z.any().optional(),
});

export const sendMessageStaticSchema = sendMessageSchema.extend({
  sessionId: z.string().min(1, "Session ID is required"),
});

export const sendBulkSchema = z.object({
  messages: z
    .array(
      z.object({
        receiver: z.string().min(1, "Receiver is required"),
        message: z.record(z.string(), z.unknown()),
        delay: z.number().positive().optional(),
      }),
    )
    .min(1, "At least one message is required")
    .max(1000, "Maximum 1000 messages per broadcast"),
});

export const forwardMessageSchema = z.object({
  receiver: z.string().min(1, "Receiver is required"),
  isGroup: z.boolean().optional().default(false),
  forward: z.object({
    remoteJid: z.string().min(1),
    id: z.string().min(1),
  }),
});

export const deleteMessageSchema = z.object({
  jid: z.string().min(1, "JID is required"),
  key: z.object({
    remoteJid: z.string().optional(),
    fromMe: z.boolean().optional(),
    id: z.string().min(1),
    participant: z.string().optional(),
  }),
});

export const editMessageSchema = z.object({
  jid: z.string().min(1, "JID is required"),
  key: z.object({
    remoteJid: z.string().optional(),
    fromMe: z.boolean().optional(),
    id: z.string().min(1),
    participant: z.string().optional(),
  }),
  messageContent: z.record(z.string(), z.unknown()),
});

export const readMessagesSchema = z.object({
  keys: z
    .array(
      z.object({
        remoteJid: z.string().optional(),
        fromMe: z.boolean().optional(),
        id: z.string().min(1),
        participant: z.string().optional(),
      }),
    )
    .min(1, "At least one message key is required"),
});

export const presenceSchema = z.object({
  type: z.enum(["available", "unavailable", "composing", "recording", "paused"]),
  jid: z.string().optional(),
});

export const onWhatsAppSchema = z.object({
  jids: z
    .array(z.string().min(1))
    .min(1, "At least one JID is required")
    .max(500, "Maximum 500 JIDs per check"),
});

export const chatModifySchema = z.object({
  mod: z.record(z.string(), z.unknown()),
  jid: z.string().min(1, "JID is required"),
});

export const fetchHistorySchema = z.object({
  count: z.number().int().positive().max(1000),
  oldestMsgKey: z.object({
    remoteJid: z.string().optional(),
    fromMe: z.boolean().optional(),
    id: z.string().min(1),
  }),
  oldestMsgTimestamp: z.number(),
});

export const sendReceiptsSchema = z.object({
  keys: z
    .array(
      z.object({
        remoteJid: z.string().optional(),
        fromMe: z.boolean().optional(),
        id: z.string().min(1),
      }),
    )
    .min(1),
  type: z.string().optional().default("read"),
});

export const downloadMediaSchema = z.object({
  remoteJid: z.string().min(1, "Remote JID is required"),
  messageId: z.string().min(1, "Message ID is required"),
});

export const sendReactionSchema = z.object({
  jid: z.string().min(1, "JID is required"),
  messageId: z.string().min(1, "Message ID is required"),
  text: z.string().min(1, "Reaction text/emoji is required"),
});

export const sendPollSchema = z.object({
  receiver: z.string().min(1, "Receiver is required"),
  name: z.string().min(1, "Poll name is required"),
  values: z.array(z.string()).min(2, "At least two options are required"),
  selectableCount: z.number().int().positive().optional().default(1),
});

/** AI -> human takeover request. */
export const handoffSchema = z
  .object({
    conversationId: z.string().min(5, "conversationId is required"),
    reason: z.string().max(200).optional(),
    pauseMinutes: z.number().int().min(1).max(1440).optional(),
  })
  .strict();
