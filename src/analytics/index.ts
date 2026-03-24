import type { Context } from "hono";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface AnalyticsDB {
  dauTimeSeries(since: Date | string): Promise<DAURow[]>;
  eventCounts(since: Date | string, event?: string): Promise<EventRow[]>;
  subscriptionBreakdown(): Promise<SubStats[]>;
  newSubscriptions30d(): Promise<number>;
  churnedSubscriptions30d(): Promise<number>;
  dauToday(): Promise<number>;
  mau(): Promise<number>;
  totalUsers(): Promise<number>;
  activeSubscriptions(): Promise<number>;
}

export interface DAURow { date: string; dau: number; }
export interface EventRow { date: string; event: string; count: number; unique_users: number; }
export interface SubStats { status: string; count: number; }

// ── Service ─────────────────────────────────────────────────────────────────

export class AnalyticsService {
  constructor(private db: AnalyticsDB) {}

  /** GET /admin/api/analytics/dau */
  handleDAU = async (c: Context) => {
    const sinceStr = c.req.query("since");
    const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    try {
      const rows = await this.db.dauTimeSeries(since);
      return c.json({ data: rows });
    } catch {
      return c.json({ error: "failed to query DAU" }, 500);
    }
  };

  /** GET /admin/api/analytics/events */
  handleEvents = async (c: Context) => {
    const sinceStr = c.req.query("since");
    const event = c.req.query("event");
    const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    try {
      const rows = await this.db.eventCounts(since, event);
      return c.json({ data: rows });
    } catch {
      return c.json({ error: "failed to query events" }, 500);
    }
  };

  /** GET /admin/api/analytics/mrr */
  handleMRR = async (c: Context) => {
    try {
      const [breakdown, newSubs, churned] = await Promise.all([
        this.db.subscriptionBreakdown(),
        this.db.newSubscriptions30d(),
        this.db.churnedSubscriptions30d(),
      ]);
      return c.json({ breakdown, new_30d: newSubs, churned_30d: churned });
    } catch {
      return c.json({ error: "failed to query MRR" }, 500);
    }
  };

  /** GET /admin/api/analytics/summary */
  handleSummary = async (c: Context) => {
    try {
      const [dau, mau, totalUsers, activeSubs] = await Promise.all([
        this.db.dauToday(),
        this.db.mau(),
        this.db.totalUsers(),
        this.db.activeSubscriptions(),
      ]);
      return c.json({ dau, mau, total_users: totalUsers, active_subscriptions: activeSubs });
    } catch {
      return c.json({ error: "failed to query summary" }, 500);
    }
  };
}
