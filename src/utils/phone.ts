/**
 * Format a phone number to WhatsApp JID format.
 */
export function formatPhone(phone: string): string {
  if (phone.endsWith("@s.whatsapp.net")) return phone;
  const formatted = phone.replace(/\D/g, "");
  return `${formatted}@s.whatsapp.net`;
}

/**
 * Format a group ID to WhatsApp JID format.
 */
export function formatGroup(group: string): string {
  if (group.endsWith("@g.us")) return group;
  const formatted = group.replace(/[^\d-]/g, "");
  return `${formatted}@g.us`;
}

/**
 * Extract phone number from WhatsApp user ID.
 */
export function extractPhone(userId: string): string {
  return userId.split("@")[0].split(":")[0];
}
