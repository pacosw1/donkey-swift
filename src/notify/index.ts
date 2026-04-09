import type { PushProvider } from "../push/index.js";
import { randomUUID } from "node:crypto";
import { ValidationError, ServiceError } from "../errors/index.js";

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
  /** Record a notification delivery and return the generated notification ID. */
  recordNotificationDelivery(userId: string, kind: string, title: string, body: string): Promise<string>;
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
  /** APNs topic override for this device (e.g. "com.app.watchkitapp" for watchOS). Falls back to PushConfig.topic if not set. */
  apns_topic?: string;
  /**
   * APNs environment this token was minted against. Relevant for apps that
   * ship a single backend for both TestFlight (sandbox) and App Store
   * (production) builds — the backend routes pushes to the correct APNs
   * endpoint by reading this field. Acceptable values: "production" |
   * "sandbox". Defaults to "production" when unset.
   */
  apns_environment?: string;
  /**
   * Build channel the device is running, e.g. "debug" | "testflight" |
   * "appstore". Orthogonal to `apns_environment` because the same build
   * channel can use either APNs env. Used for diagnostics fan-out and
   * environment-scoped notification delivery.
   */
  build_channel?: string;
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

  async registerDevice(
    userId: string,
    input: {
      token: string;
      platform?: string;
      device_model?: string;
      os_version?: string;
      app_version?: string;
      apns_topic?: string;
      /** "production" | "sandbox" — see DeviceToken.apns_environment. */
      apns_environment?: string;
      /** "debug" | "testflight" | "appstore" — see DeviceToken.build_channel. */
      build_channel?: string;
    }
  ): Promise<{ status: string }> {
    if (!input.token) throw new ValidationError("token is required");
    if (input.token.length > 200) throw new ValidationError("token too long");
    if (input.device_model && input.device_model.length > 100) throw new ValidationError("device_model too long");
    if (input.os_version && input.os_version.length > 50) throw new ValidationError("os_version too long");
    if (input.app_version && input.app_version.length > 50) throw new ValidationError("app_version too long");
    if (input.apns_environment && !["production", "sandbox"].includes(input.apns_environment)) {
      throw new ValidationError("apns_environment must be 'production' or 'sandbox'");
    }
    if (input.build_channel && input.build_channel.length > 20) {
      throw new ValidationError("build_channel too long");
    }

    const dt: DeviceToken = {
      id: randomUUID(),
      user_id: userId,
      token: input.token,
      platform: input.platform ?? "ios",
      device_model: input.device_model ?? "",
      os_version: input.os_version ?? "",
      app_version: input.app_version ?? "",
      enabled: true,
      last_seen_at: new Date(),
      apns_topic: input.apns_topic,
      apns_environment: input.apns_environment,
      build_channel: input.build_channel,
    };

    try {
      await this.db.upsertDeviceToken(dt);
      await this.db.ensureNotificationPreferences(userId);
    } catch {
      throw new ServiceError("INTERNAL", "failed to register device");
    }

    console.log(`[device] registered ${dt.platform} for ${userId} (${dt.device_model} ${dt.os_version} app=${dt.app_version})`);
    return { status: "registered" };
  }

  async disableDevice(userId: string, token: string): Promise<{ status: string }> {
    if (!token) throw new ValidationError("token is required");

    try {
      await this.db.disableDeviceToken(userId, token);
    } catch {
      throw new ServiceError("INTERNAL", "failed to disable device");
    }
    return { status: "disabled" };
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    try {
      return await this.db.getNotificationPreferences(userId);
    } catch {
      throw new ServiceError("INTERNAL", "failed to get preferences");
    }
  }

  async updatePreferences(
    userId: string,
    input: Partial<{
      push_enabled: boolean;
      interval_seconds: number;
      wake_hour: number;
      sleep_hour: number;
      timezone: string;
      stop_after_goal: boolean;
    }>
  ): Promise<NotificationPreferences> {
    let existing: NotificationPreferences;
    try {
      existing = await this.db.getNotificationPreferences(userId);
    } catch {
      throw new ServiceError("INTERNAL", "failed to get preferences");
    }

    const prefs = { ...existing };
    if (input.push_enabled !== undefined) prefs.push_enabled = input.push_enabled;
    if (input.interval_seconds !== undefined) {
      if (input.interval_seconds < 300) throw new ValidationError("interval_seconds must be at least 300 (5 minutes)");
      prefs.interval_seconds = input.interval_seconds;
    }
    if (input.wake_hour !== undefined) {
      if (input.wake_hour < 0 || input.wake_hour > 23) throw new ValidationError("wake_hour must be 0-23");
      prefs.wake_hour = input.wake_hour;
    }
    if (input.sleep_hour !== undefined) {
      if (input.sleep_hour < 0 || input.sleep_hour > 23) throw new ValidationError("sleep_hour must be 0-23");
      prefs.sleep_hour = input.sleep_hour;
    }
    if (input.timezone !== undefined) prefs.timezone = input.timezone;
    if (input.stop_after_goal !== undefined) prefs.stop_after_goal = input.stop_after_goal;

    try {
      await this.db.upsertNotificationPreferences(prefs);
    } catch {
      throw new ServiceError("INTERNAL", "failed to update preferences");
    }
    return prefs;
  }

  /**
   * Record a notification delivery, then send a push to all enabled devices
   * with the `notification_id` embedded in the payload so the client can
   * POST it back for tap tracking.
   */
  async sendNotification(
    userId: string,
    kind: string,
    title: string,
    body: string,
    extraData?: Record<string, string>
  ): Promise<{ notificationId: string }> {
    const notificationId = await this.db.recordNotificationDelivery(userId, kind, title, body);

    const tokens = await this.db.enabledDeviceTokens(userId).catch(() => [] as DeviceToken[]);
    const data: Record<string, string> = { notification_id: notificationId, type: kind, ...extraData };

    for (const token of tokens) {
      try {
        if (this.push.sendRich && token.apns_topic) {
          await this.push.sendRich(
            token.token,
            { aps: { alert: { title, body }, sound: "default" }, ...data },
            { topic: token.apns_topic }
          );
        } else {
          await this.push.sendWithData(token.token, title, body, data);
        }
      } catch (err) {
        console.log(`[notify] push failed for ${userId}: ${err}`);
      }
    }

    return { notificationId };
  }

  async trackOpened(userId: string, notificationId: string): Promise<void> {
    if (!notificationId) throw new ValidationError("notification_id is required");
    await this.db.trackNotificationOpened(userId, notificationId);
  }
}

