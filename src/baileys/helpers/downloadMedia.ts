import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  downloadContentFromMessage,
  downloadMediaMessage,
  type MediaType,
  type proto,
  type WAMessage,
} from "@whiskeysockets/baileys";
import logger, { baileysLogger } from "@/lib/logger";
import { errorToString } from "@/utils/validation";

type MediaMessage =
  | proto.Message.IImageMessage
  | proto.Message.IAudioMessage
  | proto.Message.IVideoMessage
  | proto.Message.IDocumentMessage;

const MEDIA_DIR = join(process.cwd(), "media");

function ensureMediaDir() {
  if (!existsSync(MEDIA_DIR)) {
    mkdirSync(MEDIA_DIR, { recursive: true });
  }
}

/**
 * Extract media type and message from a WAMessage.
 */
function extractMediaMessage(message: proto.IMessage): {
  mediaMessage: MediaMessage | null;
  mediaType: MediaType | null;
  mediaKey: string | null;
} {
  const mediaMapping: [keyof proto.IMessage, MediaType][] = [
    ["imageMessage", "image"],
    ["stickerMessage", "sticker"],
    ["videoMessage", "video"],
    ["audioMessage", "audio"],
    ["documentMessage", "document"],
    ["documentWithCaptionMessage", "document"],
  ];

  for (const [field, type] of mediaMapping) {
    if (message[field]) {
      const mediaMsg =
        field === "documentWithCaptionMessage"
          ? (message[field] as proto.Message.IFutureProofMessage)?.message?.documentMessage
          : message[field];
      return {
        mediaMessage: mediaMsg as MediaMessage,
        mediaType: type,
        mediaKey: field,
      };
    }
  }

  return { mediaMessage: null, mediaType: null, mediaKey: null };
}

async function streamToBuffer(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Download media from messages and optionally save to disk.
 * Returns a map of messageId -> base64 content.
 */
export async function downloadMediaFromMessages(
  messages: WAMessage[],
  options?: { includeBase64?: boolean },
): Promise<Record<string, string> | null> {
  const downloadedMedia: Record<string, string> = {};
  ensureMediaDir();

  for (const { key, message } of messages) {
    if (!key.id || !message) continue;

    const { mediaMessage, mediaType } = extractMediaMessage(message);
    if (!mediaMessage || !mediaType) continue;

    try {
      const stream = await downloadContentFromMessage(mediaMessage, mediaType);
      const fileBuffer = await streamToBuffer(stream);

      if (options?.includeBase64) {
        downloadedMedia[key.id] = fileBuffer.toString("base64");
      }

      // Save to disk asynchronously to prevent blocking event loop on large files
      const filePath = join(MEDIA_DIR, key.id);
      await writeFile(filePath, fileBuffer);
    } catch (error) {
      logger.error("Failed to download media: %s", errorToString(error));
    }
  }

  return Object.keys(downloadedMedia).length > 0 ? downloadedMedia : null;
}

/**
 * Get media from a specific stored message (for on-demand download).
 */
export async function getMessageMedia(
  message: WAMessage,
  reuploadRequest?: (msg: WAMessage) => Promise<WAMessage>,
): Promise<{
  messageType: string;
  fileName: string;
  caption: string;
  size: { fileLength: number | Long | null | undefined; height: number; width: number };
  mimetype: string;
  base64: string;
} | null> {
  if (!message.message) return null;

  const messageType = Object.keys(message.message)[0];
  const mediaMessage = (message.message as Record<string, unknown>)[messageType] as Record<
    string,
    unknown
  >;
  if (!mediaMessage) return null;

  try {
    const mediaDownloadOptions = {
      logger: baileysLogger,
      reuploadRequest: reuploadRequest ?? (async (msg: WAMessage) => msg),
    };

    const buffer = await downloadMediaMessage(message, "buffer", {}, mediaDownloadOptions);

    return {
      messageType,
      fileName: (mediaMessage.fileName as string) ?? "",
      caption: (mediaMessage.caption as string) ?? "",
      size: {
        fileLength: mediaMessage.fileLength as number | Long | null | undefined,
        height: (mediaMessage.height as number) ?? 0,
        width: (mediaMessage.width as number) ?? 0,
      },
      mimetype: (mediaMessage.mimetype as string) ?? "",
      base64: (buffer as Buffer).toString("base64"),
    };
  } catch (error) {
    logger.error("Failed to get message media: %s", errorToString(error));
    return null;
  }
}
