import type { PushProvider } from "../push/index.js";
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
export declare class NotifyService {
    private db;
    private push;
    constructor(db: NotifyDB, push: PushProvider);
    registerDevice(userId: string, input: {
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
    }): Promise<{
        status: string;
    }>;
    disableDevice(userId: string, token: string): Promise<{
        status: string;
    }>;
    getPreferences(userId: string): Promise<NotificationPreferences>;
    updatePreferences(userId: string, input: Partial<{
        push_enabled: boolean;
        interval_seconds: number;
        wake_hour: number;
        sleep_hour: number;
        timezone: string;
        stop_after_goal: boolean;
    }>): Promise<NotificationPreferences>;
    /**
     * Record a notification delivery, then send a push to all enabled devices
     * with the `notification_id` embedded in the payload so the client can
     * POST it back for tap tracking.
     */
    sendNotification(userId: string, kind: string, title: string, body: string, extraData?: Record<string, string>): Promise<{
        notificationId: string;
    }>;
    trackOpened(userId: string, notificationId: string): Promise<void>;
}
export type TickFunc = (userId: string, prefs: NotificationPreferences, tokens: DeviceToken[], push: PushProvider) => Promise<void>;
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
export declare class NotifyScheduler {
    private db;
    private push;
    private intervalMs;
    private tickFn;
    private extraTick?;
    private goalCheck?;
    private concurrency;
    private interval;
    constructor(db: NotifyDB, push: PushProvider, cfg: NotifySchedulerConfig);
    start(): void;
    stop(): void;
    private evaluate;
    private maybeNotify;
}
/** Get the current hour (0-23) in a timezone. Handles midnight correctly. */
export declare function getHourInTimezone(date: Date, timezone: string): number;
/**
 * Example tick function. For tap tracking, prefer using NotifyService.sendNotification()
 * in your own tick — it records the delivery and includes `notification_id` in the
 * push payload so the client can POST it back via trackOpened().
 */
export declare function exampleTick(userId: string, _prefs: NotificationPreferences, tokens: DeviceToken[], push: PushProvider): Promise<void>;
//# sourceMappingURL=index.d.ts.map