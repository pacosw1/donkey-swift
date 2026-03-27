import { eq, and, sql } from "drizzle-orm";
import type { NotifyDB, DeviceToken, NotificationPreferences, NotificationDelivery } from "../notify/index.js";
import type { DrizzleDB } from "./index.js";
import { userDeviceTokens, userNotificationPreferences, notificationDeliveries } from "./schema.js";
import { randomUUID } from "node:crypto";

/** Mixin: adds NotifyDB methods to PostgresDB. */
export function withNotifyDB(db: DrizzleDB): NotifyDB {
  return {
    async upsertDeviceToken(dt: DeviceToken): Promise<void> {
      await db
        .insert(userDeviceTokens)
        .values({
          id: dt.id,
          userId: dt.user_id,
          token: dt.token,
          platform: dt.platform,
          deviceModel: dt.device_model,
          osVersion: dt.os_version,
          appVersion: dt.app_version,
          enabled: true,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [userDeviceTokens.userId, userDeviceTokens.token],
          set: {
            id: dt.id,
            platform: dt.platform,
            deviceModel: dt.device_model,
            osVersion: dt.os_version,
            appVersion: dt.app_version,
            enabled: true,
            lastSeenAt: new Date(),
          },
        });
    },

    async disableDeviceToken(userId: string, token: string): Promise<void> {
      await db
        .update(userDeviceTokens)
        .set({ enabled: false })
        .where(and(eq(userDeviceTokens.userId, userId), eq(userDeviceTokens.token, token)));
    },

    async enabledDeviceTokens(userId: string): Promise<DeviceToken[]> {
      const rows = await db
        .select()
        .from(userDeviceTokens)
        .where(and(eq(userDeviceTokens.userId, userId), eq(userDeviceTokens.enabled, true)));

      return rows.map((r) => ({
        id: r.id,
        user_id: r.userId,
        token: r.token,
        platform: r.platform,
        device_model: r.deviceModel,
        os_version: r.osVersion,
        app_version: r.appVersion,
        enabled: r.enabled,
        last_seen_at: r.lastSeenAt,
      }));
    },

    async ensureNotificationPreferences(userId: string): Promise<void> {
      await db
        .insert(userNotificationPreferences)
        .values({ userId })
        .onConflictDoNothing();
    },

    async getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
      const [row] = await db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, userId))
        .limit(1);

      if (!row) {
        return {
          user_id: userId,
          push_enabled: true,
          interval_seconds: 3600,
          wake_hour: 8,
          sleep_hour: 22,
          timezone: "America/New_York",
          stop_after_goal: true,
        };
      }

      return {
        user_id: row.userId,
        push_enabled: row.pushEnabled,
        interval_seconds: row.intervalSeconds,
        wake_hour: row.wakeHour,
        sleep_hour: row.sleepHour,
        timezone: row.timezone,
        stop_after_goal: row.stopAfterGoal,
      };
    },

    async upsertNotificationPreferences(prefs: NotificationPreferences): Promise<void> {
      await db
        .insert(userNotificationPreferences)
        .values({
          userId: prefs.user_id,
          pushEnabled: prefs.push_enabled,
          intervalSeconds: prefs.interval_seconds,
          wakeHour: prefs.wake_hour,
          sleepHour: prefs.sleep_hour,
          timezone: prefs.timezone,
          stopAfterGoal: prefs.stop_after_goal,
        })
        .onConflictDoUpdate({
          target: userNotificationPreferences.userId,
          set: {
            pushEnabled: prefs.push_enabled,
            intervalSeconds: prefs.interval_seconds,
            wakeHour: prefs.wake_hour,
            sleepHour: prefs.sleep_hour,
            timezone: prefs.timezone,
            stopAfterGoal: prefs.stop_after_goal,
          },
        });
    },

    async allUsersWithNotificationsEnabled(): Promise<string[]> {
      const rows = await db
        .select({ userId: userNotificationPreferences.userId })
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.pushEnabled, true));

      return rows.map((r) => r.userId);
    },

    async lastNotificationDelivery(userId: string): Promise<NotificationDelivery | null> {
      const [row] = await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.userId, userId))
        .orderBy(sql`${notificationDeliveries.sentAt} DESC`)
        .limit(1);

      if (!row) return null;
      return {
        id: row.id,
        user_id: row.userId,
        kind: row.kind,
        title: row.title,
        body: row.body,
        status: row.status,
        sent_at: row.sentAt,
      };
    },

    async recordNotificationDelivery(userId: string, kind: string, title: string, body: string): Promise<string> {
      const id = randomUUID();
      await db.insert(notificationDeliveries).values({
        id,
        userId,
        kind,
        title,
        body,
      });
      return id;
    },

    async trackNotificationOpened(userId: string, notificationId: string): Promise<void> {
      await db
        .update(notificationDeliveries)
        .set({ status: "opened" })
        .where(and(eq(notificationDeliveries.id, notificationId), eq(notificationDeliveries.userId, userId)));
    },
  };
}
