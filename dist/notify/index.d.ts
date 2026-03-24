import type { Context } from "hono";
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
export declare class NotifyService {
    private db;
    private push;
    constructor(db: NotifyDB, push: PushProvider);
    /** POST /api/v1/notifications/devices */
    handleRegisterDevice: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, 201, "json">)>;
    /** DELETE /api/v1/notifications/devices */
    handleDisableDevice: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** GET /api/v1/notifications/preferences */
    handleGetPrefs: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        user_id: string;
        push_enabled: boolean;
        interval_seconds: number;
        wake_hour: number;
        sleep_hour: number;
        timezone: string;
        stop_after_goal: boolean;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
    /** PUT /api/v1/notifications/preferences */
    handleUpdatePrefs: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        user_id: string;
        push_enabled: boolean;
        interval_seconds: number;
        wake_hour: number;
        sleep_hour: number;
        timezone: string;
        stop_after_goal: boolean;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /api/v1/notifications/opened */
    handleNotificationOpened: (c: Context) => Promise<Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">>;
}
export type TickFunc = (userId: string, prefs: NotificationPreferences, tokens: DeviceToken[], push: PushProvider) => Promise<void>;
export interface NotifySchedulerConfig {
    intervalMs?: number;
    tickFunc: TickFunc;
    extraTick?: () => Promise<void>;
}
export declare class NotifyScheduler {
    private db;
    private push;
    private intervalMs;
    private tickFn;
    private extraTick?;
    private interval;
    constructor(db: NotifyDB, push: PushProvider, cfg: NotifySchedulerConfig);
    start(): void;
    stop(): void;
    private evaluate;
    private maybeNotify;
}
export declare function defaultTick(userId: string, _prefs: NotificationPreferences, tokens: DeviceToken[], push: PushProvider): Promise<void>;
//# sourceMappingURL=index.d.ts.map