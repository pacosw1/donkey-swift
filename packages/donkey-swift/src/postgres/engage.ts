import { eq, sql, and } from "drizzle-orm";
import type { EngageDB, EventInput, UserSubscription, EngagementData } from "../engage/index.js";
import type { DrizzleDB } from "./index.js";
import { userSubscriptions, userActivity, userSessions, userFeedback } from "./schema.js";

/** Mixin: adds EngageDB methods to PostgresDB. */
export function withEngageDB(db: DrizzleDB): EngageDB {
  return {
    async trackEvents(userId: string, events: EventInput[]): Promise<void> {
      if (!events.length) return;

      const values = events.map((e) => {
        let ts: Date;
        if (e.timestamp) {
          const parsed = new Date(e.timestamp);
          ts = isNaN(parsed.getTime()) ? new Date() : parsed;
        } else {
          ts = new Date();
        }
        return {
          userId,
          event: e.event,
          metadata: e.metadata ? JSON.parse(e.metadata) : {},
          createdAt: ts,
        };
      });

      await db.insert(userActivity).values(values);
    },

    async updateSubscription(userId: string, productId: string, status: string, expiresAt: Date | null): Promise<void> {
      await db
        .insert(userSubscriptions)
        .values({
          userId,
          productId,
          status,
          expiresAt,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userSubscriptions.userId,
          set: {
            productId,
            status,
            expiresAt,
            updatedAt: new Date(),
          },
        });
    },

    async updateSubscriptionDetails(userId: string, originalTransactionId: string, priceCents: number, currencyCode: string): Promise<void> {
      await db
        .update(userSubscriptions)
        .set({
          originalTransactionId,
          priceCents,
          currencyCode,
          updatedAt: new Date(),
        })
        .where(eq(userSubscriptions.userId, userId));
    },

    async getSubscription(userId: string): Promise<UserSubscription | null> {
      const [row] = await db
        .select()
        .from(userSubscriptions)
        .where(eq(userSubscriptions.userId, userId))
        .limit(1);

      if (!row) return null;
      return {
        user_id: row.userId,
        product_id: row.productId,
        status: row.status,
        expires_at: row.expiresAt,
        started_at: row.startedAt,
        updated_at: row.updatedAt,
      };
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

    async getEngagementData(userId: string): Promise<EngagementData> {
      const [metrics] = await db.execute<{
        days_active: string;
        total_logs: string;
        paywall_shown_count: string;
        last_paywall_date: string;
        goals_completed_total: string;
      }>(sql`
        SELECT
          COUNT(DISTINCT DATE(created_at)) AS days_active,
          COUNT(*) AS total_logs,
          COUNT(*) FILTER (WHERE event = 'paywall_shown') AS paywall_shown_count,
          COALESCE(MAX(created_at) FILTER (WHERE event = 'paywall_shown'), '1970-01-01')::TEXT AS last_paywall_date,
          COUNT(*) FILTER (WHERE event = 'goal_completed') AS goals_completed_total
        FROM user_activity
        WHERE user_id = ${userId}
      `);

      // Subscription status
      const [subRow] = await db.execute<{ status: string }>(sql`
        SELECT status FROM user_subscriptions WHERE user_id = ${userId}
      `);

      // Compute streak
      const streakRows = await db.execute<{ d: string }>(sql`
        SELECT DISTINCT DATE(created_at) AS d
        FROM user_activity
        WHERE user_id = ${userId}
        ORDER BY d DESC
      `);

      let streak = 0;
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      let expected = new Date(today);

      for (const row of streakRows) {
        const day = new Date(row.d);
        day.setUTCHours(0, 0, 0, 0);
        if (day.getTime() === expected.getTime()) {
          streak++;
          expected = new Date(expected.getTime() - 24 * 60 * 60 * 1000);
        } else if (day.getTime() < expected.getTime()) {
          break;
        }
      }

      return {
        days_active: Number(metrics?.days_active ?? 0),
        total_logs: Number(metrics?.total_logs ?? 0),
        current_streak: streak,
        subscription_status: subRow?.status ?? "free",
        paywall_shown_count: Number(metrics?.paywall_shown_count ?? 0),
        last_paywall_date: metrics?.last_paywall_date ?? "1970-01-01",
        goals_completed_total: Number(metrics?.goals_completed_total ?? 0),
      };
    },

    async startSession(userId: string, sessionId: string, appVersion: string, osVersion: string, country: string): Promise<void> {
      await db.insert(userSessions).values({
        id: sessionId,
        userId,
        appVersion,
        osVersion,
        country,
      });
    },

    async endSession(userId: string, sessionId: string, durationS: number): Promise<void> {
      await db
        .update(userSessions)
        .set({ endedAt: new Date(), durationS })
        .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)));
    },

    async saveFeedback(userId: string, feedbackType: string, message: string, appVersion: string): Promise<void> {
      await db.insert(userFeedback).values({
        userId,
        type: feedbackType,
        message,
        appVersion,
      });
    },
  };
}
