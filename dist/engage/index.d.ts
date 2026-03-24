import type { Context } from "hono";
export interface EngageDB {
    trackEvents(userId: string, events: EventInput[]): Promise<void>;
    updateSubscription(userId: string, productId: string, status: string, expiresAt: Date | null): Promise<void>;
    updateSubscriptionDetails(userId: string, originalTransactionId: string, priceCents: number, currencyCode: string): Promise<void>;
    getSubscription(userId: string): Promise<UserSubscription | null>;
    isProUser(userId: string): Promise<boolean>;
    getEngagementData(userId: string): Promise<EngagementData>;
    startSession(userId: string, sessionId: string, appVersion: string, osVersion: string, country: string): Promise<void>;
    endSession(userId: string, sessionId: string, durationS: number): Promise<void>;
    saveFeedback(userId: string, feedbackType: string, message: string, appVersion: string): Promise<void>;
}
export interface EventInput {
    event: string;
    metadata: string;
    timestamp: string;
}
export interface UserSubscription {
    user_id: string;
    product_id: string;
    status: string;
    expires_at: Date | null;
    started_at: Date | null;
    updated_at: Date;
}
export interface EngagementData {
    days_active: number;
    total_logs: number;
    current_streak: number;
    subscription_status: string;
    paywall_shown_count: number;
    last_paywall_date: string;
    goals_completed_total: number;
}
export type EventHook = (userId: string, events: EventInput[]) => void;
export interface EngageConfig {
    paywallTrigger?: (data: EngagementData) => string;
}
export declare function defaultPaywallTrigger(data: EngagementData): string;
export declare const VALID_STATUSES: Set<string>;
export declare const VALID_FEEDBACK_TYPES: Set<string>;
export declare class EngageService {
    private cfg;
    private db;
    private paywallTrigger;
    private eventHooks;
    constructor(cfg: EngageConfig, db: EngageDB);
    registerEventHook(hook: EventHook): void;
    /** POST /api/v1/events */
    handleTrackEvents: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        tracked: number;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** PUT /api/v1/subscription */
    handleUpdateSubscription: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        user_id: string;
        product_id: string;
        status: string;
        expires_at: string | null;
        started_at: string | null;
        updated_at: string;
    } | {
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /api/v1/sessions */
    handleSessionReport: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** GET /api/v1/user/eligibility */
    handleGetEligibility: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        paywall_trigger: string | null;
        days_active: number;
        total_logs: number;
        streak: number;
        is_pro: boolean;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /api/v1/feedback */
    handleSubmitFeedback: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, 201, "json">)>;
}
//# sourceMappingURL=index.d.ts.map