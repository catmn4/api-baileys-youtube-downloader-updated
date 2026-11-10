import { Hono } from "hono";
import connectionManager from "@/baileys/connectionManager";
import { error, success } from "@/lib/response";
import { authMiddleware } from "@/middleware/auth";
import { sessionValidator } from "@/middleware/sessionValidator";
import { extractPhone, formatPhone } from "@/utils/phone";

const profileRoutes = new Hono();

profileRoutes.use("*", authMiddleware);

/**
 * GET /profile/:sessionId
 * Get own profile info.
 */
profileRoutes.get("/:sessionId", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";

  try {
    const session = connectionManager.getSession(sessionId);
    const user = session.user;
    if (!user) return error(c, "User info not available", 404);

    const phone = extractPhone(user.id);
    let image: string | undefined;
    let status: unknown;

    try {
      image = await session.profilePictureUrl(user.id, "image");
    } catch {
      /* no image */
    }

    try {
      status = await session.fetchStatus(`${phone}@s.whatsapp.net`);
    } catch {
      /* no status */
    }

    return success(c, {
      id: user.id,
      name: user.name,
      phone,
      image,
      status,
    });
  } catch (err) {
    return error(c, `Failed to get profile: ${(err as Error).message}`);
  }
});

/**
 * PATCH /profile/:sessionId/status
 * Update profile status text.
 */
profileRoutes.patch("/:sessionId/status", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    await session.updateProfileStatus(body.status);
    return success(c, null, "Profile status updated");
  } catch (err) {
    return error(c, `Failed to update status: ${(err as Error).message}`);
  }
});

/**
 * PATCH /profile/:sessionId/name
 * Update display name.
 */
profileRoutes.patch("/:sessionId/name", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    await session.updateProfileName(body.name);
    return success(c, null, "Profile name updated");
  } catch (err) {
    return error(c, `Failed to update name: ${(err as Error).message}`);
  }
});

/**
 * PATCH /profile/:sessionId/picture
 * Update profile picture.
 */
profileRoutes.patch("/:sessionId/picture", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    const user = session.user;
    if (!user) return error(c, "User info not available", 404);

    const phone = extractPhone(user.id);
    await session.updateProfilePicture(`${phone}@s.whatsapp.net`, { url: body.url });
    return success(c, null, "Profile picture updated");
  } catch (err) {
    return error(c, `Failed to update picture: ${(err as Error).message}`);
  }
});

/**
 * GET /profile/:sessionId/picture/:jid
 * Get profile picture URL of any user or group.
 */
profileRoutes.get("/:sessionId/picture/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = c.req.param("jid") ?? "";
  const type = (c.req.query("type") as "preview" | "image") ?? "image";

  try {
    const session = connectionManager.getSession(sessionId);
    const url = await session.profilePictureUrl(jid, type);
    return success(c, { jid, profilePictureUrl: url || null });
  } catch (err) {
    if ((err as Error).message === "item-not-found") {
      return error(c, "Profile picture not found", 404);
    }
    return error(c, `Failed to get picture: ${(err as Error).message}`);
  }
});

/**
 * POST /profile/:sessionId/block
 * Block or unblock a user.
 */
profileRoutes.post("/:sessionId/block", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const body = await c.req.json();
  const { jid, action } = body; // action: "block" | "unblock"

  try {
    const session = connectionManager.getSession(sessionId);
    const formattedJid = formatPhone(jid);
    await session.updateBlockStatus(formattedJid, action);
    return success(c, null, `User ${action}ed successfully`);
  } catch (err) {
    return error(c, `Failed to ${body.action} user: ${(err as Error).message}`);
  }
});

export default profileRoutes;
