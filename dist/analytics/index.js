import { ValidationError, NotConfiguredError, ServiceError } from "../errors/index.js";
// ── Helpers ─────────────────────────────────────────────────────────────────
function parseSince(sinceStr, defaultDays) {
    if (!sinceStr)
        return new Date(Date.now() - defaultDays * 24 * 60 * 60 * 1000);
    const d = new Date(sinceStr);
    if (isNaN(d.getTime()))
        return null;
    return d;
}
// ── Service ─────────────────────────────────────────────────────────────────
export class AnalyticsService {
    db;
    constructor(db) {
        this.db = db;
    }
    async getDau(since) {
        const parsed = parseSince(since, 30);
        if (!parsed)
            throw new ValidationError("invalid 'since' format, use ISO8601");
        try {
            const rows = await this.db.dauTimeSeries(parsed);
            return { data: rows };
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to query DAU");
        }
    }
    async getEvents(opts) {
        const parsed = parseSince(opts?.since, 30);
        if (!parsed)
            throw new ValidationError("invalid 'since' format, use ISO8601");
        try {
            const rows = await this.db.eventCounts(parsed, opts?.event);
            return { data: rows };
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to query events");
        }
    }
    async getMrr() {
        try {
            const [breakdown, newSubs, churned] = await Promise.all([
                this.db.subscriptionBreakdown(),
                this.db.newSubscriptions30d(),
                this.db.churnedSubscriptions30d(),
            ]);
            const mrr = this.db.mrrCents ? await this.db.mrrCents() : undefined;
            return {
                breakdown,
                new_30d: newSubs,
                churned_30d: churned,
                ...(mrr !== undefined ? { mrr_cents: mrr } : {}),
            };
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to query MRR");
        }
    }
    async getSummary() {
        try {
            const [dau, mau, totalUsers, activeSubs] = await Promise.all([
                this.db.dauToday(),
                this.db.mau(),
                this.db.totalUsers(),
                this.db.activeSubscriptions(),
            ]);
            const trialConversion = this.db.trialConversionRate
                ? await this.db.trialConversionRate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).catch(() => undefined)
                : undefined;
            return {
                dau, mau, total_users: totalUsers, active_subscriptions: activeSubs,
                ...(trialConversion !== undefined ? { trial_conversion_rate: trialConversion } : {}),
            };
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to query summary");
        }
    }
    async getRetention(opts) {
        if (!this.db.retentionCohort)
            throw new NotConfiguredError("retention analysis not configured");
        const since = parseSince(opts?.since, 90);
        if (!since)
            throw new ValidationError("invalid 'since' format, use ISO8601");
        const daysParam = opts?.days ?? "1,7,14,30";
        const days = daysParam.split(",").map(Number).filter((n) => n > 0 && n <= 365);
        if (!days.length)
            throw new ValidationError("invalid 'days' parameter");
        try {
            const rows = await this.db.retentionCohort(since, days);
            return { data: rows };
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to query retention");
        }
    }
    async getRevenue(since) {
        if (!this.db.revenueSeries)
            throw new NotConfiguredError("revenue analysis not configured");
        const parsed = parseSince(since, 30);
        if (!parsed)
            throw new ValidationError("invalid 'since' format, use ISO8601");
        try {
            const rows = await this.db.revenueSeries(parsed);
            return { data: rows };
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to query revenue");
        }
    }
}
//# sourceMappingURL=index.js.map