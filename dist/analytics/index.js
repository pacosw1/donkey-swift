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
        const rows = await this.db.dauTimeSeries(since);
        return c.json({ data: rows });
    };
    /** GET /admin/api/analytics/events */
    handleEvents = async (c) => {
        const sinceStr = c.req.query("since");
        const event = c.req.query("event");
        const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const rows = await this.db.eventCounts(since, event);
        return c.json({ data: rows });
    };
    /** GET /admin/api/analytics/mrr */
    handleMRR = async (c) => {
        const [breakdown, newSubs, churned] = await Promise.all([
            this.db.subscriptionBreakdown(),
            this.db.newSubscriptions30d(),
            this.db.churnedSubscriptions30d(),
        ]);
        return c.json({ breakdown, new_30d: newSubs, churned_30d: churned });
    };
    /** GET /admin/api/analytics/summary */
    handleSummary = async (c) => {
        const [dau, mau, totalUsers, activeSubs] = await Promise.all([
            this.db.dauToday(),
            this.db.mau(),
            this.db.totalUsers(),
            this.db.activeSubscriptions(),
        ]);
        return c.json({ dau, mau, total_users: totalUsers, active_subscriptions: activeSubs });
    };
}
//# sourceMappingURL=index.js.map