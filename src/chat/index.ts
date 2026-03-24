import type { Context } from "hono";
import type { PushProvider } from "../push/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface ChatDB {
  /** Returns messages ordered by created_at ASC (oldest first). */
  getChatMessages(userId: string, limit: number, offset: number): Promise<ChatMessage[]>;
  getChatMessagesSince(userId: string, sinceId: number): Promise<ChatMessage[]>;
  sendChatMessage(userId: string, sender: string, message: string, messageType: string): Promise<ChatMessage>;
  markChatRead(userId: string, reader: string): Promise<void>;
  getUnreadCount(userId: string): Promise<number>;
  adminListChatThreads(limit: number): Promise<ChatThread[]>;
  enabledDeviceTokens(userId: string): Promise<string[]>;
}

export interface ChatMessage {
  id: number;
  user_id: string;
  sender: string;
  message: string;
  message_type: string;
  read_at: string | null;
  created_at: Date;
}

export interface ChatThread {
  user_id: string;
  user_name: string;
  user_email: string;
  last_message: string;
  last_sender: string;
  unread_count: number;
  last_message_at: string;
}

export interface ChatConfig {
  parseToken: (token: string) => Promise<string>;
  adminAuth?: (req: Request) => boolean | Promise<boolean>;
  adminDisplayName?: string;
}

export interface WSEvent {
  type: string;
  payload?: unknown;
}

// ── WebSocket Hub ───────────────────────────────────────────────────────────

export interface WSConn {
  ws: WebSocket;
  userId: string;
  role: string;
}

export class Hub {
  private connections = new Map<string, Set<WSConn>>();

  private key(role: string, userId: string): string {
    return `${role}:${userId}`;
  }

  register(conn: WSConn): void {
    const k = this.key(conn.role, conn.userId);
    if (!this.connections.has(k)) this.connections.set(k, new Set());
    this.connections.get(k)!.add(conn);
  }

  unregister(conn: WSConn): void {
    const k = this.key(conn.role, conn.userId);
    this.connections.get(k)?.delete(conn);
    if (this.connections.get(k)?.size === 0) this.connections.delete(k);
  }

  hasActiveConnection(key: string): boolean {
    return (this.connections.get(key)?.size ?? 0) > 0;
  }

  broadcastToUser(userId: string, event: WSEvent): void {
    const data = JSON.stringify(event);
    for (const conn of this.connections.get(`user:${userId}`) ?? []) {
      try { conn.ws.send(data); } catch {}
    }
  }

