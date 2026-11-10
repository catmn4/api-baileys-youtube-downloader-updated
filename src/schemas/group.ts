/**
 * Zod Validation Schemas — Group Routes
 */
import { z } from "zod";

export const groupCreateSchema = z.object({
  groupName: z.string().min(1, "Group name is required").max(100),
  participants: z.array(z.string().min(1)).min(1, "At least one participant is required"),
});

export const groupParticipantsSchema = z.object({
  participants: z.array(z.string().min(1)).min(1, "At least one participant is required"),
  action: z.enum(["add", "remove", "promote", "demote"]),
});

export const groupSendSchema = z.object({
  receiver: z.string().min(1, "Group JID is required"),
  message: z
    .record(z.string(), z.unknown())
    .refine((obj) => Object.keys(obj).length > 0, "Message content is required"),
});

export const groupSubjectSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(100),
});

export const groupDescriptionSchema = z.object({
  description: z.string().optional(),
});

export const groupSettingSchema = z.object({
  setting: z.enum(["announcement", "not_announcement", "locked", "unlocked"]),
});

export const groupProfilePictureSchema = z.object({
  url: z.string().url("Invalid image URL"),
});

export const groupAcceptInviteSchema = z.object({
  inviteCode: z.string().min(1, "Invite code is required"),
});
