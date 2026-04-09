import type { PushProvider } from "../push/index.js";
export interface ChatDB {
    /** Returns messages ordered by created_at DESC (newest first). */
    getChatMessages(userId: string, limit: number, offset: number): Promise<ChatMessage[]>;
    getChatMessagesSince(userId: string, sinceId: number): Promise<ChatMessage[]>;
    sendChatMessage(userId: string, sender: string, message: string, messageType: string, attachment?: ChatAttachmentInput | null): Promise<ChatMessage>;
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
    getMessages(userId: string, opts?: {
        since_id?: number;
        limit?: number;
        offset?: number;
    }): Promise<{
        messages: ChatMessage[];
        has_more: boolean;
    }>;
    sendMessage(userId: string, message: string, messageType?: string, attachment?: ChatAttachmentInput | null): Promise<{
        status: string;
        id: number;
        created_at: Date | string;
    }>;
    getUnreadCount(userId: string): Promise<{
        count: number;
    }>;
    adminListChats(limit?: number): Promise<{
        threads: ChatThread[];
        count: number;
    }>;
    adminGetMessages(userId: string, limit?: number, offset?: number): Promise<{
        messages: ChatMessage[];
    }>;
    adminReply(userId: string, message: string, messageType?: string, attachment?: ChatAttachmentInput | null): Promise<{
        status: string;
        id: number;
        created_at: Date | string;
    }>;
    /** Get the Hub for WebSocket upgrade handlers. */
    getHub(): Hub;
    /** Call from your WebSocket open handler to register a connection. Returns a cleanup function. */
    handleWSConnection(ws: WebSocket, userId: string, role: "user" | "admin"): () => void;
    private broadcastChatMessage;
    private sendChatPush;
}
//# sourceMappingURL=index.d.ts.map