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
    /** GET /admin/api/analytics/dau */
    handleDAU = async (c) => {
        const since = parseSince(c.req.query("since"), 30);
        if (!since)
            return c.json({ error: "invalid 'since' format, use ISO8601" }, 400);
        try {
            const rows = await this.db.dauTimeSeries(since);
            return c.json({ data: rows });
        }
        catch {
            return c.json({ error: "failed to query DAU" }, 500);
        }
    };
    /** GET /admin/api/analytics/events */
    handleEvents = async (c) => {
        const event = c.req.query("event");
        const since = parseSince(c.req.query("since"), 30);
        if (!since)
            return c.json({ error: "invalid 'since' format, use ISO8601" }, 400);
        try {
            const rows = await this.db.eventCounts(since, event);
            return c.json({ data: rows });
        }
        catch {
            return c.json({ error: "failed to query events" }, 500);
        }
    };
    /** GET /admin/api/analytics/mrr */
    handleMRR = async (c) => {
        try {
            const [breakdown, newSubs, churned] = await Promise.all([
                this.db.subscriptionBreakdown(),
                this.db.newSubscriptions30d(),
                this.db.churnedSubscriptions30d(),
            ]);
            const mrr = this.db.mrrCents ? await this.db.mrrCents() : undefined;
            return c.json({ breakdown, new_30d: newSubs, churned_30d: churned, ...(mrr !== undefined ? { mrr_cents: mrr } : {}) });
        }
        catch {
            return c.json({ error: "failed to query MRR" }, 500);
        }
    };
    /** GET /admin/api/analytics/summary */
    handleSummary = async (c) => {
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
            return c.json({
                dau, mau, total_users: totalUsers, active_subscriptions: activeSubs,
                ...(trialConversion !== undefined ? { trial_conversion_rate: trialConversion } : {}),
            });
        }
        catch {
            return c.json({ error: "failed to query summary" }, 500);
        }
    };
    /** GET /admin/api/analytics/retention */
    handleRetention = async (c) => {
        if (!this.db.retentionCohort)
            return c.json({ error: "retention analysis not configured" }, 501);
        const since = parseSince(c.req.query("since"), 90);
        if (!since)
            return c.json({ error: "invalid 'since' format, use ISO8601" }, 400);
        const daysParam = c.req.query("days") ?? "1,7,14,30";
        const days = daysParam.split(",").map(Number).filter((n) => n > 0 && n <= 365);
        if (!days.length)
            return c.json({ error: "invalid 'days' parameter" }, 400);
        try {
            const rows = await this.db.retentionCohort(since, days);
            return c.json({ data: rows });
        }
        catch {
            return c.json({ error: "failed to query retention" }, 500);
        }
    };
    /** GET /admin/api/analytics/revenue */
    handleRevenue = async (c) => {
        if (!this.db.revenueSeries)
            return c.json({ error: "revenue analysis not configured" }, 501);
        const since = parseSince(c.req.query("since"), 30);
        if (!since)
            return c.json({ error: "invalid 'since' format, use ISO8601" }, 400);
        try {
            const rows = await this.db.revenueSeries(since);
            return c.json({ data: rows });
        }
        catch {
            return c.json({ error: "failed to query revenue" }, 500);
        }
    };
}
//# sourceMappingURL=index.js.map