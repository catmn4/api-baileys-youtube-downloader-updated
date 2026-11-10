/**
 * Validation for the unified send endpoint.
 *
 * One shape for third-party integrations: pick a session by id or phone, a
 * receiver, a type, and the matching content fields.
 */
import { z } from "zod";

export const MESSAGE_TYPES = ["text", "image", "document", "location"] as const;

export const unifiedSendSchema = z
  .object({
    /** Session id (`ROG8`) or the WhatsApp number bound to it. */
    from: z.string().trim().min(1, "from is required"),
    /** Phone number, JID, or group id when isGroup is true. */
    receiver: z.string().trim().min(1, "receiver is required"),
    /** Message kind; text is the default. */
    type: z.enum(MESSAGE_TYPES).default("text"),
    /** Text body, or the caption for media types. */
    messages: z.string().max(65536).optional(),
    /** Required for image/document. */
    media: z
      .object({
        url: z.string().url("media.url must be an absolute URL"),
        filename: z.string().trim().min(1).optional(),
        mimetype: z.string().trim().min(1).optional(),
      })
      .optional(),
    /** Required for location. */
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        name: z.string().trim().optional(),
        address: z.string().trim().optional(),
      })
      .optional(),
    /** Force group semantics when the receiver is not an @g.us JID. */
    isGroup: z.boolean().optional().default(false),
    /** Optional message to quote. */
    quoted: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "text" && !value.messages?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["messages"],
        message: "messages is required for text messages",
      });
    }
    if ((value.type === "image" || value.type === "document") && !value.media?.url) {
      ctx.addIssue({
        code: "custom",
        path: ["media", "url"],
        message: `media.url is required for ${value.type} messages`,
      });
    }
    if (value.type === "location" && !value.location) {
      ctx.addIssue({
        code: "custom",
        path: ["location"],
        message: "location is required for location messages",
      });
    }
  });

export type UnifiedSendInput = z.infer<typeof unifiedSendSchema>;

/**
 * JSON Schema for LLM tool definitions and external validators.
 *
 * Conditional requirements mirror the Zod refinements above: `type` defaults to
 * text, so an omitted type behaves like the "text" branch.
 */
export const unifiedSendJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "UnifiedSendRequest",
  description:
    "POST /api/v1/messages — send text, image, document or location from one WhatsApp session.",
  type: "object",
  additionalProperties: false,
  required: ["from", "receiver"],
  properties: {
    from: {
      type: "string",
      description: "Session id (e.g. ROG8) or the phone number bound to that session.",
      example: "ROG8",
    },
    receiver: {
      type: "string",
      description: "Phone number in international digits, a JID, or a group id ending in @g.us.",
      example: "628123456789",
    },
    type: {
      type: "string",
      enum: ["text", "image", "document", "location"],
      default: "text",
      description: "Message kind. Omit for text.",
    },
    messages: {
      type: "string",
      maxLength: 65536,
      description: "Text body, or the caption for image/document.",
      example: "Halo, ini pesan dari bot.",
    },
    media: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      description: "Required for image and document.",
      properties: {
        url: { type: "string", format: "uri", example: "https://example.com/file.pdf" },
        filename: { type: "string", example: "invoice.pdf" },
        mimetype: { type: "string", example: "application/pdf" },
      },
    },
    location: {
      type: "object",
      additionalProperties: false,
      required: ["latitude", "longitude"],
      description: "Required for location.",
      properties: {
        latitude: { type: "number", minimum: -90, maximum: 90, example: -6.2 },
        longitude: { type: "number", minimum: -180, maximum: 180, example: 106.8 },
        name: { type: "string", example: "Kantor" },
        address: { type: "string", example: "Jl. Contoh 1" },
      },
    },
    isGroup: {
      type: "boolean",
      default: false,
      description: "Force group semantics when receiver is not an @g.us JID.",
    },
  },
  oneOf: [
    { not: { required: ["type"] }, required: ["messages"] },
    { properties: { type: { const: "text" } }, required: ["type", "messages"] },
    { properties: { type: { const: "image" } }, required: ["type", "media"] },
    { properties: { type: { const: "document" } }, required: ["type", "media"] },
    { properties: { type: { const: "location" } }, required: ["type", "location"] },
  ],
} as const;
