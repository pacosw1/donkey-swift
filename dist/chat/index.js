import { ValidationError, ServiceError } from "../errors/index.js";
export class Hub {
    connections = new Map();
    key(role, userId) {
        return `${role}:${userId}`;
    }
    register(conn) {
        const k = this.key(conn.role, conn.userId);
        if (!this.connections.has(k))
            this.connections.set(k, new Set());
        this.connections.get(k).add(conn);
    }
    unregister(conn) {
        const k = this.key(conn.role, conn.userId);
        this.connections.get(k)?.delete(conn);
        if (this.connections.get(k)?.size === 0)
            this.connections.delete(k);
    }
    hasActiveConnection(key) {
        return (this.connections.get(key)?.size ?? 0) > 0;
    }
    broadcastToUser(userId, event) {
        const data = JSON.stringify(event);
        for (const conn of this.connections.get(`user:${userId}`) ?? []) {
            try {
                conn.ws.send(data);
            }
            catch { }
        }
    }
    broadcastToAdmins(event) {
        const data = JSON.stringify(event);
        for (const [key, conns] of this.connections) {
            if (key.startsWith("admin:")) {
                for (const conn of conns) {
                    try {
                        conn.ws.send(data);
                    }
                    catch { }
                }
            }
        }
    }
}
// ── Service ─────────────────────────────────────────────────────────────────
export class ChatService {
    db;
    push;
    cfg;
    hub = new Hub();
    constructor(db, push, cfg) {
        this.db = db;
        this.push = push;
        this.cfg = cfg;
    }
    async getMessages(userId, opts) {
        if (opts?.since_id !== undefined) {
            if (isNaN(opts.since_id))
                throw new ValidationError("invalid since_id");
            let msgs;
            try {
                msgs = await this.db.getChatMessagesSince(userId, opts.since_id);
            }
            catch {
                throw new ServiceError("INTERNAL", "failed to get messages");
            }
            await this.db.markChatRead(userId, "user").catch(() => { });
            return { messages: msgs, has_more: false };
        }
        let limit = 50;
        let offset = 0;
        if (opts?.limit !== undefined && opts.limit > 0 && opts.limit <= 200)
            limit = opts.limit;
        if (opts?.offset !== undefined && opts.offset >= 0)
            offset = opts.offset;
        let msgs;
        try {
            msgs = await this.db.getChatMessages(userId, limit + 1, offset);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to get messages");
        }
        await this.db.markChatRead(userId, "user").catch(() => { });
        const hasMore = msgs.length > limit;
        return { messages: hasMore ? msgs.slice(0, limit) : msgs, has_more: hasMore };
    }
    async sendMessage(userId, message, messageType) {
        if (!message)
            throw new ValidationError("message is required");
        if (message.length > 5000)
            throw new ValidationError("message too long (max 5000 chars)");
        let msg;
        try {
            msg = await this.db.sendChatMessage(userId, "user", message, messageType ?? "text");
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to send message");
        }
        this.broadcastChatMessage(msg);
        return { status: "sent", id: msg.id, created_at: msg.created_at };
    }
    async getUnreadCount(userId) {
        const count = await this.db.getUnreadCount(userId).catch(() => 0);
        return { count };
    }
    async adminListChats(limit) {
        let effectiveLimit = 100;
        if (limit !== undefined && limit > 0 && limit <= 500)
            effectiveLimit = limit;
        const threads = await this.db.adminListChatThreads(effectiveLimit).catch(() => []);
        return { threads, count: threads.length };
    }
    async adminGetMessages(userId, limit, offset) {
        if (!userId)
            throw new ValidationError("missing user_id");
        let effectiveLimit = 200;
        let effectiveOffset = 0;
        if (limit !== undefined && limit > 0 && limit <= 500)
            effectiveLimit = limit;
        if (offset !== undefined && offset >= 0)
            effectiveOffset = offset;
        let msgs;
        try {
            msgs = await this.db.getChatMessages(userId, effectiveLimit, effectiveOffset);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to get messages");
        }
        await this.db.markChatRead(userId, "admin").catch(() => { });
        return { messages: msgs };
    }
    async adminReply(userId, message, messageType) {
        if (!userId)
            throw new ValidationError("missing user_id");
        if (!message)
            throw new ValidationError("message is required");
        if (message.length > 5000)
            throw new ValidationError("message too long (max 5000 chars)");
        let msg;
        try {
            msg = await this.db.sendChatMessage(userId, "admin", message, messageType ?? "text");
        }
        catch {
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
    getHub() {
        return this.hub;
    }
    /** Call from your WebSocket open handler to register a connection. Returns a cleanup function. */
    handleWSConnection(ws, userId, role) {
        const conn = { ws, userId, role };
        this.hub.register(conn);
        return () => this.hub.unregister(conn);
    }
    broadcastChatMessage(msg) {
        const event = {
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
        }
        else {
            this.hub.broadcastToUser(msg.user_id, event);
        }
    }
    async sendChatPush(userId, message) {
        const tokens = await this.db.enabledDeviceTokens(userId).catch(() => []);
        if (!tokens.length)
            return;
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
//# sourceMappingURL=index.js.map