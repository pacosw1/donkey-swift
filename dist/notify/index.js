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
        let prefs;
        try {
            prefs = await this.db.getNotificationPreferences(userId);
        }
        catch {
            return c.json({ error: "failed to get preferences" }, 500);
        }
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
    interval = null;
    constructor(db, push, cfg) {
        this.db = db;
        this.push = push;
        this.intervalMs = cfg.intervalMs ?? 15 * 60 * 1000;
        this.tickFn = cfg.tickFunc;
        this.extraTick = cfg.extraTick;
    }
    start() {
        this.evaluate();
        this.interval = setInterval(() => this.evaluate(), this.intervalMs);
        console.log(`[scheduler] started with interval ${this.intervalMs}ms`);
    }
    stop() {
        if (this.interval)
            clearInterval(this.interval);
        this.interval = null;
        console.log("[scheduler] stopped");
    }
    async evaluate() {
        const start = Date.now();
        let userIds;
        try {
            userIds = await this.db.allUsersWithNotificationsEnabled();
        }
        catch (err) {
            console.log(`[scheduler] error fetching users: ${err}`);
            return;
        }
        if (!userIds.length)
            return;
        console.log(`[scheduler] evaluating ${userIds.length} users`);
        for (const uid of userIds) {
            await this.maybeNotify(uid);
        }
        if (this.extraTick)
            await this.extraTick();
        console.log(`[scheduler] tick complete in ${Date.now() - start}ms`);
    }
    async maybeNotify(userId) {
        const prefs = await this.db.getNotificationPreferences(userId).catch(() => null);
        if (!prefs?.push_enabled)
            return;
        // Check waking hours using user's timezone
        const now = new Date();
        const currentHour = parseInt(new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: prefs.timezone }).format(now), 10);
        if (currentHour < prefs.wake_hour || currentHour >= prefs.sleep_hour)
            return;
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
export async function defaultTick(userId, _prefs, tokens, push) {
    for (const token of tokens) {
        try {
            await push.send(token.token, "Hey!", "Don't forget to check in today.");
        }
        catch (err) {
            console.log(`[scheduler] push failed for ${userId}: ${err}`);
        }
    }
}
//# sourceMappingURL=index.js.map