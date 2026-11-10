import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { Hono } from "hono";
import connectionManager from "@/baileys/connectionManager";
import { error, success } from "@/lib/response";
import { authMiddleware } from "@/middleware/auth";
import { sendRateLimit } from "@/middleware/rateLimit";
import { sessionValidator } from "@/middleware/sessionValidator";
import {
  groupAcceptInviteSchema,
  groupCreateSchema,
  groupDescriptionSchema,
  groupParticipantsSchema,
  groupProfilePictureSchema,
  groupSendSchema,
  groupSettingSchema,
  groupSubjectSchema,
} from "@/schemas/group";
import { formatGroup, formatPhone } from "@/utils/phone";

const groupRoutes = new Hono();

groupRoutes.use("*", authMiddleware);

/**
 * POST /groups/:sessionId/create
 */
groupRoutes.post("/:sessionId/create", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = groupCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { groupName, participants } = parsed.data;

  try {
    const session = connectionManager.getSession(sessionId);
    const formatted = participants.map(formatPhone);
    const group = await session.groupCreate(groupName, formatted);
    return success(c, group, "Group created successfully");
  } catch (err) {
    return error(c, `Failed to create group: ${(err as Error).message}`);
  }
});

/**
 * GET /groups/:sessionId/list
 */
groupRoutes.get("/:sessionId/list", sessionValidator, (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  try {
    const session = connectionManager.getSession(sessionId);
    const groups = session.getStore().getChatList(true);
    return success(c, groups);
  } catch (err) {
    return error(c, `Failed to get groups: ${(err as Error).message}`);
  }
});

/**
 * GET /groups/:sessionId/list-all
 * List all groups with participants (direct from WhatsApp).
 */
groupRoutes.get("/:sessionId/list-all", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  try {
    const session = connectionManager.getSession(sessionId);
    const groups = await session.groupFetchAllParticipating();
    return success(c, groups);
  } catch (err) {
    return error(c, `Failed to fetch groups: ${(err as Error).message}`);
  }
});

/**
 * GET /groups/:sessionId/metadata/:jid
 */
groupRoutes.get("/:sessionId/metadata/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = formatGroup(c.req.param("jid") ?? "");

  try {
    const session = connectionManager.getSession(sessionId);
    const meta = await session.groupMetadata(jid);
    if (!meta?.id) return error(c, "Group not found", 404);
    return success(c, meta);
  } catch (err) {
    return error(c, `Failed to get group metadata: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/send
 * Send a message to a group.
 */
groupRoutes.post("/:sessionId/send", sessionValidator, sendRateLimit, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = groupSendSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { receiver, message } = parsed.data;

  try {
    const session = connectionManager.getSession(sessionId);
    const jid = formatGroup(receiver);
    await session.sendMessage(jid, message as AnyMessageContent);
    return success(c, null, "Message sent to group");
  } catch (err) {
    return error(c, `Failed to send group message: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/participants/:jid
 * Update participants (add/remove/promote/demote).
 */
groupRoutes.post("/:sessionId/participants/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = formatGroup(c.req.param("jid") ?? "");
  const parsed = groupParticipantsSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);
  const { participants, action } = parsed.data;

  try {
    const session = connectionManager.getSession(sessionId);
    const formatted = participants.map(formatPhone);
    const result = await session.groupParticipantsUpdate(jid, formatted, action);
    return success(c, result, "Participants updated successfully");
  } catch (err) {
    return error(c, `Failed to update participants: ${(err as Error).message}`);
  }
});

/**
 * PATCH /groups/:sessionId/subject/:jid
 */
groupRoutes.patch("/:sessionId/subject/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = formatGroup(c.req.param("jid") ?? "");
  const parsed = groupSubjectSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  try {
    const session = connectionManager.getSession(sessionId);
    await session.groupUpdateSubject(jid, parsed.data.subject);
    return success(c, null, "Group subject updated");
  } catch (err) {
    return error(c, `Failed to update subject: ${(err as Error).message}`);
  }
});

