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
export declare class AnalyticsService {
    private db;
    constructor(db: AnalyticsDB);
    /** GET /admin/api/analytics/dau */
    handleDAU: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        data: {
            date: string;
            dau: number;
        }[];
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
    /** GET /admin/api/analytics/events */
    handleEvents: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
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
        dau: number;
        mau: number;
        total_users: number;
        active_subscriptions: number;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
}
//# sourceMappingURL=index.d.ts.map