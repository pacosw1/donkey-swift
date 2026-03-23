import { eq, and, gt, isNull, sql } from "drizzle-orm";
import type { ChatDB, ChatMessage, ChatThread } from "../chat/index.js";
import type { DrizzleDB } from "./index.js";
import { chatMessages, userDeviceTokens } from "./schema.js";

/** Mixin: adds ChatDB methods to PostgresDB. */
export function withChatDB(db: DrizzleDB): ChatDB {
  return {
    async getChatMessages(userId: string, limit: number, offset: number): Promise<ChatMessage[]> {
      const rows = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.userId, userId))
        .orderBy(sql`${chatMessages.createdAt} DESC`)
        .limit(limit)
        .offset(offset);

      return rows.map(mapMessage);
    },

    async getChatMessagesSince(userId: string, sinceId: number): Promise<ChatMessage[]> {
      const rows = await db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.userId, userId), gt(chatMessages.id, sinceId)))
        .orderBy(sql`${chatMessages.createdAt} ASC`);

      return rows.map(mapMessage);
    },

    async sendChatMessage(userId: string, sender: string, message: string, messageType: string): Promise<ChatMessage> {
      const [row] = await db
        .insert(chatMessages)
        .values({ userId, sender, message, messageType })
        .returning();

      return mapMessage(row);
    },

    async markChatRead(userId: string, reader: string): Promise<void> {
      await db.execute(sql`
        UPDATE chat_messages
        SET read_at = NOW()::text
        WHERE user_id = ${userId} AND sender != ${reader} AND read_at IS NULL
      `);
    },

    async getUnreadCount(userId: string): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count
        FROM chat_messages
        WHERE user_id = ${userId} AND sender = 'admin' AND read_at IS NULL
      `);
      return Number(row?.count ?? 0);
    },

    async adminListChatThreads(limit: number): Promise<ChatThread[]> {
      const rows = await db.execute<{
        user_id: string;
        user_name: string;
        user_email: string;
        last_message: string;
        last_sender: string;
        unread_count: string;
        last_message_at: string;
      }>(sql`
        SELECT
          cm.user_id,
          COALESCE(u.name, '') AS user_name,
          COALESCE(u.email, '') AS user_email,
          cm.last_message,
          cm.last_sender,
          COALESCE(unread.cnt, 0) AS unread_count,
          cm.last_message_at
        FROM (
          SELECT DISTINCT ON (user_id)
            user_id,
            message AS last_message,
            sender AS last_sender,
            created_at AS last_message_at
          FROM chat_messages
          ORDER BY user_id, created_at DESC
        ) cm
        LEFT JOIN users u ON u.id = cm.user_id
        LEFT JOIN (
          SELECT user_id, COUNT(*) AS cnt
          FROM chat_messages
          WHERE sender = 'user' AND read_at IS NULL
          GROUP BY user_id
        ) unread ON unread.user_id = cm.user_id
        ORDER BY cm.last_message_at DESC
        LIMIT ${limit}
      `);

      return rows.map((r) => ({
        user_id: r.user_id,
        user_name: r.user_name,
        user_email: r.user_email,
        last_message: r.last_message,
        last_sender: r.last_sender,
        unread_count: Number(r.unread_count),
        last_message_at: r.last_message_at,
      }));
    },

    async enabledDeviceTokens(userId: string): Promise<string[]> {
      const rows = await db
        .select({ token: userDeviceTokens.token })
        .from(userDeviceTokens)
        .where(and(eq(userDeviceTokens.userId, userId), eq(userDeviceTokens.enabled, true)));

      return rows.map((r) => r.token);
    },
  };
}

function mapMessage(row: typeof chatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    user_id: row.userId,
    sender: row.sender,
    message: row.message,
    message_type: row.messageType,
    read_at: row.readAt?.toISOString() ?? null,
    created_at: row.createdAt,
  };
}
