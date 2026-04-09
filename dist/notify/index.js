import { randomUUID } from "node:crypto";
import { ValidationError, ServiceError } from "../errors/index.js";
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
    async registerDevice(userId, input) {
        if (!input.token)
            throw new ValidationError("token is required");
        if (input.token.length > 200)
            throw new ValidationError("token too long");
        if (input.device_model && input.device_model.length > 100)
            throw new ValidationError("device_model too long");
        if (input.os_version && input.os_version.length > 50)
            throw new ValidationError("os_version too long");
        if (input.app_version && input.app_version.length > 50)
            throw new ValidationError("app_version too long");
        if (input.apns_environment && !["production", "sandbox"].includes(input.apns_environment)) {
            throw new ValidationError("apns_environment must be 'production' or 'sandbox'");
        }
        if (input.build_channel && input.build_channel.length > 20) {
            throw new ValidationError("build_channel too long");
        }
        const dt = {
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
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to register device");
        }
        console.log(`[device] registered ${dt.platform} for ${userId} (${dt.device_model} ${dt.os_version} app=${dt.app_version})`);
        return { status: "registered" };
    }
    async disableDevice(userId, token) {
        if (!token)
            throw new ValidationError("token is required");
        try {
            await this.db.disableDeviceToken(userId, token);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to disable device");
        }
        return { status: "disabled" };
    }
    async getPreferences(userId) {
        try {
            return await this.db.getNotificationPreferences(userId);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to get preferences");
        }
    }
    async updatePreferences(userId, input) {
        let existing;
        try {
            existing = await this.db.getNotificationPreferences(userId);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to get preferences");
        }
        const prefs = { ...existing };
        if (input.push_enabled !== undefined)
            prefs.push_enabled = input.push_enabled;
        if (input.interval_seconds !== undefined) {
            if (input.interval_seconds < 300)
                throw new ValidationError("interval_seconds must be at least 300 (5 minutes)");
            prefs.interval_seconds = input.interval_seconds;
        }
        if (input.wake_hour !== undefined) {
            if (input.wake_hour < 0 || input.wake_hour > 23)
                throw new ValidationError("wake_hour must be 0-23");
            prefs.wake_hour = input.wake_hour;
        }
        if (input.sleep_hour !== undefined) {
            if (input.sleep_hour < 0 || input.sleep_hour > 23)
                throw new ValidationError("sleep_hour must be 0-23");
            prefs.sleep_hour = input.sleep_hour;
        }
        if (input.timezone !== undefined)
            prefs.timezone = input.timezone;
        if (input.stop_after_goal !== undefined)
            prefs.stop_after_goal = input.stop_after_goal;
        try {
            await this.db.upsertNotificationPreferences(prefs);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to update preferences");
        }
        return prefs;
    }
    /**
     * Record a notification delivery, then send a push to all enabled devices
     * with the `notification_id` embedded in the payload so the client can
     * POST it back for tap tracking.
     */
    async sendNotification(userId, kind, title, body, extraData) {
        const notificationId = await this.db.recordNotificationDelivery(userId, kind, title, body);
        const tokens = await this.db.enabledDeviceTokens(userId).catch(() => []);
        const data = { notification_id: notificationId, type: kind, ...extraData };
        for (const token of tokens) {
            try {
                if (this.push.sendRich && token.apns_topic) {
                    await this.push.sendRich(token.token, { aps: { alert: { title, body }, sound: "default" }, ...data }, { topic: token.apns_topic });
                }
                else {
                    await this.push.sendWithData(token.token, title, body, data);
                }
            }
            catch (err) {
                console.log(`[notify] push failed for ${userId}: ${err}`);
            }
        }
        return { notificationId };
    }
    async trackOpened(userId, notificationId) {
        if (!notificationId)
            throw new ValidationError("notification_id is required");
        await this.db.trackNotificationOpened(userId, notificationId);
    }
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
 * Example tick function. For tap tracking, prefer using NotifyService.sendNotification()
 * in your own tick — it records the delivery and includes `notification_id` in the
 * push payload so the client can POST it back via trackOpened().
 */
export async function exampleTick(userId, _prefs, tokens, push) {
    for (const token of tokens) {
        try {
            if (push.sendRich && token.apns_topic) {
                await push.sendRich(token.token, {
                    aps: { alert: { title: "Reminder", body: "Don't forget to check in today." }, sound: "default" },
                }, { topic: token.apns_topic });
            }
            else {
                await push.send(token.token, "Reminder", "Don't forget to check in today.");
            }
        }
        catch (err) {
            console.log(`[notify-scheduler] push failed for ${userId}: ${err}`);
        }
    }
}
//# sourceMappingURL=index.js.map