import { sql } from "drizzle-orm";
import type { AnalyticsDB, DAURow, EventRow, SubStats } from "../analytics/index.js";
import type { DrizzleDB } from "./index.js";

/** Mixin: adds AnalyticsDB methods to PostgresDB. */
export function withAnalyticsDB(db: DrizzleDB): AnalyticsDB {
  return {
    async dauTimeSeries(since: Date): Promise<DAURow[]> {
      const rows = await db.execute<{ date: string; dau: string }>(sql`
        SELECT DATE(created_at) AS date, COUNT(DISTINCT user_id) AS dau
        FROM user_activity
        WHERE created_at >= ${since}
        GROUP BY DATE(created_at)
        ORDER BY date
      `);
      return rows.map((r) => ({ date: r.date, dau: Number(r.dau) }));
    },

    async eventCounts(since: Date, event?: string): Promise<EventRow[]> {
      const eventFilter = event ?? "";
      const rows = await db.execute<{ date: string; event: string; count: string; unique_users: string }>(sql`
        SELECT DATE(created_at) AS date, event, COUNT(*) AS count, COUNT(DISTINCT user_id) AS unique_users
        FROM user_activity
        WHERE created_at >= ${since} AND (${eventFilter} = '' OR event = ${eventFilter})
        GROUP BY DATE(created_at), event
        ORDER BY date
      `);
      return rows.map((r) => ({
        date: r.date,
        event: r.event,
        count: Number(r.count),
        unique_users: Number(r.unique_users),
      }));
    },

    async subscriptionBreakdown(): Promise<SubStats[]> {
      const rows = await db.execute<{ status: string; count: string }>(sql`
        SELECT status, COUNT(*) AS count FROM user_subscriptions GROUP BY status
      `);
      return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
    },

    async newSubscriptions30d(): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM user_subscriptions
        WHERE started_at >= NOW() - INTERVAL '30 days'
      `);
      return Number(row?.count ?? 0);
    },

    async churnedSubscriptions30d(): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM user_subscriptions
        WHERE status IN ('expired', 'cancelled')
          AND updated_at >= NOW() - INTERVAL '30 days'
      `);
      return Number(row?.count ?? 0);
    },

    async dauToday(): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(DISTINCT user_id) AS count FROM user_activity
        WHERE DATE(created_at) = CURRENT_DATE
      `);
      return Number(row?.count ?? 0);
    },

    async mau(): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(DISTINCT user_id) AS count FROM user_activity
        WHERE created_at >= NOW() - INTERVAL '30 days'
      `);
      return Number(row?.count ?? 0);
    },

    async totalUsers(): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM users
      `);
      return Number(row?.count ?? 0);
    },

    async activeSubscriptions(): Promise<number> {
      const [row] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM user_subscriptions
        WHERE status IN ('active', 'trial')
      `);
      return Number(row?.count ?? 0);
    },
  };
}
