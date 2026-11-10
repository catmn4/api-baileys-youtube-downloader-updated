import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import connectionManager from "@/baileys/connectionManager";
import { getMessageMedia } from "@/baileys/helpers/downloadMedia";
import { isPathInside } from "@/lib/pathSafe";
import { error, success } from "@/lib/response";
import { authMiddleware } from "@/middleware/auth";
import { sessionValidator } from "@/middleware/sessionValidator";

const MEDIA_DIR = join(process.cwd(), "media");

const mediaRoutes = new Hono();

mediaRoutes.use("*", authMiddleware);

/**
 * POST /media/:sessionId/download
 * Download media from a message (returns base64).
 */
mediaRoutes.post("/:sessionId/download", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const body = await c.req.json();
  const { remoteJid, messageId } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const store = session.getStore();
    const message = store.getMessage(remoteJid, messageId);

    if (!message) {
      return error(c, "Message not found in store", 404);
    }

    const media = await getMessageMedia(message);
    if (!media) {
      return error(c, "No media found in this message", 400);
    }

    return success(c, media, "Media downloaded successfully");
  } catch (err) {
    return error(c, `Failed to download media: ${(err as Error).message}`);
  }
});

/**
 * GET /media/file/:id
 * Retrieve a saved media file by ID.
 */
mediaRoutes.get("/file/:id", async (c) => {
  const id = c.req.param("id") ?? "";
  const filePath = resolve(join(MEDIA_DIR, id));

  // Prevent path traversal
  if (!isPathInside(MEDIA_DIR, filePath)) {
    return error(c, "Forbidden", 403);
  }

  if (!existsSync(filePath)) {
    return error(c, "Media file not found", 404);
  }

  try {
    const buffer = await readFile(filePath);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${id}"`,
      },
    });
  } catch (err) {
    return error(c, `Failed to read media file: ${(err as Error).message}`);
  }
});

export default mediaRoutes;