/**
 * PATCH /groups/:sessionId/description/:jid
 */
groupRoutes.patch("/:sessionId/description/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = formatGroup(c.req.param("jid") ?? "");
  const parsed = groupDescriptionSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  try {
    const session = connectionManager.getSession(sessionId);
    await session.groupUpdateDescription(jid, parsed.data.description);
    return success(c, null, "Group description updated");
  } catch (err) {
    return error(c, `Failed to update description: ${(err as Error).message}`);
  }
});

/**
 * PATCH /groups/:sessionId/settings/:jid
 * Update group settings (announcement/not_announcement/locked/unlocked).
 */
groupRoutes.patch("/:sessionId/settings/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = formatGroup(c.req.param("jid") ?? "");
  const parsed = groupSettingSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  try {
    const session = connectionManager.getSession(sessionId);
    await session.groupSettingUpdate(jid, parsed.data.setting);
    return success(c, null, "Group settings updated");
  } catch (err) {
    return error(c, `Failed to update settings: ${(err as Error).message}`);
  }
});

/**
 * PATCH /groups/:sessionId/profile-picture/:jid
 */
groupRoutes.patch("/:sessionId/profile-picture/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = formatGroup(c.req.param("jid") ?? "");
  const parsed = groupProfilePictureSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  try {
    const session = connectionManager.getSession(sessionId);
    await session.updateProfilePicture(jid, { url: parsed.data.url });
    return success(c, null, "Group profile picture updated");
  } catch (err) {
    return error(c, `Failed to update profile picture: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/leave/:jid
 */
groupRoutes.post("/:sessionId/leave/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = formatGroup(c.req.param("jid") ?? "");

  try {
    const session = connectionManager.getSession(sessionId);
    await session.groupLeave(jid);
    return success(c, null, "Left group successfully");
  } catch (err) {
    return error(c, `Failed to leave group: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/leave-and-delete/:jid
 * Leave the group and remove its chat, locally and on WhatsApp.
 */
groupRoutes.post("/:sessionId/leave-and-delete/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = formatGroup(c.req.param("jid") ?? "");

  try {
    const session = connectionManager.getSession(sessionId);
    const store = session.getStore();
    const lastMessages = store
      .loadMessages(jid, 5)
      .map((message) => ({ key: message.key, messageTimestamp: message.messageTimestamp ?? 0 }));

    if (lastMessages.length > 0) {
      try {
        await session.chatModify({ delete: true, lastMessages }, jid);
      } catch {
        // Leaving still proceeds; the local copy is removed below.
      }
    }

    await session.groupLeave(jid);
    store.deleteChat(jid);

    return success(c, { jid }, "Left and deleted the group");
  } catch (err) {
    return error(c, `Failed to exit and delete group: ${(err as Error).message}`);
  }
});

/**
 * GET /groups/:sessionId/invite-code/:jid
 */
groupRoutes.get("/:sessionId/invite-code/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = formatGroup(c.req.param("jid") ?? "");

  try {
    const session = connectionManager.getSession(sessionId);
    const code = await session.groupInviteCode(jid);
    return success(c, { inviteCode: code });
  } catch (err) {
    return error(c, `Failed to get invite code: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/accept-invite
 */
groupRoutes.post("/:sessionId/accept-invite", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = groupAcceptInviteSchema.safeParse(await c.req.json());
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  try {
    const session = connectionManager.getSession(sessionId);
    const result = await session.groupAcceptInvite(parsed.data.inviteCode);
    return success(c, result, "Invite accepted");
  } catch (err) {
    return error(c, `Failed to accept invite: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/revoke-invite/:jid
 */
groupRoutes.post("/:sessionId/revoke-invite/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const jid = formatGroup(c.req.param("jid") ?? "");

  try {
    const session = connectionManager.getSession(sessionId);
    const result = await session.groupRevokeInvite(jid);
    return success(c, result, "Invite revoked");
  } catch (err) {
    return error(c, `Failed to revoke invite: ${(err as Error).message}`);
  }
});

export default groupRoutes;
