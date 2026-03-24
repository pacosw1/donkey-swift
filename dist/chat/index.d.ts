import type { Context } from "hono";
import type { PushProvider } from "../push/index.js";
export interface ChatDB {
    /** Returns messages ordered by created_at DESC (newest first). */
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
export interface WSConn {
    ws: WebSocket;
    userId: string;
    role: string;
}
export declare class Hub {
    private connections;
    private key;
    register(conn: WSConn): void;
    unregister(conn: WSConn): void;
    hasActiveConnection(key: string): boolean;
    broadcastToUser(userId: string, event: WSEvent): void;
    broadcastToAdmins(event: WSEvent): void;
}
export declare class ChatService {
    private db;
    private push;
    private cfg;
    private hub;
    constructor(db: ChatDB, push: PushProvider, cfg: ChatConfig);
    /** GET /api/v1/chat */
    handleGetChat: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        messages: {
            id: number;
            user_id: string;
            sender: string;
            message: string;
            message_type: string;
            read_at: string | null;
            created_at: string;
        }[];
        has_more: boolean;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /api/v1/chat */
    handleSendChat: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
        id: number;
        created_at: string;
    }, 201, "json">)>;
    /** GET /api/v1/chat/unread */
    handleUnreadCount: (c: Context) => Promise<Response & import("hono").TypedResponse<{
        count: number;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">>;
    /** GET /admin/api/chat */
    handleAdminListChats: (c: Context) => Promise<Response & import("hono").TypedResponse<{
        threads: never[] | {
            user_id: string;
            user_name: string;
            user_email: string;
            last_message: string;
            last_sender: string;
            unread_count: number;
            last_message_at: string;
        }[];
        count: number;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">>;
    /** GET /admin/api/chat/:user_id */
    handleAdminGetChat: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        messages: {
            id: number;
            user_id: string;
            sender: string;
            message: string;
            message_type: string;
            read_at: string | null;
            created_at: string;
        }[];
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /admin/api/chat/:user_id */
    handleAdminReplyChat: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, 201, "json">)>;
    /** Get the Hub for WebSocket upgrade handlers. */
    getHub(): Hub;
    /** Call from your WebSocket open handler to register a connection. Returns a cleanup function. */
    handleWSConnection(ws: WebSocket, userId: string, role: "user" | "admin"): () => void;
    private broadcastChatMessage;
    private sendChatPush;
}
//# sourceMappingURL=index.d.ts.map