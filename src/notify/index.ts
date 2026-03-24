import type { Context } from "hono";
import type { PushProvider } from "../push/index.js";
import { randomUUID } from "node:crypto";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface NotifyDB {
  upsertDeviceToken(dt: DeviceToken): Promise<void>;
  disableDeviceToken(userId: string, token: string): Promise<void>;
  enabledDeviceTokens(userId: string): Promise<DeviceToken[]>;
  ensureNotificationPreferences(userId: string): Promise<void>;
  getNotificationPreferences(userId: string): Promise<NotificationPreferences>;
  upsertNotificationPreferences(prefs: NotificationPreferences): Promise<void>;
  allUsersWithNotificationsEnabled(): Promise<string[]>;
  lastNotificationDelivery(userId: string): Promise<NotificationDelivery | null>;
  recordNotificationDelivery(userId: string, kind: string, title: string, body: string): Promise<void>;
  trackNotificationOpened(userId: string, notificationId: string): Promise<void>;
}

export interface DeviceToken {
  id: string;
  user_id: string;
  token: string;
  platform: string;
  device_model: string;
  os_version: string;
  app_version: string;
  enabled: boolean;
  last_seen_at: Date | string;
}

export interface NotificationPreferences {
  user_id: string;
  push_enabled: boolean;
  interval_seconds: number;
  wake_hour: number;
  sleep_hour: number;
  timezone: string;
  stop_after_goal: boolean;
}

export interface NotificationDelivery {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  sent_at: Date | string;
}

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

// ── Service ─────────────────────────────────────────────────────────────────

export class NotifyService {
  constructor(
    private db: NotifyDB,
    private push: PushProvider
  ) {}

  /** POST /api/v1/notifications/devices */
  handleRegisterDevice = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{
      token?: string;
      platform?: string;
      device_model?: string;
      os_version?: string;
      app_version?: string;
    }>();

    if (!body.token) return c.json({ error: "token is required" }, 400);
    if (body.token.length > 200) return c.json({ error: "token too long" }, 400);
    if (body.device_model && body.device_model.length > 100) return c.json({ error: "device_model too long" }, 400);
    if (body.os_version && body.os_version.length > 50) return c.json({ error: "os_version too long" }, 400);
    if (body.app_version && body.app_version.length > 50) return c.json({ error: "app_version too long" }, 400);

    const dt: DeviceToken = {
      id: randomUUID(),
      user_id: userId,
      token: body.token,
      platform: body.platform ?? "ios",
      device_model: body.device_model ?? "",
      os_version: body.os_version ?? "",
      app_version: body.app_version ?? "",
      enabled: true,
      last_seen_at: new Date(),
    };

    try {
      await this.db.upsertDeviceToken(dt);
      await this.db.ensureNotificationPreferences(userId);
    } catch {
      return c.json({ error: "failed to register device" }, 500);
    }

    console.log(`[device] registered ${dt.platform} for ${userId} (${dt.device_model} ${dt.os_version} app=${dt.app_version})`);
    return c.json({ status: "registered" }, 201);
  };

  /** DELETE /api/v1/notifications/devices */
  handleDisableDevice = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{ token?: string }>();
    if (!body.token) return c.json({ error: "token is required" }, 400);

    try {
      await this.db.disableDeviceToken(userId, body.token);
    } catch {
      return c.json({ error: "failed to disable device" }, 500);
    }
    return c.json({ status: "disabled" });
  };

  /** GET /api/v1/notifications/preferences */
  handleGetPrefs = async (c: Context) => {
    const userId = c.get("userId") as string;
    try {
      const prefs = await this.db.getNotificationPreferences(userId);
      return c.json(prefs);
    } catch {
      return c.json({ error: "failed to get preferences" }, 500);
    }
  };

  /** PUT /api/v1/notifications/preferences */
  handleUpdatePrefs = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<Partial<{
      push_enabled: boolean;
      interval_seconds: number;
      wake_hour: number;
      sleep_hour: number;
      timezone: string;
      stop_after_goal: boolean;
    }>>();

    let existing: NotificationPreferences;
    try {
      existing = await this.db.getNotificationPreferences(userId);
    } catch {
      return c.json({ error: "failed to get preferences" }, 500);
    }

    const prefs = { ...existing };
    if (body.push_enabled !== undefined) prefs.push_enabled = body.push_enabled;
    if (body.interval_seconds !== undefined) {
      if (body.interval_seconds < 300) return c.json({ error: "interval_seconds must be at least 300 (5 minutes)" }, 400);
      prefs.interval_seconds = body.interval_seconds;
    }
    if (body.wake_hour !== undefined) {
      if (body.wake_hour < 0 || body.wake_hour > 23) return c.json({ error: "wake_hour must be 0-23" }, 400);
      prefs.wake_hour = body.wake_hour;
    }
    if (body.sleep_hour !== undefined) {
      if (body.sleep_hour < 0 || body.sleep_hour > 23) return c.json({ error: "sleep_hour must be 0-23" }, 400);
      prefs.sleep_hour = body.sleep_hour;
    }
    if (body.timezone !== undefined) prefs.timezone = body.timezone;
    if (body.stop_after_goal !== undefined) prefs.stop_after_goal = body.stop_after_goal;

    try {
      await this.db.upsertNotificationPreferences(prefs);
    } catch {
      return c.json({ error: "failed to update preferences" }, 500);
    }
    return c.json(prefs);
  };

  /** POST /api/v1/notifications/opened */
  handleNotificationOpened = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{ notification_id?: string }>();
    await this.db.trackNotificationOpened(userId, body.notification_id ?? "").catch(() => {});
    return c.json({ status: "recorded" });
  };
}

