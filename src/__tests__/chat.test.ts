import { describe, it, expect, vi } from "vitest";
import { ChatService, type ChatDB, type ChatMessage } from "../chat/index.js";
import type { PushProvider } from "../push/index.js";
import { ValidationError, ServiceError } from "../errors/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    user_id: "user-1",
    sender: "user",
    message: "hello",
    message_type: "text",
    attachment: null,
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ChatService", () => {
  // ── sendMessage ───────────────────────────────────────────────────────

  describe("sendMessage", () => {
    it("throws ValidationError when message is missing", async () => {
      const svc = new ChatService(mockDB(), mockPush(), defaultCfg());
      await expect(svc.sendMessage("user-1", "")).rejects.toThrow(ValidationError);
      await expect(svc.sendMessage("user-1", "")).rejects.toThrow(/message/i);
    });

    it("throws ValidationError when message exceeds 5000 chars", async () => {
      const svc = new ChatService(mockDB(), mockPush(), defaultCfg());
      await expect(svc.sendMessage("user-1", "x".repeat(5001))).rejects.toThrow(/too long/i);
    });

    it("sends message successfully", async () => {
      const sentMsg = makeChatMessage({ id: 42, message: "hi there" });
      const db = mockDB({
        sendChatMessage: vi.fn().mockResolvedValue(sentMsg),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());

      const result = await svc.sendMessage("user-1", "hi there");
      expect(result.status).toBe("sent");
      expect(result.id).toBe(42);
      expect(db.sendChatMessage).toHaveBeenCalledWith("user-1", "user", "hi there", "text", undefined);
    });

    it("passes attachment metadata through to the DB", async () => {
      const sentMsg = makeChatMessage({
        id: 43,
        message: "https://cdn.example.com/image.jpg",
        message_type: "image",
        attachment: {
          url: "https://cdn.example.com/image.jpg",
          content_type: "image/jpeg",
          file_name: "image.jpg",
          size_bytes: 1234,
        },
      });
      const db = mockDB({
        sendChatMessage: vi.fn().mockResolvedValue(sentMsg),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());

      const attachment = {
        url: "https://cdn.example.com/image.jpg",
        content_type: "image/jpeg",
        file_name: "image.jpg",
        size_bytes: 1234,
      };

      const result = await svc.sendMessage("user-1", attachment.url, "image", attachment);
      expect(result.status).toBe("sent");
      expect(db.sendChatMessage).toHaveBeenCalledWith(
        "user-1",
        "user",
        attachment.url,
        "image",
        attachment,
      );
    });

    it("throws ServiceError when DB fails", async () => {
      const db = mockDB({
        sendChatMessage: vi.fn().mockRejectedValue(new Error("db down")),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());
      await expect(svc.sendMessage("user-1", "hello")).rejects.toThrow(ServiceError);
    });
  });

  // ── getMessages ────────────────────────────────────────────────────────

  describe("getMessages", () => {
    it("returns messages with pagination (has_more = true when more exist)", async () => {
      const msgs = Array.from({ length: 51 }, (_, i) =>
        makeChatMessage({ id: i + 1, message: `msg-${i}` })
      );
      const db = mockDB({
        getChatMessages: vi.fn().mockResolvedValue(msgs),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());

      const result = await svc.getMessages("user-1");
      expect(result.has_more).toBe(true);
      expect(result.messages).toHaveLength(50);
    });

    it("returns has_more = false when fewer messages than limit", async () => {
      const msgs = [makeChatMessage({ id: 1 }), makeChatMessage({ id: 2 })];
      const db = mockDB({
        getChatMessages: vi.fn().mockResolvedValue(msgs),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());

      const result = await svc.getMessages("user-1");
      expect(result.has_more).toBe(false);
      expect(result.messages).toHaveLength(2);
    });

    it("uses since_id parameter when provided", async () => {
      const db = mockDB({
        getChatMessagesSince: vi.fn().mockResolvedValue([makeChatMessage({ id: 5 })]),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());

      const result = await svc.getMessages("user-1", { since_id: 4 });
      expect(result.has_more).toBe(false);
      expect(db.getChatMessagesSince).toHaveBeenCalledWith("user-1", 4);
    });

    it("throws ValidationError for invalid since_id", async () => {
      const svc = new ChatService(mockDB(), mockPush(), defaultCfg());
      await expect(
        svc.getMessages("user-1", { since_id: NaN })
      ).rejects.toThrow(ValidationError);
    });
  });

  // ── getUnreadCount ────────────────────────────────────────────────────

  describe("getUnreadCount", () => {
    it("returns the unread count", async () => {
      const db = mockDB({
        getUnreadCount: vi.fn().mockResolvedValue(7),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());

      const result = await svc.getUnreadCount("user-1");
      expect(result.count).toBe(7);
    });

    it("returns 0 when getUnreadCount throws", async () => {
      const db = mockDB({
        getUnreadCount: vi.fn().mockRejectedValue(new Error("db error")),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());

      const result = await svc.getUnreadCount("user-1");
      expect(result.count).toBe(0);
    });
  });

  // ── adminReply ─────────────────────────────────────────────────────────

  describe("adminReply", () => {
    it("throws ValidationError when user_id is empty", async () => {
      const svc = new ChatService(mockDB(), mockPush(), defaultCfg());
      await expect(svc.adminReply("", "reply")).rejects.toThrow(/user_id/i);
    });

    it("throws ValidationError when message exceeds 5000 chars", async () => {
      const svc = new ChatService(mockDB(), mockPush(), defaultCfg());
      await expect(
        svc.adminReply("user-1", "x".repeat(5001))
      ).rejects.toThrow(/too long/i);
    });

    it("sends push notification when user has no active WebSocket", async () => {
      const sentMsg = makeChatMessage({ id: 10, sender: "admin", message: "we can help" });
      const db = mockDB({
        sendChatMessage: vi.fn().mockResolvedValue(sentMsg),
        enabledDeviceTokens: vi.fn().mockResolvedValue(["token-abc"]),
      });
      const push = mockPush();
      const svc = new ChatService(db, push, defaultCfg());

      const result = await svc.adminReply("user-1", "we can help");
      expect(result.status).toBe("sent");

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

      const result = await svc.adminReply("user-1", "hi");
      expect(result.status).toBe("sent");
      expect(push.sendWithData).not.toHaveBeenCalled();
    });

    it("uses a friendly push body for image attachments", async () => {
      const sentMsg = makeChatMessage({
        id: 13,
        sender: "admin",
        message: "https://cdn.example.com/support-image.jpg",
        message_type: "image",
      });
      const db = mockDB({
        sendChatMessage: vi.fn().mockResolvedValue(sentMsg),
        enabledDeviceTokens: vi.fn().mockResolvedValue(["token-abc"]),
      });
      const push = mockPush();
      const svc = new ChatService(db, push, defaultCfg());

      await svc.adminReply("user-1", sentMsg.message, "image");

      await vi.waitFor(() => {
        expect(push.sendWithData).toHaveBeenCalledWith(
          "token-abc",
          "New message from Support",
          "Sent a photo",
          { type: "chat_message", user_id: "user-1" },
        );
      });
    });

    it("sends reply successfully", async () => {
      const sentMsg = makeChatMessage({ id: 12, sender: "admin", message: "got it" });
      const db = mockDB({
        sendChatMessage: vi.fn().mockResolvedValue(sentMsg),
      });
      const svc = new ChatService(db, mockPush(), defaultCfg());

      const result = await svc.adminReply("user-1", "got it");
      expect(result.status).toBe("sent");
      expect(result.id).toBe(12);
      expect(db.sendChatMessage).toHaveBeenCalledWith("user-1", "admin", "got it", "text", undefined);
    });
  });
});
