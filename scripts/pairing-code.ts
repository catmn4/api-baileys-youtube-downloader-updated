#!/usr/bin/env bun

export {};

const baseUrl = process.env.API_URL ?? "http://127.0.0.1:3000";
const token = process.env.AUTH_GLOBAL_TOKEN ?? process.env.API_TOKEN;
const sessionId = process.env.SESSION_ID ?? Bun.argv[2];
const phoneNumber = process.env.PHONE_NUMBER ?? Bun.argv[3];
const freshAuth = process.env.FRESH_AUTH === "true";

if (!sessionId || !phoneNumber) {
  console.error("Usage: bun run pairing -- <session-id> <phone-number>");
  console.error("Example: bun run pairing -- whatsapp-main 9665XXXXXXXX");
  process.exit(1);
}

if (!token) {
  console.error("AUTH_GLOBAL_TOKEN or API_TOKEN is required.");
  process.exit(1);
}

const normalizedPhone = phoneNumber.replace(/[^0-9]/g, "");
if (normalizedPhone.length < 7) {
  console.error("Phone number must include the country code, digits only.");
  process.exit(1);
}

if (normalizedPhone.includes("X") || phoneNumber.includes("X")) {
  console.error("PHONE_NUMBER is still a placeholder. Replace it with your real WhatsApp number in .env.");
  process.exit(1);
}

console.log(`Requesting pairing code for session ${sessionId}...`);

const response = await fetch(`${baseUrl.replace(/\/$/, "")}/sessions/${encodeURIComponent(sessionId)}`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    usePairingCode: true,
    phoneNumber: normalizedPhone,
    freshAuth,
  }),
});

const payload = await response.json().catch(() => ({}));
if (!response.ok || payload.success === false) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

const pairingCode = payload.data?.pairingCode;
if (!pairingCode) {
  console.log(JSON.stringify(payload, null, 2));
  console.error("No pairing code was returned. Check the server logs and session status.");
  process.exit(1);
}

console.log(`Pairing code for ${sessionId}: ${pairingCode}`);
console.log("On the phone: WhatsApp > Settings > Linked devices > Link a device > Link with phone number instead.");
