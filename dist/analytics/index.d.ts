import type { Context } from "hono";
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
    /** GET /admin/api/analytics/dau */
    handleDAU: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        data: {
            date: string;
            dau: number;
        }[];
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
    /** GET /admin/api/analytics/events */
    handleEvents: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        data: {
            date: string;
            event: string;
            count: number;
            unique_users: number;
        }[];
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
    /** GET /admin/api/analytics/mrr */
    handleMRR: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        mrr_cents?: number | undefined;
        breakdown: {
            status: string;
            count: number;
        }[];
        new_30d: number;
        churned_30d: number;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
    /** GET /admin/api/analytics/summary */
    handleSummary: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        trial_conversion_rate?: number | undefined;
        dau: number;
        mau: number;
        total_users: number;
        active_subscriptions: number;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
    /** GET /admin/api/analytics/retention */
    handleRetention: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        data: {
            cohort_date: string;
            day: number;
            retained_pct: number;
            users: number;
        }[];
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
    /** GET /admin/api/analytics/revenue */
    handleRevenue: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        data: {
            date: string;
            revenue_cents: number;
        }[];
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
}
//# sourceMappingURL=index.d.ts.map