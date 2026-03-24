import { ValidationError, ServiceError } from "../errors/index.js";
// ── Default Paywall Trigger ─────────────────────────────────────────────────
export function defaultPaywallTrigger(data) {
    if (data.days_active >= 14 && data.total_logs >= 50)
        return "power_user";
    if (data.goals_completed_total >= 10 && data.paywall_shown_count < 3)
        return "milestone";
    return "";
}
// ── Service ─────────────────────────────────────────────────────────────────
export const VALID_STATUSES = new Set(["active", "expired", "cancelled", "trial", "free"]);
export const VALID_FEEDBACK_TYPES = new Set(["positive", "negative", "bug", "feature", "general"]);
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
    async trackEvents(userId, events) {
        if (!events?.length)
            throw new ValidationError("events array is required");
        if (events.length > 100)
            throw new ValidationError("maximum 100 events per batch");
        for (const e of events) {
            if (!e.event || typeof e.event !== "string")
                throw new ValidationError("each event must have a string 'event' field");
            if (e.event.length > 200)
                throw new ValidationError("event name too long (max 200 chars)");
        }
        const dbEvents = events.map((e) => ({
            event: e.event,
            metadata: e.metadata ? JSON.stringify(e.metadata).slice(0, 10_000) : "{}",
            timestamp: e.timestamp ?? "",
        }));
        try {
            await this.db.trackEvents(userId, dbEvents);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to track events");
        }
        for (const hook of this.eventHooks)
            hook(userId, dbEvents);
        return { tracked: dbEvents.length };
    }
    async updateSubscription(userId, input) {
        if (!input.status)
            throw new ValidationError("status is required");
        if (!VALID_STATUSES.has(input.status)) {
            throw new ValidationError("status must be one of: active, expired, cancelled, trial, free");
        }
        const expiresAt = input.expires_at ? new Date(input.expires_at) : null;
        try {
            await this.db.updateSubscription(userId, input.product_id ?? "", input.status, expiresAt);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to update subscription");
        }
        if (input.original_transaction_id || (input.price_cents && input.price_cents > 0)) {
            await this.db.updateSubscriptionDetails(userId, input.original_transaction_id ?? "", input.price_cents ?? 0, input.currency_code ?? "USD").catch(() => { });
        }
        const sub = await this.db.getSubscription(userId).catch(() => null);
        return sub ?? { status: "updated" };
    }
    async reportSession(userId, input) {
        if (!input.session_id || !input.action)
            throw new ValidationError("session_id and action required");
        if (input.session_id.length > 100)
            throw new ValidationError("session_id too long");
        if (input.action !== "start" && input.action !== "end")
            throw new ValidationError("action must be 'start' or 'end'");
        if (input.action === "end" && input.duration_s !== undefined && (input.duration_s < 0 || input.duration_s > 86400)) {
            throw new ValidationError("duration_s must be 0-86400");
        }
        try {
            if (input.action === "start") {
                await this.db.startSession(userId, input.session_id, input.app_version ?? "", input.os_version ?? "", input.country ?? "");
            }
            else {
                await this.db.endSession(userId, input.session_id, input.duration_s ?? 0);
            }
        }
        catch {
            throw new ServiceError("INTERNAL", `failed to ${input.action} session`);
        }
        return { status: "ok" };
    }
    async getEligibility(userId) {
        let data;
        try {
            data = await this.db.getEngagementData(userId);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to get engagement data");
        }
        const isPro = await this.db.isProUser(userId).catch(() => false);
        let paywallTrigger = null;
        if (!isPro) {
            const trigger = this.paywallTrigger(data);
            if (trigger)
                paywallTrigger = trigger;
        }
        return {
            paywall_trigger: paywallTrigger,
            days_active: data.days_active,
            total_logs: data.total_logs,
            streak: data.current_streak,
            is_pro: isPro,
        };
    }
    async submitFeedback(userId, input) {
        if (!input.message)
            throw new ValidationError("message is required");
        if (input.message.length > 5000)
            throw new ValidationError("message too long (max 5000 chars)");
        const feedbackType = input.type || "general";
        if (!VALID_FEEDBACK_TYPES.has(feedbackType)) {
            throw new ValidationError("type must be one of: positive, negative, bug, feature, general");
        }
        try {
            await this.db.saveFeedback(userId, feedbackType, input.message, input.app_version ?? "");
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to save feedback");
        }
        return { status: "received" };
    }
}
//# sourceMappingURL=index.js.map