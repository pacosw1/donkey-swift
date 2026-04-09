import type { PushProvider } from "../push/index.js";
import { ValidationError, ServiceError } from "../errors/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface ChatDB {
  /** Returns messages ordered by created_at DESC (newest first). */
  getChatMessages(userId: string, limit: number, offset: number): Promise<ChatMessage[]>;
  getChatMessagesSince(userId: string, sinceId: number): Promise<ChatMessage[]>;
  sendChatMessage(
    userId: string,
    sender: string,
    message: string,
    messageType: string,
    attachment?: ChatAttachmentInput | null,
  ): Promise<ChatMessage>;
  markChatRead(userId: string, reader: string): Promise<void>;
  getUnreadCount(userId: string): Promise<number>;
  adminListChatThreads(limit: number): Promise<ChatThread[]>;
  enabledDeviceTokens(userId: string): Promise<string[]>;
}

export interface ChatAttachmentInput {
  url: string;
  content_type: string;
  file_name?: string | null;
  size_bytes?: number | null;
}

export interface ChatAttachment extends ChatAttachmentInput {
  file_name: string | null;
  size_bytes: number | null;
}

export interface ChatMessage {
  id: number;
  user_id: string;
  sender: string;
  message: string;
  message_type: string;
  attachment?: ChatAttachment | null;
  read_at: string | null;
  created_at: Date | string;
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

  async getMessages(
    userId: string,
    opts?: { since_id?: number; limit?: number; offset?: number }
  ): Promise<{ messages: ChatMessage[]; has_more: boolean }> {
    if (opts?.since_id !== undefined) {
      if (isNaN(opts.since_id)) throw new ValidationError("invalid since_id");
      let msgs: ChatMessage[];
      try {
        msgs = await this.db.getChatMessagesSince(userId, opts.since_id);
      } catch {
        throw new ServiceError("INTERNAL", "failed to get messages");
      }
      await this.db.markChatRead(userId, "user").catch(() => {});
      return { messages: msgs, has_more: false };
    }

    let limit = 50;
    let offset = 0;
    if (opts?.limit !== undefined && opts.limit > 0 && opts.limit <= 200) limit = opts.limit;
    if (opts?.offset !== undefined && opts.offset >= 0) offset = opts.offset;

    let msgs: ChatMessage[];
    try {
      msgs = await this.db.getChatMessages(userId, limit + 1, offset);
    } catch {
      throw new ServiceError("INTERNAL", "failed to get messages");
    }
    await this.db.markChatRead(userId, "user").catch(() => {});

    const hasMore = msgs.length > limit;
    return { messages: hasMore ? msgs.slice(0, limit) : msgs, has_more: hasMore };
  }

  async sendMessage(
    userId: string,
    message: string,
    messageType?: string,
    attachment?: ChatAttachmentInput | null,
  ): Promise<{ status: string; id: number; created_at: Date | string }> {
    if (!message) throw new ValidationError("message is required");
    if (message.length > 5000) throw new ValidationError("message too long (max 5000 chars)");
    validateAttachment(attachment);

    let msg: ChatMessage;
    try {
      msg = await this.db.sendChatMessage(
        userId,
        "user",
        message,
        messageType ?? "text",
        attachment,
      );
    } catch {
      throw new ServiceError("INTERNAL", "failed to send message");
    }

    this.broadcastChatMessage(msg);
    return { status: "sent", id: msg.id, created_at: msg.created_at };
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.db.getUnreadCount(userId).catch(() => 0);
    return { count };
  }

  async adminListChats(limit?: number): Promise<{ threads: ChatThread[]; count: number }> {
    let effectiveLimit = 100;
    if (limit !== undefined && limit > 0 && limit <= 500) effectiveLimit = limit;

    const threads = await this.db.adminListChatThreads(effectiveLimit).catch(() => []);
    return { threads, count: threads.length };
  }

  async adminGetMessages(
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ messages: ChatMessage[] }> {
    if (!userId) throw new ValidationError("missing user_id");

    let effectiveLimit = 200;
    let effectiveOffset = 0;
    if (limit !== undefined && limit > 0 && limit <= 500) effectiveLimit = limit;
    if (offset !== undefined && offset >= 0) effectiveOffset = offset;

    let msgs: ChatMessage[];
    try {
      msgs = await this.db.getChatMessages(userId, effectiveLimit, effectiveOffset);
    } catch {
      throw new ServiceError("INTERNAL", "failed to get messages");
    }
    await this.db.markChatRead(userId, "admin").catch(() => {});
    return { messages: msgs };
  }

  async adminReply(
    userId: string,
    message: string,
    messageType?: string,
    attachment?: ChatAttachmentInput | null,
  ): Promise<{ status: string; id: number; created_at: Date | string }> {
    if (!userId) throw new ValidationError("missing user_id");
    if (!message) throw new ValidationError("message is required");
    if (message.length > 5000) throw new ValidationError("message too long (max 5000 chars)");
    validateAttachment(attachment);

    let msg: ChatMessage;
    try {
      msg = await this.db.sendChatMessage(
        userId,
        "admin",
        message,
        messageType ?? "text",
        attachment,
      );
    } catch {
      throw new ServiceError("INTERNAL", "failed to send reply");
    }

    this.broadcastChatMessage(msg);

    // Send push if user has no active WebSocket
    if (!this.hub.hasActiveConnection(`user:${userId}`)) {
      this.sendChatPush(userId, message);
    }

    return { status: "sent", id: msg.id, created_at: msg.created_at };
  }

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
        attachment: msg.attachment ?? null,
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

function validateAttachment(attachment?: ChatAttachmentInput | null): void {
  if (!attachment) {
    return;
  }

  if (!attachment.url?.trim()) {
    throw new ValidationError("attachment url is required");
  }

  if (!attachment.content_type?.trim()) {
    throw new ValidationError("attachment content_type is required");
  }

  if (attachment.size_bytes !== undefined && attachment.size_bytes !== null && attachment.size_bytes < 0) {
    throw new ValidationError("attachment size_bytes must be positive");
  }
}