// ── Notification Scheduler ──────────────────────────────────────────────────

export type TickFunc = (
  userId: string,
  prefs: NotificationPreferences,
  tokens: DeviceToken[],
  push: PushProvider
) => Promise<void>;

/** Checks whether a user has completed their daily goal. Used by stop_after_goal. */
export type GoalCheckFunc = (userId: string) => Promise<boolean>;

export interface NotifySchedulerConfig {
  intervalMs?: number;
  tickFunc: TickFunc;
  extraTick?: () => Promise<void>;
  /** If set and user has stop_after_goal enabled, skip notification when goal is met. */
  goalCheck?: GoalCheckFunc;
  /** Max concurrent user evaluations per tick (default: 50). */
  concurrency?: number;
}

export class NotifyScheduler {
  private db: NotifyDB;
  private push: PushProvider;
  private intervalMs: number;
  private tickFn: TickFunc;
  private extraTick?: () => Promise<void>;
  private goalCheck?: GoalCheckFunc;
  private concurrency: number;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(db: NotifyDB, push: PushProvider, cfg: NotifySchedulerConfig) {
    this.db = db;
    this.push = push;
    this.intervalMs = cfg.intervalMs ?? 15 * 60 * 1000;
    this.tickFn = cfg.tickFunc;
    this.extraTick = cfg.extraTick;
    this.goalCheck = cfg.goalCheck;
    this.concurrency = cfg.concurrency ?? 50;
  }

  start(): void {
    this.evaluate();
    this.interval = setInterval(() => this.evaluate(), this.intervalMs);
    console.log(`[notify-scheduler] started with interval ${this.intervalMs}ms`);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    console.log("[notify-scheduler] stopped");
  }

  private async evaluate(): Promise<void> {
    const start = Date.now();
    let userIds: string[];
    try {
      userIds = await this.db.allUsersWithNotificationsEnabled();
    } catch (err) {
      console.log(`[notify-scheduler] error fetching users: ${err}`);
      return;
    }

    if (!userIds.length) return;
    console.log(`[notify-scheduler] evaluating ${userIds.length} users`);

    // Process in concurrent batches
    for (let i = 0; i < userIds.length; i += this.concurrency) {
      const batch = userIds.slice(i, i + this.concurrency);
      await Promise.allSettled(batch.map((uid) => this.maybeNotify(uid)));
    }

    if (this.extraTick) await this.extraTick();
    console.log(`[notify-scheduler] tick complete in ${Date.now() - start}ms`);
  }

  private async maybeNotify(userId: string): Promise<void> {
    const prefs = await this.db.getNotificationPreferences(userId).catch(() => null);
    if (!prefs?.push_enabled) return;

    // Check waking hours using user's timezone
    const now = new Date();
    const currentHour = getHourInTimezone(now, prefs.timezone);
    if (currentHour < prefs.wake_hour || currentHour >= prefs.sleep_hour) return;

    // Check stop_after_goal
    if (prefs.stop_after_goal && this.goalCheck) {
      const goalMet = await this.goalCheck(userId).catch(() => false);
      if (goalMet) return;
    }

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

/** Get the current hour (0-23) in a timezone. Handles midnight correctly. */
export function getHourInTimezone(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour");
    return hourPart ? parseInt(hourPart.value, 10) : date.getHours();
  } catch {
    return date.getHours(); // fallback to server timezone
  }
}

/**
 * Example tick function. For tap tracking, prefer using NotifyService.sendNotification()
 * in your own tick — it records the delivery and includes `notification_id` in the
 * push payload so the client can POST it back via trackOpened().
 */
export async function exampleTick(
  userId: string,
  _prefs: NotificationPreferences,
  tokens: DeviceToken[],
  push: PushProvider
): Promise<void> {
  for (const token of tokens) {
    try {
      if (push.sendRich && token.apns_topic) {
        await push.sendRich(token.token, {
          aps: { alert: { title: "Reminder", body: "Don't forget to check in today." }, sound: "default" },
        }, { topic: token.apns_topic });
      } else {
        await push.send(token.token, "Reminder", "Don't forget to check in today.");
      }
    } catch (err) {
      console.log(`[notify-scheduler] push failed for ${userId}: ${err}`);
    }
  }
}
