import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BaileysEventEmitter, WAMessage } from "@whiskeysockets/baileys";
import { jidNormalizedUser, toNumber } from "@whiskeysockets/baileys";
import logger from "@/lib/logger";

interface StoreConfig {
  sessionId: string;
  maxMessagesPerChat?: number;
  autoSaveInterval?: number;
}

const SESSIONS_DIR = join(process.cwd(), "sessions");

/**
 * In-memory store for chats, messages, contacts, and group metadata.
 * Persists to JSON file for recovery across restarts.
 */
export class MemoryStore extends EventEmitter {
  private sessionId: string;
  private maxMessagesPerChat: number;
  private storeFile: string;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private deleted = false;
  private dirty = false;

  public chats = new Map<string, Record<string, unknown>>();
  public messages = new Map<string, Map<string, WAMessage>>();
  public contacts = new Map<string, Record<string, unknown>>();
  public groupMetadata = new Map<string, Record<string, unknown>>();
  /** Canonical mapping used to merge alternate LID/PN rooms. */
  public lidToPn = new Map<string, string>();
  public pnToLid = new Map<string, string>();

  constructor(config: StoreConfig) {
    super();
    this.sessionId = config.sessionId;
    this.maxMessagesPerChat = config.maxMessagesPerChat ?? 50;
    this.storeFile = join(SESSIONS_DIR, `${config.sessionId}_store.json`);

    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }

