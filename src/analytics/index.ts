import { ValidationError, NotConfiguredError, ServiceError } from "../errors/index.js";

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
  /** Monthly recurring revenue in cents (sum of active subscription prices). */
  mrrCents?(): Promise<number>;
  /** Revenue time series. */
  revenueSeries?(since: Date | string): Promise<RevenueRow[]>;
  /** Retention cohort analysis. Returns percentage retained at each day mark. */
  retentionCohort?(cohortSince: Date | string, days: number[]): Promise<RetentionRow[]>;
  /** Trial to paid conversion rate over a period. */
  trialConversionRate?(since: Date | string): Promise<number>;
}

export interface DAURow { date: string; dau: number; }
export interface EventRow { date: string; event: string; count: number; unique_users: number; }
export interface SubStats { status: string; count: number; }
export interface RevenueRow { date: string; revenue_cents: number; }
export interface RetentionRow { cohort_date: string; day: number; retained_pct: number; users: number; }

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseSince(sinceStr: string | undefined, defaultDays: number): Date | null {
  if (!sinceStr) return new Date(Date.now() - defaultDays * 24 * 60 * 60 * 1000);
  const d = new Date(sinceStr);
  if (isNaN(d.getTime())) return null;
  return d;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class AnalyticsService {
  constructor(private db: AnalyticsDB) {}

  async getDau(since?: string): Promise<{ data: DAURow[] }> {
    const parsed = parseSince(since, 30);
    if (!parsed) throw new ValidationError("invalid 'since' format, use ISO8601");
    try {
      const rows = await this.db.dauTimeSeries(parsed);
      return { data: rows };
    } catch {
      throw new ServiceError("INTERNAL", "failed to query DAU");
    }
  }

  async getEvents(opts?: { since?: string; event?: string }): Promise<{ data: EventRow[] }> {
    const parsed = parseSince(opts?.since, 30);
    if (!parsed) throw new ValidationError("invalid 'since' format, use ISO8601");
    try {
      const rows = await this.db.eventCounts(parsed, opts?.event);
      return { data: rows };
    } catch {
      throw new ServiceError("INTERNAL", "failed to query events");
    }
  }

  async getMrr(): Promise<{ breakdown: SubStats[]; new_30d: number; churned_30d: number; mrr_cents?: number }> {
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
    } catch {
      throw new ServiceError("INTERNAL", "failed to query MRR");
    }
  }

  async getSummary(): Promise<{ dau: number; mau: number; total_users: number; active_subscriptions: number; trial_conversion_rate?: number }> {
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
    } catch {
      throw new ServiceError("INTERNAL", "failed to query summary");
    }
  }

  async getRetention(opts?: { since?: string; days?: string }): Promise<{ data: RetentionRow[] }> {
    if (!this.db.retentionCohort) throw new NotConfiguredError("retention analysis not configured");

    const since = parseSince(opts?.since, 90);
    if (!since) throw new ValidationError("invalid 'since' format, use ISO8601");

    const daysParam = opts?.days ?? "1,7,14,30";
    const days = daysParam.split(",").map(Number).filter((n) => n > 0 && n <= 365);
    if (!days.length) throw new ValidationError("invalid 'days' parameter");

    try {
      const rows = await this.db.retentionCohort(since, days);
      return { data: rows };
    } catch {
      throw new ServiceError("INTERNAL", "failed to query retention");
    }
  }

  async getRevenue(since?: string): Promise<{ data: RevenueRow[] }> {
    if (!this.db.revenueSeries) throw new NotConfiguredError("revenue analysis not configured");

    const parsed = parseSince(since, 30);
    if (!parsed) throw new ValidationError("invalid 'since' format, use ISO8601");

    try {
      const rows = await this.db.revenueSeries(parsed);
      return { data: rows };
    } catch {
      throw new ServiceError("INTERNAL", "failed to query revenue");
    }
  }
}
