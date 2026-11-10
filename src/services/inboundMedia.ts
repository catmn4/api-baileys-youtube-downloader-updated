/**
 * Describe inbound media without downloading it.
 *
 * The AI needs to know that a video/image/document exists even when it has no
 * caption; otherwise the text list is empty and the static fallback answers
 * instead. Descriptors are safe metadata, not file contents.
 */
import type { WAMessage } from "@whiskeysockets/baileys";

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

export interface MediaInfo {
  kind: MediaKind;
  mimetype?: string;
  seconds?: number;
  fileName?: string;
}

export function extractMediaInfo(message: WAMessage): MediaInfo | null {
  const content = message.message;
  if (!content) return null;

  if (content.imageMessage) {
    return {
      kind: "image",
      mimetype: content.imageMessage.mimetype ?? undefined,
    };
  }
  if (content.videoMessage) {
    return {
      kind: "video",
      mimetype: content.videoMessage.mimetype ?? undefined,
      seconds: Number(content.videoMessage.seconds || 0) || undefined,
    };
  }
  if (content.audioMessage) {
    return {
      kind: "audio",
      mimetype: content.audioMessage.mimetype ?? undefined,
      seconds: Number(content.audioMessage.seconds || 0) || undefined,
    };
  }
  if (content.documentMessage) {
    return {
      kind: "document",
      mimetype: content.documentMessage.mimetype ?? undefined,
      fileName: content.documentMessage.fileName ?? undefined,
    };
  }
  if (content.documentWithCaptionMessage?.message?.documentMessage) {
    const doc = content.documentWithCaptionMessage.message.documentMessage;
    return {
      kind: "document",
      mimetype: doc.mimetype ?? undefined,
      fileName: doc.fileName ?? undefined,
    };
  }
  if (content.stickerMessage) {
    return {
      kind: "sticker",
      mimetype: content.stickerMessage.mimetype ?? undefined,
    };
  }
  return null;
}

/** Compact, model-readable metadata line. */
export function mediaDescriptor(info: MediaInfo): string {
  const parts = [`media: ${info.kind}`];
  if (info.mimetype) parts.push(`mime: ${info.mimetype}`);
  if (info.seconds) parts.push(`duration: ${info.seconds}s`);
  if (info.fileName) parts.push(`file: ${info.fileName}`);
  return `[${parts.join(", ")}]`;
}
