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
export interface DAURow {
    date: string;
    dau: number;
}
export interface EventRow {
    date: string;
    event: string;
    count: number;
    unique_users: number;
}
export interface SubStats {
    status: string;
    count: number;
}
export interface RevenueRow {
    date: string;
    revenue_cents: number;
}
export interface RetentionRow {
    cohort_date: string;
    day: number;
    retained_pct: number;
    users: number;
}
export declare class AnalyticsService {
    private db;
    constructor(db: AnalyticsDB);
    getDau(since?: string): Promise<{
        data: DAURow[];
    }>;
    getEvents(opts?: {
        since?: string;
        event?: string;
    }): Promise<{
        data: EventRow[];
    }>;
    getMrr(): Promise<{
        breakdown: SubStats[];
        new_30d: number;
        churned_30d: number;
        mrr_cents?: number;
    }>;
    getSummary(): Promise<{
        dau: number;
        mau: number;
        total_users: number;
        active_subscriptions: number;
        trial_conversion_rate?: number;
    }>;
    getRetention(opts?: {
        since?: string;
        days?: string;
    }): Promise<{
        data: RetentionRow[];
    }>;
    getRevenue(since?: string): Promise<{
        data: RevenueRow[];
    }>;
}
//# sourceMappingURL=index.d.ts.map