// ── Notification Scheduler ──────────────────────────────────────────────────

export type TickFunc = (
  userId: string,
  prefs: NotificationPreferences,
  tokens: DeviceToken[],
  push: PushProvider
) => Promise<void>;

export interface NotifySchedulerConfig {
  intervalMs?: number;
  tickFunc: TickFunc;
  extraTick?: () => Promise<void>;
}

export class NotifyScheduler {
  private db: NotifyDB;
  private push: PushProvider;
  private intervalMs: number;
  private tickFn: TickFunc;
  private extraTick?: () => Promise<void>;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(db: NotifyDB, push: PushProvider, cfg: NotifySchedulerConfig) {
    this.db = db;
    this.push = push;
    this.intervalMs = cfg.intervalMs ?? 15 * 60 * 1000;
    this.tickFn = cfg.tickFunc;
    this.extraTick = cfg.extraTick;
  }

  start(): void {
    this.evaluate();
    this.interval = setInterval(() => this.evaluate(), this.intervalMs);
    console.log(`[scheduler] started with interval ${this.intervalMs}ms`);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    console.log("[scheduler] stopped");
  }

  private async evaluate(): Promise<void> {
    const start = Date.now();
    let userIds: string[];
    try {
      userIds = await this.db.allUsersWithNotificationsEnabled();
    } catch (err) {
      console.log(`[scheduler] error fetching users: ${err}`);
      return;
    }

    if (!userIds.length) return;
    console.log(`[scheduler] evaluating ${userIds.length} users`);

    for (const uid of userIds) {
      await this.maybeNotify(uid);
    }

    if (this.extraTick) await this.extraTick();
    console.log(`[scheduler] tick complete in ${Date.now() - start}ms`);
  }

  private async maybeNotify(userId: string): Promise<void> {
    const prefs = await this.db.getNotificationPreferences(userId).catch(() => null);
    if (!prefs?.push_enabled) return;

    // Check waking hours using user's timezone
    const now = new Date();
    const currentHour = parseInt(
      new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: prefs.timezone }).format(now), 10
    );
    if (currentHour < prefs.wake_hour || currentHour >= prefs.sleep_hour) return;

    // Check interval since last notification
    const last = await this.db.lastNotificationDelivery(userId).catch(() => null);
    if (last) {
      const elapsed = Date.now() - toDate(last.sent_at).getTime();
      if (elapsed < prefs.interval_seconds * 1000) return;
    }

    const tokens = await this.db.enabledDeviceTokens(userId).catch(() => []);
    if (!tokens.length) return;

    await this.tickFn(userId, prefs, tokens, this.push);
  }
}

export async function defaultTick(
  userId: string,
  _prefs: NotificationPreferences,
  tokens: DeviceToken[],
  push: PushProvider
): Promise<void> {
  for (const token of tokens) {
    try {
      await push.send(token.token, "Hey!", "Don't forget to check in today.");
    } catch (err) {
      console.log(`[scheduler] push failed for ${userId}: ${err}`);
    }
  }
}
