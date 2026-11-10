import { afterAll, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import { MemoryStore } from "@/baileys/store/memoryStore";

const sessionIds = ["lid-merge-a", "lid-merge-b", "lid-migrate"];
afterAll(() => {
  for (const sessionId of sessionIds) {
    rmSync(`sessions/${sessionId}_store.json`, { force: true });
  }
});

function bindStore(sessionId: string) {
  const store = new MemoryStore({ sessionId, autoSaveInterval: 0 });
  const events = new EventEmitter();
  store.bind(events as unknown as Parameters<MemoryStore["bind"]>[0]);
  return { store, events };
}

const lid = "123456789012345@lid";
const pn = "628123456789@s.whatsapp.net";

test("messages addressed by LID and PN share one room via remoteJidAlt", async () => {
  const { store, events } = bindStore(sessionIds[0]!);
  events.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: { id: "lid-1", remoteJid: lid, remoteJidAlt: pn },
        messageTimestamp: 100,
        message: { conversation: "from lid" },
      },
      {
        key: { id: "pn-1", remoteJid: pn },
        messageTimestamp: 200,
        message: { conversation: "from pn" },
      },
    ],
  } as never);

  expect(store.messages.has(lid)).toBe(false);
  expect(store.loadMessages(pn, 10).map((message) => message.key.id)).toEqual(["pn-1", "lid-1"]);
  await store.destroy();
});

test("a later LID mapping migrates an existing LID room", async () => {
  const { store, events } = bindStore(sessionIds[1]!);
  events.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: { id: "before-map", remoteJid: lid },
        messageTimestamp: 100,
        message: { conversation: "before mapping" },
      },
    ],
  } as never);
  expect(store.messages.has(lid)).toBe(true);

  events.emit("lid-mapping.update", { lid, pn });
  expect(store.messages.has(lid)).toBe(false);
  expect(store.loadMessages(pn, 10).map((message) => message.key.id)).toEqual(["before-map"]);
  expect(store.chats.has(pn)).toBe(true);
  await store.destroy();
});

test("saved contact name wins from either PN or LID record", async () => {
  const { store, events } = bindStore("lid-contact-name");
  events.emit("lid-mapping.update", { lid, pn });
  events.emit("contacts.upsert", [
    { id: pn, notify: "Push Name" },
    { id: lid, name: "Saved Contact Name" },
  ] as never);
  events.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: { id: "name-1", remoteJid: pn },
        messageTimestamp: 100,
        message: { conversation: "hello" },
      },
    ],
  } as never);

  const chat = store.getChatList(false)[0];
  expect(chat?.contactName).toBe("Saved Contact Name");
  expect(chat?.phoneNumber).toBe("628123456789");
  expect(chat?.lid).toBe(lid);
  await store.destroy();
  rmSync("sessions/lid-contact-name_store.json", { force: true });
});

test("reconciliation retries unresolved LIDs and deduplicates concurrent runs", async () => {
  const { BaileysConnection } = await import("@/baileys/connection");
  type FakeConnection = {
    sessionId: string;
    lidResolved: Set<string>;
    lidReconcileInFlight: Promise<void> | null;
    store: {
      chats: Map<string, Record<string, unknown>>;
      messages: Map<string, Map<string, unknown>>;
      registerLidMapping: (lid: string, phone: string) => void;
    };
    socket: {
      signalRepository: { lidMapping: { getPNForLID: (lid: string) => Promise<string | null> } };
    };
    reconcileLidRooms: () => Promise<void>;
  };

  let lookups = 0;
  let registered: [string, string] | null = null;
  let release: (value: string | null) => void = () => {};
  const pending = new Promise<string | null>((resolve) => {
    release = resolve;
  });
  const fake = Object.create(BaileysConnection.prototype) as FakeConnection;
  fake.sessionId = "lid-reconcile-test";
  fake.lidResolved = new Set();
  fake.lidReconcileInFlight = null;
  fake.store = {
    chats: new Map([[lid, {}]]),
    messages: new Map(),
    registerLidMapping: (from, phone) => {
      registered = [from, phone];
    },
  };
  fake.socket = {
    signalRepository: {
      lidMapping: {
        getPNForLID: async () => {
          lookups += 1;
          return lookups === 1 ? null : pending;
        },
      },
    },
  };

  await fake.reconcileLidRooms();
  expect(lookups).toBe(1);
  const before = registered as [string, string] | null;
  expect(before).toBeNull();

  const first = fake.reconcileLidRooms();
  const second = fake.reconcileLidRooms();
  expect(lookups).toBe(2); // second call reused the in-flight promise
  release("628123456789@s.whatsapp.net");
  await Promise.all([first, second]);
  const after = registered as [string, string] | null;
  expect(after).toEqual([lid, "628123456789@s.whatsapp.net"]);
});
