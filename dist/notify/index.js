import { randomUUID } from "node:crypto";
function toDate(d) {
    return d instanceof Date ? d : new Date(d);
}
// ── Service ─────────────────────────────────────────────────────────────────
export class NotifyService {
    db;
    push;
    constructor(db, push) {
        this.db = db;
        this.push = push;
    }
    /** POST /api/v1/notifications/devices */
    handleRegisterDevice = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.token)
            return c.json({ error: "token is required" }, 400);
        if (body.token.length > 200)
            return c.json({ error: "token too long" }, 400);
        if (body.device_model && body.device_model.length > 100)
            return c.json({ error: "device_model too long" }, 400);
        if (body.os_version && body.os_version.length > 50)
            return c.json({ error: "os_version too long" }, 400);
        if (body.app_version && body.app_version.length > 50)
            return c.json({ error: "app_version too long" }, 400);
        const dt = {
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
        }
        catch {
            return c.json({ error: "failed to register device" }, 500);
        }
        console.log(`[device] registered ${dt.platform} for ${userId} (${dt.device_model} ${dt.os_version} app=${dt.app_version})`);
        return c.json({ status: "registered" }, 201);
    };
    /** DELETE /api/v1/notifications/devices */
    handleDisableDevice = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.token)
            return c.json({ error: "token is required" }, 400);
        try {
            await this.db.disableDeviceToken(userId, body.token);
        }
        catch {
            return c.json({ error: "failed to disable device" }, 500);
        }
        return c.json({ status: "disabled" });
    };
    /** GET /api/v1/notifications/preferences */
    handleGetPrefs = async (c) => {
        const userId = c.get("userId");
        try {
            const prefs = await this.db.getNotificationPreferences(userId);
            return c.json(prefs);
        }
        catch {
            return c.json({ error: "failed to get preferences" }, 500);
        }
    };
    /** PUT /api/v1/notifications/preferences */
    handleUpdatePrefs = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        let existing;
        try {
            existing = await this.db.getNotificationPreferences(userId);
        }
        catch {
            return c.json({ error: "failed to get preferences" }, 500);
        }
        const prefs = { ...existing };
        if (body.push_enabled !== undefined)
            prefs.push_enabled = body.push_enabled;
        if (body.interval_seconds !== undefined) {
            if (body.interval_seconds < 300)
                return c.json({ error: "interval_seconds must be at least 300 (5 minutes)" }, 400);
            prefs.interval_seconds = body.interval_seconds;
        }
        if (body.wake_hour !== undefined) {
            if (body.wake_hour < 0 || body.wake_hour > 23)
                return c.json({ error: "wake_hour must be 0-23" }, 400);
            prefs.wake_hour = body.wake_hour;
        }
        if (body.sleep_hour !== undefined) {
            if (body.sleep_hour < 0 || body.sleep_hour > 23)
                return c.json({ error: "sleep_hour must be 0-23" }, 400);
            prefs.sleep_hour = body.sleep_hour;
        }
        if (body.timezone !== undefined)
            prefs.timezone = body.timezone;
        if (body.stop_after_goal !== undefined)
            prefs.stop_after_goal = body.stop_after_goal;
        try {
            await this.db.upsertNotificationPreferences(prefs);
        }
        catch {
            return c.json({ error: "failed to update preferences" }, 500);
        }
        return c.json(prefs);
    };
    /** POST /api/v1/notifications/opened */
    handleNotificationOpened = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        await this.db.trackNotificationOpened(userId, body.notification_id ?? "").catch(() => { });
        return c.json({ status: "recorded" });
    };
}
export class NotifyScheduler {
    db;
    push;
    intervalMs;
    tickFn;
    extraTick;
    goalCheck;
    concurrency;
    interval = null;
    constructor(db, push, cfg) {
        this.db = db;
        this.push = push;
        this.intervalMs = cfg.intervalMs ?? 15 * 60 * 1000;
        this.tickFn = cfg.tickFunc;
        this.extraTick = cfg.extraTick;
        this.goalCheck = cfg.goalCheck;
        this.concurrency = cfg.concurrency ?? 50;
    }
    start() {
        this.evaluate();
        this.interval = setInterval(() => this.evaluate(), this.intervalMs);
        console.log(`[notify-scheduler] started with interval ${this.intervalMs}ms`);
    }
    stop() {
        if (this.interval)
            clearInterval(this.interval);
        this.interval = null;
        console.log("[notify-scheduler] stopped");
    }
    async evaluate() {
        const start = Date.now();
        let userIds;
        try {
            userIds = await this.db.allUsersWithNotificationsEnabled();
        }
        catch (err) {
            console.log(`[notify-scheduler] error fetching users: ${err}`);
            return;
        }
        if (!userIds.length)
            return;
        console.log(`[notify-scheduler] evaluating ${userIds.length} users`);
        // Process in concurrent batches
        for (let i = 0; i < userIds.length; i += this.concurrency) {
            const batch = userIds.slice(i, i + this.concurrency);
            await Promise.allSettled(batch.map((uid) => this.maybeNotify(uid)));
        }
        if (this.extraTick)
            await this.extraTick();
        console.log(`[notify-scheduler] tick complete in ${Date.now() - start}ms`);
    }
    async maybeNotify(userId) {
        const prefs = await this.db.getNotificationPreferences(userId).catch(() => null);
        if (!prefs?.push_enabled)
            return;
        // Check waking hours using user's timezone
        const now = new Date();
        const currentHour = getHourInTimezone(now, prefs.timezone);
        if (currentHour < prefs.wake_hour || currentHour >= prefs.sleep_hour)
            return;
        // Check stop_after_goal
        if (prefs.stop_after_goal && this.goalCheck) {
            const goalMet = await this.goalCheck(userId).catch(() => false);
            if (goalMet)
                return;
        }
        // Check interval since last notification
        const last = await this.db.lastNotificationDelivery(userId).catch(() => null);
        if (last) {
            const elapsed = Date.now() - toDate(last.sent_at).getTime();
            if (elapsed < prefs.interval_seconds * 1000)
                return;
        }
        const tokens = await this.db.enabledDeviceTokens(userId).catch(() => []);
        if (!tokens.length)
            return;
        await this.tickFn(userId, prefs, tokens, this.push);
    }
}
/** Get the current hour (0-23) in a timezone. Handles midnight correctly. */
export function getHourInTimezone(date, timezone) {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            hourCycle: "h23",
            timeZone: timezone,
        }).formatToParts(date);
        const hourPart = parts.find((p) => p.type === "hour");
        return hourPart ? parseInt(hourPart.value, 10) : date.getHours();
    }
    catch {
        return date.getHours(); // fallback to server timezone
    }
}
/**
 * Example tick function. Replace with your app-specific notification logic.
 * This exists as a reference — do not use in production without customizing the copy.
 */
export async function exampleTick(userId, _prefs, tokens, push) {
    for (const token of tokens) {
        try {
            await push.send(token.token, "Reminder", "Don't forget to check in today.");
        }
        catch (err) {
            console.log(`[notify-scheduler] push failed for ${userId}: ${err}`);
        }
    }
}
//# sourceMappingURL=index.js.map