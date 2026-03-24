import { eq, and, gte, like, sql } from "drizzle-orm";
import type { LifecycleDB } from "../lifecycle/index.js";
import type { DrizzleDB } from "./index.js";
import { userActivity, userSessions, userSubscriptions, userDeviceTokens } from "./schema.js";

/** Mixin: adds LifecycleDB methods to PostgresDB. */
export function withLifecycleDB(db: DrizzleDB): LifecycleDB {
  return {
    async userCreatedAndLastActive(userId: string): Promise<{ createdAt: Date; lastActiveAt: Date }> {
      const [row] = await db.execute<{ created_at: Date; last_active_at: Date }>(sql`
        SELECT u.created_at, COALESCE(MAX(a.created_at), u.created_at) AS last_active_at
        FROM users u
        LEFT JOIN user_activity a ON a.user_id = u.id
        WHERE u.id = ${userId}
        GROUP BY u.created_at
      `);
      if (!row) throw new Error(`user not found: ${userId}`);
      return { createdAt: row.created_at, lastActiveAt: row.last_active_at };
    },

    async countSessions(userId: string): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM user_sessions WHERE user_id = ${userId}
      `);
      return Number(row?.count ?? 0);
    },

    async countRecentSessions(userId: string, since: Date): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM user_sessions
        WHERE user_id = ${userId} AND started_at >= ${since}
      `);
      return Number(row?.count ?? 0);
    },

    async countDistinctEventDays(userId: string, eventName: string, since: Date): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(DISTINCT DATE(created_at)) AS count
        FROM user_activity
        WHERE user_id = ${userId} AND event = ${eventName} AND created_at >= ${since}
      `);
      return Number(row?.count ?? 0);
    },

    async isProUser(userId: string): Promise<boolean> {
      const [row] = await db.execute<{ exists: boolean }>(sql`
        SELECT EXISTS(
          SELECT 1 FROM user_subscriptions
          WHERE user_id = ${userId}
            AND status IN ('active', 'trial')
            AND (expires_at IS NULL OR expires_at > NOW())
        ) AS exists
      `);
      return row?.exists ?? false;
    },

    async lastPrompt(userId: string): Promise<{ promptType: string; promptAt: Date } | null> {
      const [row] = await db.execute<{ event: string; created_at: Date }>(sql`
        SELECT event, created_at FROM user_activity
        WHERE user_id = ${userId} AND event LIKE 'lifecycle_prompt_%'
        ORDER BY created_at DESC LIMIT 1
      `);
      if (!row) return null;
      return {
        promptType: row.event.replace(/^lifecycle_prompt_/, ""),
        promptAt: row.created_at,
      };
    },

    async countPrompts(userId: string, promptType: string, since: Date): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM user_activity
        WHERE user_id = ${userId} AND event = ${promptType} AND created_at >= ${since}
      `);
      return Number(row?.count ?? 0);
    },

    async recordPrompt(userId: string, event: string, metadata: string): Promise<void> {
      await db.insert(userActivity).values({
        userId,
        event,
        metadata: JSON.parse(metadata),
      });
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
