/**
 * Download one inbound image for a vision request.
 *
 * Deliberately in-memory and bounded: no file in media/ and no base64 in the
 * store/history. The buffer is re-encoded to JPEG (strips metadata, caps the
 * dimensions) and is eligible for GC immediately after the provider request.
 */
import { downloadContentFromMessage, type WAMessage } from "@whiskeysockets/baileys";
import sharp from "sharp";
import logger from "@/lib/logger";
import { errorToString } from "@/utils/validation";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 1568;

export interface VisionImage {
  mime: string;
  data: string;
}

export async function downloadImageForVision(message: WAMessage): Promise<VisionImage | null> {
  const image = message.message?.imageMessage;
  if (!image) return null;

  try {
    const stream = await downloadContentFromMessage(image, "image");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) {
        logger.warn("Vision image exceeds %d bytes; skipped", MAX_INPUT_BYTES);
        return null;
      }
      chunks.push(chunk);
    }

    const input = Buffer.concat(chunks);
    if (input.length === 0) return null;

    const output = await sharp(input, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    return { mime: "image/jpeg", data: output.toString("base64") };
  } catch (error) {
    logger.warn("Vision image download failed: %s", errorToString(error));
    return null;
  }
}
