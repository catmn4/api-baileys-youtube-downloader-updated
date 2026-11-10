import { Hono } from "hono";
import connectionManager from "@/baileys/connectionManager";
import { error, success } from "@/lib/response";
import { authMiddleware } from "@/middleware/auth";
import { sessionValidator } from "@/middleware/sessionValidator";
import { formatPhone } from "@/utils/phone";

const storyRoutes = new Hono();

storyRoutes.use("*", authMiddleware);

/**
 * POST /story/:sessionId/share
 * Share a story/status (text, image, video) to contacts.
 */
storyRoutes.post("/:sessionId/share", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const body = await c.req.json();
  const { receiver, message } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const statusJid = "status@broadcast";
    const user = session.user;
    const finalReceivers: string[] = [];

    // Always include self
    if (user?.id) {
      finalReceivers.push(formatPhone(user.id));
    }

    if (!receiver) {
      return error(c, "Receiver is required", 400);
    }

    // Handle "all_contacts"
    if (receiver === "all_contacts") {
      const contacts = session.getStore().getContactList();
      if (contacts.length === 0) {
        return error(c, "No contacts found", 400);
      }
      finalReceivers.push(...contacts.filter((c) => c.endsWith("@s.whatsapp.net")));
    } else if (Array.isArray(receiver)) {
      finalReceivers.push(...receiver.map(formatPhone));
    } else if (typeof receiver === "string") {
      finalReceivers.push(formatPhone(receiver));
    }

    await session.sendMessage(statusJid, message, {} as never);

    return success(c, null, "Story shared successfully");
  } catch (err) {
    return error(c, `Failed to share story: ${(err as Error).message}`);
  }
});

export default storyRoutes;