    // Auto-save every 60 seconds
    const interval = config.autoSaveInterval ?? 60000;
    if (interval > 0) {
      this.autoSaveTimer = setInterval(() => {
        this.writeToFile().catch(() => {});
      }, interval);
    }
  }

  bind(ev: BaileysEventEmitter) {
    ev.on("messages.delete", (item) => {
      this.dirty = true;
      // { jid, all: true } arrives when a chat is cleared on the account;
      // per-key deletions arrive for individual messages.
      const keys = "keys" in item ? item.keys : [];

      if (keys.length === 0 && "all" in item && item.all === true && item.jid) {
        const jid = this.canonicalRoomJid(item.jid);
        this.messages.delete(jid);
        const chat = this.chats.get(jid);
        if (chat) chat.unreadCount = 0;
        return;
      }

      for (const key of keys) {
        if (!key?.remoteJid || !key.id) continue;
        const jid = this.canonicalRoomJid(key.remoteJid);
        this.messages.get(jid)?.delete(key.id);
      }
    });

    ev.on("messages.upsert", ({ messages: newMessages, type }) => {
      this.dirty = true;
      for (const msg of newMessages) {
        try {
          if (!msg.key.remoteJid) continue;
          const jid = this.canonicalRoomJid(msg.key.remoteJid, msg.key.remoteJidAlt);
          // Create the room for every upsert type. Some Baileys versions deliver
          // live messages without type "notify"; gating on it left the chat list
          // empty even though messages were stored.
          const timestamp = toNumber(msg.messageTimestamp || 0);
          const isNew = this.addMessage(jid, msg);
          const existing = this.chats.get(jid);
          if (!existing) {
            this.chats.set(jid, {
              id: jid,
              name: msg.pushName || undefined,
              conversationTimestamp: timestamp,
              unreadCount: type === "notify" && !msg.key.fromMe && isNew ? 1 : 0,
            });
          } else {
            existing.conversationTimestamp = timestamp;
            if (!existing.name && msg.pushName) existing.name = msg.pushName;
            if (type === "notify" && !msg.key.fromMe && isNew) {
              existing.unreadCount = Number(existing.unreadCount || 0) + 1;
            }
          }
        } catch {
          // Ignore individual message errors
        }
      }
    });

    ev.on("messaging-history.set", ({ chats, contacts, messages, lidPnMappings }) => {
      this.dirty = true;
      for (const mapping of lidPnMappings || []) {
        this.registerLidMapping(mapping.lid, mapping.pn);
      }
      for (const chat of chats || []) {
        if (!chat.id) continue;
        const jid = this.canonicalRoomJid(chat.id);
        if (!this.chats.has(jid)) {
          this.chats.set(jid, { ...chat, id: jid });
        }
      }
      for (const contact of contacts || []) {
        try {
          if (!contact.id) continue;
          if (contact.lid && (contact.phoneNumber || contact.id)) {
            this.registerLidMapping(contact.lid, contact.phoneNumber || contact.id);
          }
          const jid = this.canonicalRoomJid(contact.id, contact.lid);
          this.contacts.set(jid, { ...contact });
        } catch {
          // Skip invalid contacts
        }
      }
      for (const msg of messages || []) {
        try {
          if (!msg.key.remoteJid) continue;
          const jid = this.canonicalRoomJid(msg.key.remoteJid, msg.key.remoteJidAlt);
          this.addMessage(jid, msg);
        } catch {
          // Skip invalid messages
        }
      }
    });

    ev.on("chats.upsert", (newChats) => {
      this.dirty = true;
      for (const chat of newChats) {
        if (!chat.id) continue;
        const jid = this.canonicalRoomJid(chat.id);
        const existing = this.chats.get(jid);
        this.chats.set(jid, { ...(existing || {}), ...chat, id: jid });
      }
    });

    ev.on("chats.update", (updates) => {
      this.dirty = true;
      for (const update of updates) {
        if (!update.id) continue;
        const jid = this.canonicalRoomJid(update.id);
        const existing = this.chats.get(jid);
        if (existing) {
          Object.assign(existing, update, { id: jid });
        }
      }
    });

    ev.on("chats.delete", (deletions) => {
      this.dirty = true;
      for (const chatId of deletions) {
        const jid = this.canonicalRoomJid(chatId);
        this.chats.delete(jid);
        this.messages.delete(jid);
        // Clean up a legacy alternate room as well.
        this.chats.delete(chatId);
        this.messages.delete(chatId);
      }
    });

    ev.on("contacts.upsert", (newContacts) => {
      this.dirty = true;
      for (const contact of newContacts) {
        try {
          if (contact.lid && contact.phoneNumber) {
            this.registerLidMapping(contact.lid, contact.phoneNumber);
          } else if (contact.lid && contact.id) {
            this.registerLidMapping(contact.lid, contact.id);
          }
          const jid = this.canonicalRoomJid(contact.id, contact.lid);
          const existing = this.contacts.get(jid);
          this.contacts.set(jid, { ...(existing || {}), ...contact });
        } catch {
          // Skip invalid contacts
        }
      }
    });

    ev.on("lid-mapping.update", (mapping) => {
      this.registerLidMapping(mapping.lid, mapping.pn);
    });

    ev.on("groups.update", (updates) => {
      this.dirty = true;
      for (const update of updates) {
        if (update.id) {
          const existing = this.groupMetadata.get(update.id);
          this.groupMetadata.set(update.id, { ...(existing || {}), ...update });
        }
      }
    });
  }

  /** Register a LID <-> phone-number mapping and merge any duplicate rooms. */
  public registerLidMapping(lidRaw: string, pnRaw: string): void {
    try {
      const lid = jidNormalizedUser(lidRaw);
      const pn = jidNormalizedUser(pnRaw);
      if (!lid.endsWith("@lid") || !pn.endsWith("@s.whatsapp.net")) return;
      const previousPn = this.lidToPn.get(lid);
      this.lidToPn.set(lid, pn);
      this.pnToLid.set(pn, lid);
      this.dirty = true;
      this.mergeRoom(lid, pn);
      if (previousPn && previousPn !== pn) this.mergeRoom(previousPn, pn);
    } catch {
      // Ignore malformed addresses from history sync.
    }
  }

  private mergeRoom(from: string, to: string): void {
    if (!from || !to || from === to) return;
    const sourceMessages = this.messages.get(from);
    if (sourceMessages) {
      const targetMessages = this.messages.get(to) ?? new Map<string, WAMessage>();
      for (const [id, message] of sourceMessages) {
        if (!targetMessages.has(id)) targetMessages.set(id, message);
      }
      this.messages.set(to, targetMessages);
      this.messages.delete(from);
    }

    const sourceChat = this.chats.get(from);
    if (sourceChat) {
      const targetChat = this.chats.get(to);
      const sourceTime = Number(sourceChat.conversationTimestamp || 0);
      const targetTime = Number(targetChat?.conversationTimestamp || 0);
      this.chats.set(to, {
        ...sourceChat,
        ...(targetChat || {}),
        id: to,
        conversationTimestamp: Math.max(sourceTime, targetTime),
        unreadCount: Math.max(
          Number(sourceChat.unreadCount || 0),
          Number(targetChat?.unreadCount || 0),
        ),
      });
      this.chats.delete(from);
      this.dirty = true;
    }
  }

  /** Prefer the PN form for a direct room; groups keep their own JID. */
  private canonicalRoomJid(rawJid: string, altJid?: string | null): string {
    try {
      const jid = jidNormalizedUser(rawJid);
      if (jid.endsWith("@g.us")) return jid;
      const alt = altJid ? jidNormalizedUser(altJid) : "";
      if (jid.endsWith("@lid") && alt.endsWith("@s.whatsapp.net")) {
        this.registerLidMapping(jid, alt);
        return alt;
      }
      if (jid.endsWith("@s.whatsapp.net") && alt.endsWith("@lid")) {
        this.registerLidMapping(alt, jid);
        return jid;
      }
      if (jid.endsWith("@lid")) return this.lidToPn.get(jid) ?? jid;
      return jid;
    } catch {
      return rawJid;
    }
  }

  private addMessage(jid: string, msg: WAMessage): boolean {
    if (!this.messages.has(jid)) {
      this.messages.set(jid, new Map());
    }

    const chatMessages = this.messages.get(jid);
    if (!chatMessages || !msg.key.id) return false;
    const isNew = !chatMessages.has(msg.key.id);
    chatMessages.set(msg.key.id, msg);

    // Evict oldest if over limit
    if (chatMessages.size > this.maxMessagesPerChat) {
      const sorted = Array.from(chatMessages.entries()).sort(
        ([, a], [, b]) => toNumber(a.messageTimestamp || 0) - toNumber(b.messageTimestamp || 0),
      );
      const toDelete = sorted.slice(0, chatMessages.size - this.maxMessagesPerChat);
      for (const [id] of toDelete) {
        chatMessages.delete(id);
      }
    }

    return isNew;
  }

  getMessage(jid: string, messageId: string): WAMessage | undefined {
    return this.messages.get(jid)?.get(messageId);
  }

  loadMessages(jid: string, count = 25): WAMessage[] {
    const chatMessages = this.messages.get(jid);
    if (!chatMessages) return [];
    return Array.from(chatMessages.values())
      .sort((a, b) => toNumber(b.messageTimestamp || 0) - toNumber(a.messageTimestamp || 0))
      .slice(0, count);
  }

  getChatList(isGroup = false): Record<string, unknown>[] {
    const enrich = (chat: Record<string, unknown>): Record<string, unknown> => {
      const id = jidNormalizedUser(String(chat.id ?? ""));
      // Check both sides of the PN/LID pair: a saved name may live on either
      // record, even when the primary record only carries a push name.
      const alternate = this.pnToLid.get(id) || this.lidToPn.get(id);
      const records = [
        this.contacts.get(id),
        alternate ? this.contacts.get(alternate) : undefined,
      ].filter((contact): contact is Record<string, unknown> => Boolean(contact));
      const savedName = records.map((contact) => String(contact.name || "").trim()).find(Boolean);
      const pushName = records.map((contact) => String(contact.notify || "").trim()).find(Boolean);
      const verifiedName = records
        .map((contact) => String(contact.verifiedName || "").trim())
        .find(Boolean);
      const contactName = savedName || pushName || verifiedName || "";
      const pn = id.endsWith("@s.whatsapp.net")
        ? id
        : id.endsWith("@lid")
          ? this.lidToPn.get(id) || ""
          : "";
      const lid = id.endsWith("@lid") ? id : this.pnToLid.get(id) || "";
      const phoneNumber = pn ? pn.slice(0, -"@s.whatsapp.net".length) : "";
      return {
        ...chat,
        ...(contactName ? { contactName } : {}),
        ...(lid ? { lid } : {}),
        ...(phoneNumber ? { phoneNumber } : {}),
      };
    };

    if (isGroup) {
      return [...this.chats.values()]
        .filter((chat) => String(chat.id ?? "").endsWith("@g.us"))
        .map(enrich);
    }
    // Individual chats use either the classic JID (@s.whatsapp.net) or the
    // newer LID addressing (@lid). Both are 1:1 conversations; groups,
    // broadcasts, status and newsletters are excluded.
    return [...this.chats.values()]
      .filter((chat) => {
        const id = String(chat.id ?? "");
        if (id.endsWith("@g.us") || id.endsWith("@broadcast") || id.endsWith("@newsletter")) {
          return false;
        }
        return id.endsWith("@s.whatsapp.net") || id.endsWith("@lid");
      })
      .map(enrich);
  }

  /** Clear the unread badge for a chat (also used when the UI opens it). */
  markChatRead(jid: string): void {
    const target = normalizeJidKey(jid);
    for (const [key, chat] of this.chats) {
      if (normalizeJidKey(key) === target) {
        chat.unreadCount = 0;
      }
    }
  }

  /** Remove stored messages for one chat, keeping the room in the list. */
  clearChat(jid: string): number {
    const target = normalizeJidKey(jid);
    let removed = 0;
    for (const [key, map] of this.messages) {
      if (normalizeJidKey(key) === target) {
        removed += map.size;
        map.clear();
      }
    }
    this.markChatRead(jid);
    return removed;
  }

  /** Remove one chat entry and its messages (used after a remote delete). */
  deleteChat(jid: string): { chats: number; messages: number } {
    const target = normalizeJidKey(jid);
    let messages = 0;
    for (const [key, map] of this.messages) {
      if (normalizeJidKey(key) !== target) continue;
      messages += map.size;
      this.messages.delete(key);
    }
    let chats = 0;
    for (const key of [...this.chats.keys()]) {
      if (normalizeJidKey(key) === target) {
        this.chats.delete(key);
        chats += 1;
      }
    }
    return { chats, messages };
  }

  /** Remove every stored chat and message for this session. */
  clearAllChats(): { chats: number; messages: number } {
    let messages = 0;
    for (const map of this.messages.values()) messages += map.size;
    const chats = this.chats.size;
    this.messages.clear();
    this.chats.clear();
    return { chats, messages };
  }

  getContactList(): string[] {
    return [...this.contacts.keys()];
  }

  /** Mark the session deleted: late close events must not resurrect the file. */
  markDeleted(): void {
    this.deleted = true;
    this.dirty = false;
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    try {
      rmSync(this.storeFile, { force: true });
    } catch {
      // The file may already be gone.
    }
  }

  async writeToFile(force = false) {
    if (this.deleted) return;
    if (!force && !this.dirty) return;
    try {
      const data = {
        version: "1.0",
        timestamp: Date.now(),
        chats: [...this.chats.entries()],
        messages: Object.fromEntries(
          [...this.messages.entries()].map(([jid, msgs]) => [jid, [...msgs.entries()]]),
        ),
        contacts: [...this.contacts.entries()],
        groupMetadata: [...this.groupMetadata.entries()],
        lidMappings: [...this.lidToPn.entries()],
      };

      const tempFile = `${this.storeFile}.tmp.${Date.now()}`;

      // Strip out heavy base64 data to save memory & storage and speed up serialization
      const jsonStr = JSON.stringify(data, (key, value) => {
        if (key === "jpegThumbnail" || key === "historySyncBase64") return undefined;
        return value;
      });

      const { writeFile, rename } = await import("node:fs/promises");
      await writeFile(tempFile, jsonStr);
      await rename(tempFile, this.storeFile);
      this.dirty = false;
    } catch (error) {
      logger.error("[Store:%s] Write error: %s", this.sessionId, (error as Error).message);
    }
  }

  async readFromFile() {
    try {
      if (!existsSync(this.storeFile)) return;

      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(this.storeFile, "utf-8");
      if (!raw.trim()) return;

      const data = JSON.parse(raw);

      // Load LID/PN mappings before rooms so legacy duplicate rooms can merge.
      if (Array.isArray(data.lidMappings)) {
        for (const [lid, pn] of data.lidMappings) {
          if (typeof lid === "string" && typeof pn === "string") {
            this.lidToPn.set(lid, pn);
            this.pnToLid.set(pn, lid);
          }
        }
      }

      // Load chats
      if (Array.isArray(data.chats)) {
        for (const [jid, chat] of data.chats) {
          this.chats.set(jid, chat);
        }
      }

      // Load messages
      if (data.messages) {
        for (const [jid, msgs] of Object.entries(data.messages)) {
          this.messages.set(jid, new Map(msgs as [string, WAMessage][]));
        }
      }

      // Load contacts
      if (Array.isArray(data.contacts)) {
        for (const [jid, contact] of data.contacts) {
          this.contacts.set(jid, contact);
        }
      }

      // Load group metadata
      if (Array.isArray(data.groupMetadata)) {
        for (const [jid, meta] of data.groupMetadata) {
          this.groupMetadata.set(jid, meta);
        }
      }

      for (const [lid, pn] of this.lidToPn) this.mergeRoom(lid, pn);

      logger.info(
        "[Store:%s] Loaded %d chats, %d contacts",
        this.sessionId,
        this.chats.size,
        this.contacts.size,
      );
    } catch (error) {
      logger.error("[Store:%s] Read error: %s", this.sessionId, (error as Error).message);
    }
  }

  async destroy() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    await this.writeToFile(true);
  }
}

/** JIDs may carry a device suffix (123:4@s.whatsapp.net); compare without it. */
function normalizeJidKey(value: unknown): string {
  return String(value || "").replace(/:\d+(?=@)/, "");
}
