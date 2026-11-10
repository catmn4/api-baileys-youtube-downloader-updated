import { afterAll, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import { MemoryStore } from "@/baileys/store/memoryStore";

const sessionId = "message-order-test";
const jid = "628123456789@s.whatsapp.net";

afterAll(() => {
  rmSync(`sessions/${sessionId}_store.json`, { force: true });
});

test("loadMessages sorts JSON-serialized Long timestamps newest-first", async () => {
  const store = new MemoryStore({ sessionId, autoSaveInterval: 0 });
  const ev = new EventEmitter();
  store.bind(ev as unknown as Parameters<MemoryStore["bind"]>[0]);

  // Plain { low, high } objects mimic the store after JSON.parse, where
  // Number(timestamp) is NaN and the old comparator silently preserved order.
  ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: { id: "first", remoteJid: jid },
        messageTimestamp: { low: 100, high: 0 },
        message: { conversation: "test, halo" },
      },
      {
        key: { id: "later", remoteJid: jid },
        messageTimestamp: { low: 200, high: 0 },
        message: { conversation: "later reply" },
      },
    ],
  } as never);

  expect(store.loadMessages(jid, 10).map((message) => message.key.id)).toEqual(["later", "first"]);

  await store.destroy();
});