  broadcastToAdmins(event: WSEvent): void {
    const data = JSON.stringify(event);
    for (const [key, conns] of this.connections) {
      if (key.startsWith("admin:")) {
        for (const conn of conns) {
          try { conn.ws.send(data); } catch {}
        }
      }
    }
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

export class ChatService {
  private hub = new Hub();

  constructor(
    private db: ChatDB,
    private push: PushProvider,
    private cfg: ChatConfig
  ) {}

  /** GET /api/v1/chat */
  handleGetChat = async (c: Context) => {
    const userId = c.get("userId") as string;
    const sinceIdStr = c.req.query("since_id");

    if (sinceIdStr) {
      const sinceId = parseInt(sinceIdStr, 10);
      if (isNaN(sinceId)) return c.json({ error: "invalid since_id" }, 400);
      const msgs = await this.db.getChatMessagesSince(userId, sinceId);
      await this.db.markChatRead(userId, "user").catch(() => {});
      return c.json({ messages: msgs, has_more: false });
    }

    let limit = 50;
    let offset = 0;
    const limitStr = c.req.query("limit");
    const offsetStr = c.req.query("offset");
    if (limitStr) { const n = parseInt(limitStr); if (n > 0 && n <= 200) limit = n; }
    if (offsetStr) { const n = parseInt(offsetStr); if (n >= 0) offset = n; }

    const msgs = await this.db.getChatMessages(userId, limit + 1, offset);
    await this.db.markChatRead(userId, "user").catch(() => {});

    const hasMore = msgs.length > limit;
    return c.json({ messages: hasMore ? msgs.slice(0, limit) : msgs, has_more: hasMore });
  };

  /** POST /api/v1/chat */
  handleSendChat = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{ message?: string; message_type?: string }>();

    if (!body.message) return c.json({ error: "message is required" }, 400);
    if (body.message.length > 5000) return c.json({ error: "message too long (max 5000 chars)" }, 400);

    let msg: ChatMessage;
    try {
      msg = await this.db.sendChatMessage(userId, "user", body.message, body.message_type ?? "text");
    } catch {
      return c.json({ error: "failed to send message" }, 500);
    }

    this.broadcastChatMessage(msg);
    return c.json({ status: "sent" }, 201);
  };

  /** GET /api/v1/chat/unread */
  handleUnreadCount = async (c: Context) => {
    const userId = c.get("userId") as string;
    const count = await this.db.getUnreadCount(userId).catch(() => 0);
    return c.json({ count });
  };

  /** GET /admin/api/chat */
  handleAdminListChats = async (c: Context) => {
    let limit = 100;
    const limitStr = c.req.query("limit");
    if (limitStr) { const n = parseInt(limitStr); if (n > 0 && n <= 500) limit = n; }

    const threads = await this.db.adminListChatThreads(limit).catch(() => []);
    return c.json({ threads, count: threads.length });
  };

  /** GET /admin/api/chat/:user_id */
  handleAdminGetChat = async (c: Context) => {
    const userId = c.req.param("user_id");
    if (!userId) return c.json({ error: "missing user_id" }, 400);

    let limit = 200, offset = 0;
    const limitStr = c.req.query("limit");
    const offsetStr = c.req.query("offset");
    if (limitStr) { const n = parseInt(limitStr); if (n > 0 && n <= 500) limit = n; }
    if (offsetStr) { const n = parseInt(offsetStr); if (n >= 0) offset = n; }

    const msgs = await this.db.getChatMessages(userId, limit, offset);
    await this.db.markChatRead(userId, "admin").catch(() => {});
    return c.json({ messages: msgs });
  };

  /** POST /admin/api/chat/:user_id */
  handleAdminReplyChat = async (c: Context) => {
    const userId = c.req.param("user_id");
    if (!userId) return c.json({ error: "missing user_id" }, 400);

    const body = await c.req.json<{ message?: string; message_type?: string }>();
    if (!body.message) return c.json({ error: "message is required" }, 400);

    let msg: ChatMessage;
    try {
      msg = await this.db.sendChatMessage(userId, "admin", body.message, body.message_type ?? "text");
    } catch {
      return c.json({ error: "failed to send reply" }, 500);
    }

    this.broadcastChatMessage(msg);

    // Send push if user has no active WebSocket
    if (!this.hub.hasActiveConnection(`user:${userId}`)) {
      this.sendChatPush(userId, body.message);
    }

    return c.json({ status: "sent" }, 201);
  };

  /** Get the Hub for WebSocket upgrade handlers. */
  getHub(): Hub {
    return this.hub;
  }

  /** Call from your WebSocket open handler to register a connection. Returns a cleanup function. */
  handleWSConnection(ws: WebSocket, userId: string, role: "user" | "admin"): () => void {
    const conn: WSConn = { ws, userId, role };
    this.hub.register(conn);
    return () => this.hub.unregister(conn);
  }

  private broadcastChatMessage(msg: ChatMessage): void {
    const event: WSEvent = {
      type: "new_message",
      payload: {
        id: msg.id,
        user_id: msg.user_id,
        sender: msg.sender,
        message: msg.message,
        message_type: msg.message_type,
        created_at: msg.created_at instanceof Date ? msg.created_at.toISOString() : msg.created_at,
      },
    };
    if (msg.sender === "user") {
      this.hub.broadcastToAdmins(event);
    } else {
      this.hub.broadcastToUser(msg.user_id, event);
    }
  }

  private async sendChatPush(userId: string, message: string): Promise<void> {
    const tokens = await this.db.enabledDeviceTokens(userId).catch(() => []);
    if (!tokens.length) return;

    const title = `New message from ${this.cfg.adminDisplayName ?? "Support"}`;
    const body = message.length > 100 ? message.slice(0, 97) + "..." : message;
    const data = { type: "chat_message", user_id: userId };

    for (const token of tokens) {
      await this.push.sendWithData(token, title, body, data).catch((err) => {
        console.log(`[chat-push] failed: ${err}`);
      });
    }
  }
}
