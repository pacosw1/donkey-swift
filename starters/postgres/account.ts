import { eq, sql } from "drizzle-orm";
import type { AccountDB, UserDataExport } from "../account/index.js";
import type { DrizzleDB } from "./index.js";
import { users } from "./schema.js";

/** Mixin: adds AccountDB methods to PostgresDB. */
export function withAccountDB(db: DrizzleDB): AccountDB {
  return {
    async getUserEmail(userId: string): Promise<string> {
      const [row] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!row) throw new Error(`user not found: ${userId}`);
      return row.email;
    },

    async deleteUserData(userId: string): Promise<void> {
      const tables = [
        "feature_flag_overrides",
        "verified_transactions",
        "tombstones",
        "chat_messages",
        "notification_deliveries",
        "user_notification_preferences",
        "user_device_tokens",
        "user_sessions",
        "user_feedback",
        "user_activity",
        "user_subscriptions",
      ];

      for (const table of tables) {
        await db.execute(sql.raw(`DELETE FROM ${table} WHERE user_id = '${userId}'`)).catch(() => {});
      }
    },

    async deleteUser(userId: string): Promise<void> {
      await db.delete(users).where(eq(users.id, userId));
    },

    async anonymizeUser(userId: string): Promise<void> {
      await db.execute(sql`
        UPDATE users SET
          email = 'deleted-' || id || '@anonymized',
          name = 'Deleted User',
          apple_sub = 'anon-' || id
        WHERE id = ${userId}
      `);
    },

    async exportUserData(userId: string): Promise<UserDataExport> {
      // User profile
      const [user] = await db.execute<{ id: string; email: string; name: string; created_at: Date }>(sql`
        SELECT id, email, name, created_at FROM users WHERE id = ${userId}
      `);
      if (!user) throw new Error(`user not found: ${userId}`);

      const exportData: UserDataExport = { user };

      // Subscription
      const [sub] = await db.execute(sql`
        SELECT product_id, status, expires_at FROM user_subscriptions WHERE user_id = ${userId}
      `);
      if (sub) exportData.subscription = sub;

      // Events (last 1000)
      const events = await db.execute(sql`
        SELECT event, metadata::text, created_at FROM user_activity WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1000
      `);
      if (events.length) exportData.events = events;

      // Sessions
      const sessions = await db.execute(sql`
        SELECT id, started_at, ended_at, duration_s FROM user_sessions WHERE user_id = ${userId} ORDER BY started_at DESC LIMIT 500
      `);
      if (sessions.length) exportData.sessions = sessions;

      // Feedback
      const feedback = await db.execute(sql`
        SELECT type, message, app_version, created_at FROM user_feedback WHERE user_id = ${userId} ORDER BY created_at DESC
      `);
      if (feedback.length) exportData.feedback = feedback;

      // Chat messages
      const chatMsgs = await db.execute(sql`
        SELECT sender, message, message_type, created_at FROM chat_messages WHERE user_id = ${userId} ORDER BY created_at
      `);
      if (chatMsgs.length) exportData.chat_messages = chatMsgs;

      // Device tokens
      const deviceTokens = await db.execute(sql`
        SELECT platform, device_model, app_version, enabled FROM user_device_tokens WHERE user_id = ${userId}
      `);
      if (deviceTokens.length) exportData.device_tokens = deviceTokens;

      // Notification preferences
      const notifPrefs = await db.execute(sql`
        SELECT push_enabled, timezone, wake_hour, sleep_hour FROM user_notification_preferences WHERE user_id = ${userId}
      `);
      if (notifPrefs.length) exportData.notification_preferences = notifPrefs;

      // Transactions
      const transactions = await db.execute(sql`
        SELECT product_id, status, purchase_date, expires_date, price_cents, currency_code FROM verified_transactions WHERE user_id = ${userId}
      `);
      if (transactions.length) exportData.transactions = transactions;

      return exportData;
    },
  };
}
