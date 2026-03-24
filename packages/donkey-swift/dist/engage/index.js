// ── Default Paywall Trigger ─────────────────────────────────────────────────
export function defaultPaywallTrigger(data) {
    if (data.days_active >= 14 && data.total_logs >= 50)
        return "power_user";
    if (data.goals_completed_total >= 10 && data.paywall_shown_count < 3)
        return "milestone";
    return "";
}
// ── Service ─────────────────────────────────────────────────────────────────
const VALID_STATUSES = new Set(["active", "expired", "cancelled", "trial", "free"]);
const VALID_FEEDBACK_TYPES = new Set(["positive", "negative", "bug", "feature", "general"]);
export class EngageService {
    cfg;
    db;
    paywallTrigger;
    eventHooks = [];
    constructor(cfg, db) {
        this.cfg = cfg;
        this.db = db;
        this.paywallTrigger = cfg.paywallTrigger ?? defaultPaywallTrigger;
    }
    registerEventHook(hook) {
        this.eventHooks.push(hook);
    }
    /** POST /api/v1/events */
    handleTrackEvents = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.events?.length)
            return c.json({ error: "events array is required" }, 400);
        if (body.events.length > 100)
            return c.json({ error: "maximum 100 events per batch" }, 400);
        const dbEvents = body.events.map((e) => ({
            event: e.event,
            metadata: e.metadata ? JSON.stringify(e.metadata) : "{}",
            timestamp: e.timestamp ?? "",
        }));
        try {
            await this.db.trackEvents(userId, dbEvents);
        }
        catch {
            return c.json({ error: "failed to track events" }, 500);
        }
        for (const hook of this.eventHooks)
            hook(userId, dbEvents);
        return c.json({ tracked: dbEvents.length });
    };
    /** PUT /api/v1/subscription */
    handleUpdateSubscription = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.status)
            return c.json({ error: "status is required" }, 400);
        if (!VALID_STATUSES.has(body.status)) {
            return c.json({ error: "status must be one of: active, expired, cancelled, trial, free" }, 400);
        }
        const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
        try {
            await this.db.updateSubscription(userId, body.product_id ?? "", body.status, expiresAt);
        }
        catch {
            return c.json({ error: "failed to update subscription" }, 500);
        }
        if (body.original_transaction_id || (body.price_cents && body.price_cents > 0)) {
            await this.db.updateSubscriptionDetails(userId, body.original_transaction_id ?? "", body.price_cents ?? 0, body.currency_code ?? "USD").catch(() => { });
        }
        const sub = await this.db.getSubscription(userId).catch(() => null);
        return c.json(sub ?? { status: "updated" });
    };
    /** POST /api/v1/sessions */
    handleSessionReport = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.session_id || !body.action)
            return c.json({ error: "session_id and action required" }, 400);
        if (body.action !== "start" && body.action !== "end")
            return c.json({ error: "action must be 'start' or 'end'" }, 400);
        try {
            if (body.action === "start") {
                await this.db.startSession(userId, body.session_id, body.app_version ?? "", body.os_version ?? "", body.country ?? "");
            }
            else {
                await this.db.endSession(userId, body.session_id, body.duration_s ?? 0);
            }
        }
        catch {
            return c.json({ error: `failed to ${body.action} session` }, 500);
        }
        return c.json({ status: "ok" });
    };
    /** GET /api/v1/user/eligibility */
    handleGetEligibility = async (c) => {
        const userId = c.get("userId");
        let data;
        try {
            data = await this.db.getEngagementData(userId);
        }
        catch {
            return c.json({ error: "failed to get engagement data" }, 500);
        }
        const isPro = await this.db.isProUser(userId).catch(() => false);
        let paywallTrigger = null;
        if (!isPro) {
            const trigger = this.paywallTrigger(data);
            if (trigger)
                paywallTrigger = trigger;
        }
        return c.json({
            paywall_trigger: paywallTrigger,
            days_active: data.days_active,
            total_logs: data.total_logs,
            streak: data.current_streak,
            is_pro: isPro,
        });
    };
    /** POST /api/v1/feedback */
    handleSubmitFeedback = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.message)
            return c.json({ error: "message is required" }, 400);
        const feedbackType = body.type || "general";
        if (!VALID_FEEDBACK_TYPES.has(feedbackType)) {
            return c.json({ error: "type must be one of: positive, negative, bug, feature, general" }, 400);
        }
        try {
            await this.db.saveFeedback(userId, feedbackType, body.message, body.app_version ?? "");
        }
        catch {
            return c.json({ error: "failed to save feedback" }, 500);
        }
        return c.json({ status: "received" }, 201);
    };
}
//# sourceMappingURL=index.js.map