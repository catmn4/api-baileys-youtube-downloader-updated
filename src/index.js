import "./index.ts";

const baseUrl = (process.env.API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const sessionId = process.env.SESSION_ID ?? "whatsapp-main";
const rawPhoneNumber = process.env.PHONE_NUMBER ?? "";
const token = process.env.AUTH_GLOBAL_TOKEN ?? process.env.API_TOKEN ?? "";
const phoneNumber = rawPhoneNumber.replace(/[^0-9]/g, "");

console.log("[Main] src/index.js started.");
console.log(`[Main] Waiting for API at ${baseUrl}/status ...`);

let ready = false;
for (let attempt = 1; attempt <= 30; attempt += 1) {
  await Bun.sleep(1000);
  try {
    const response = await fetch(`${baseUrl}/status`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // The API is still starting.
  }
}

if (!ready) {
  console.error("[Main] API did not become ready within 30 seconds.");
  process.exit(1);
}

if (!token) {
  console.error("[Main] AUTH_GLOBAL_TOKEN is missing in .env.");
  process.exit(1);
}

if (!phoneNumber || rawPhoneNumber.includes("X") || phoneNumber.length < 7) {
  console.error("[Main] PHONE_NUMBER is missing or still a placeholder in .env.");
  console.error("[Main] Example: PHONE_NUMBER=966512345678");
  process.exit(1);
}

console.log(`[Main] API is ready. Requesting pairing code for ${sessionId}...`);

const response = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    usePairingCode: true,
    phoneNumber,
    freshAuth: process.env.FRESH_AUTH === "true",
  }),
});

const payload = await response.json().catch(() => ({}));
if (!response.ok || payload.success === false) {
  console.error("[Main] Pairing request failed:");
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

const pairingCode = payload.data?.pairingCode;
if (!pairingCode) {
  console.error("[Main] No pairing code was returned:");
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

console.log("");
console.log("========================================");
console.log(`PAIRING CODE: ${pairingCode}`);
console.log("========================================");
console.log("WhatsApp > Settings > Linked devices > Link with phone number instead");
console.log("[Main] API server is still running.");
