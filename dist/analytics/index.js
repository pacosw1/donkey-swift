// ── Service ─────────────────────────────────────────────────────────────────
export class AnalyticsService {
    db;
    constructor(db) {
        this.db = db;
    }
    /** GET /admin/api/analytics/dau */
    handleDAU = async (c) => {
        const sinceStr = c.req.query("since");
        const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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
        const sinceStr = c.req.query("since");
        const event = c.req.query("event");
        const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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
            return c.json({ breakdown, new_30d: newSubs, churned_30d: churned });
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
            return c.json({ dau, mau, total_users: totalUsers, active_subscriptions: activeSubs });
        }
        catch {
            return c.json({ error: "failed to query summary" }, 500);
        }
    };
}
//# sourceMappingURL=index.js.map