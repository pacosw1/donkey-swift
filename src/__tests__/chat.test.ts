import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { ChatService, type ChatDB, type ChatMessage } from "../chat/index.js";
import type { PushProvider } from "../push/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    user_id: "user-1",
    sender: "user",
    message: "hello",
    message_type: "text",
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockDB(overrides: Partial<ChatDB> = {}): ChatDB {
  return {
    getChatMessages: vi.fn().mockResolvedValue([]),
    getChatMessagesSince: vi.fn().mockResolvedValue([]),
    sendChatMessage: vi.fn().mockResolvedValue(makeChatMessage()),
    markChatRead: vi.fn().mockResolvedValue(undefined),
    getUnreadCount: vi.fn().mockResolvedValue(0),
    adminListChatThreads: vi.fn().mockResolvedValue([]),
    enabledDeviceTokens: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function mockPush(overrides: Partial<PushProvider> = {}): PushProvider {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendWithData: vi.fn().mockResolvedValue(undefined),
    sendSilent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function defaultCfg() {
  return {
    parseToken: vi.fn().mockResolvedValue("user-1"),
    adminDisplayName: "Support",
  };
}

function buildApp(svc: ChatService) {
  const a = new Hono();
  // Simulate auth middleware setting userId
  a.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  a.get("/chat", svc.handleGetChat);
  a.post("/chat", svc.handleSendChat);
  a.get("/chat/unread", svc.handleUnreadCount);
  a.get("/admin/chat/:user_id", svc.handleAdminGetChat);
  a.post("/admin/chat/:user_id", svc.handleAdminReplyChat);
  return a;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ChatService", () => {
  // ── handleSendChat ───────────────────────────────────────────────────────

  describe("handleSendChat", () => {
    it("returns 400 when message is missing", async () => {
      const db = mockDB();
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/message/i);
    });

    it("returns 400 when message exceeds 5000 chars", async () => {
      const db = mockDB();
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "x".repeat(5001) }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/too long/i);
    });

    it("sends message successfully and returns 201", async () => {
      const sentMsg = makeChatMessage({ id: 42, message: "hi there" });
      const db = mockDB({
        sendChatMessage: vi.fn().mockResolvedValue(sentMsg),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi there" }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.status).toBe("sent");
      expect(db.sendChatMessage).toHaveBeenCalledWith("user-1", "user", "hi there", "text");
    });
  });

  // ── handleGetChat ────────────────────────────────────────────────────────

  describe("handleGetChat", () => {
    it("returns messages with pagination (has_more = true when more exist)", async () => {
      // Default limit is 50; service fetches limit+1 to detect more
      const msgs = Array.from({ length: 51 }, (_, i) =>
        makeChatMessage({ id: i + 1, message: `msg-${i}` })
      );
      const db = mockDB({
        getChatMessages: vi.fn().mockResolvedValue(msgs),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/chat");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.has_more).toBe(true);
      expect(json.messages).toHaveLength(50);
    });

    it("returns has_more = false when fewer messages than limit", async () => {
      const msgs = [makeChatMessage({ id: 1 }), makeChatMessage({ id: 2 })];
      const db = mockDB({
        getChatMessages: vi.fn().mockResolvedValue(msgs),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/chat");
      const json = await res.json();
      expect(json.has_more).toBe(false);
      expect(json.messages).toHaveLength(2);
    });

    it("uses since_id parameter when provided", async () => {
      const db = mockDB({
        getChatMessagesSince: vi.fn().mockResolvedValue([makeChatMessage({ id: 5 })]),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/chat?since_id=4");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.has_more).toBe(false);
      expect(db.getChatMessagesSince).toHaveBeenCalledWith("user-1", 4);
    });

    it("returns 400 for invalid since_id", async () => {
      const db = mockDB();
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/chat?since_id=abc");
      expect(res.status).toBe(400);
    });
  });

  // ── handleUnreadCount ────────────────────────────────────────────────────

  describe("handleUnreadCount", () => {
    it("returns the unread count", async () => {
      const db = mockDB({
        getUnreadCount: vi.fn().mockResolvedValue(7),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/chat/unread");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.count).toBe(7);
    });

    it("returns 0 when getUnreadCount throws", async () => {
      const db = mockDB({
        getUnreadCount: vi.fn().mockRejectedValue(new Error("db error")),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/chat/unread");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.count).toBe(0);
    });
  });

  // ── handleAdminReplyChat ─────────────────────────────────────────────────

  describe("handleAdminReplyChat", () => {
    it("returns 400 when user_id param is missing", async () => {
      const db = mockDB();
      const svc = new ChatService(db, mockPush(), defaultCfg());

      // Build a separate app where the route has no :user_id param
      const a = new Hono();
      a.use("*", async (c, next) => {
        c.set("userId", "admin-1");
        await next();
      });
      a.post("/admin/chat", svc.handleAdminReplyChat);

      const res = await a.request("/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "reply" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/user_id/i);
    });

    it("returns 400 when message exceeds 5000 chars", async () => {
      const db = mockDB();
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/admin/chat/user-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "x".repeat(5001) }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/too long/i);
    });

    it("sends push notification when user has no active WebSocket", async () => {
      const sentMsg = makeChatMessage({ id: 10, sender: "admin", message: "we can help" });
      const db = mockDB({
        sendChatMessage: vi.fn().mockResolvedValue(sentMsg),
        enabledDeviceTokens: vi.fn().mockResolvedValue(["token-abc"]),
      });
      const push = mockPush();
      const svc = new ChatService(db, push, defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/admin/chat/user-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "we can help" }),
      });

      expect(res.status).toBe(201);
      // Wait for async push to complete
      await vi.waitFor(() => {
        expect(push.sendWithData).toHaveBeenCalledWith(
          "token-abc",
          "New message from Support",
          "we can help",
          { type: "chat_message", user_id: "user-1" }
        );
      });
    });

    it("does not send push when user has an active WebSocket", async () => {
      const sentMsg = makeChatMessage({ id: 11, sender: "admin", message: "hi" });
      const db = mockDB({
        sendChatMessage: vi.fn().mockResolvedValue(sentMsg),
        enabledDeviceTokens: vi.fn().mockResolvedValue(["token-abc"]),
      });
      const push = mockPush();
      const svc = new ChatService(db, push, defaultCfg());

      // Simulate an active WebSocket connection for user-1
      const fakeWs = { send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
      svc.handleWSConnection(fakeWs, "user-1", "user");

      const app = buildApp(svc);

      const res = await app.request("/admin/chat/user-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      expect(res.status).toBe(201);
      expect(push.sendWithData).not.toHaveBeenCalled();
    });

    it("sends reply successfully and returns 201", async () => {
      const sentMsg = makeChatMessage({ id: 12, sender: "admin", message: "got it" });
      const db = mockDB({
        sendChatMessage: vi.fn().mockResolvedValue(sentMsg),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());
      const app = buildApp(svc);

      const res = await app.request("/admin/chat/user-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "got it" }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.status).toBe("sent");
      expect(db.sendChatMessage).toHaveBeenCalledWith("user-1", "admin", "got it", "text");
    });
  });
});
