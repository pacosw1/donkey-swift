export interface EngageDB {
    trackEvents(userId: string, events: EventInput[]): Promise<void>;
    updateSubscription(userId: string, productId: string, status: string, expiresAt: Date | string | null): Promise<void>;
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
    expires_at: Date | string | null;
    started_at: Date | string | null;
    updated_at: Date | string;
}
export interface EngagementData {
    days_active: number;
    current_streak: number;
    subscription_status: string;
    /** App-specific metrics. Apps put their domain data here. */
    metrics: Record<string, number>;
}
export type EventHook = (userId: string, events: EventInput[]) => void;
export interface EngageConfig {
    paywallTrigger?: (data: EngagementData) => string;
}
export declare function examplePaywallTrigger(data: EngagementData): string;
export declare const VALID_STATUSES: Set<string>;
export declare const VALID_FEEDBACK_TYPES: Set<string>;
export declare class EngageService {
    private cfg;
    private db;
    private paywallTrigger;
    private eventHooks;
    constructor(cfg: EngageConfig, db: EngageDB);
    registerEventHook(hook: EventHook): void;
    trackEvents(userId: string, events: Array<{
        event: string;
        metadata?: unknown;
        timestamp?: string;
    }>): Promise<{
        tracked: number;
    }>;
    updateSubscription(userId: string, input: {
        product_id?: string;
        status?: string;
        expires_at?: string;
        original_transaction_id?: string;
        price_cents?: number;
        currency_code?: string;
    }): Promise<UserSubscription | {
        status: string;
    }>;
    reportSession(userId: string, input: {
        session_id: string;
        action: "start" | "end";
        app_version?: string;
        os_version?: string;
        country?: string;
        duration_s?: number;
    }): Promise<{
        status: string;
    }>;
    getEligibility(userId: string): Promise<{
        paywall_trigger: string | null;
        days_active: number;
        current_streak: number;
        is_pro: boolean;
        metrics: Record<string, number>;
    }>;
    submitFeedback(userId: string, input: {
        type?: string;
        message: string;
        app_version?: string;
    }): Promise<{
        status: string;
    }>;
}
//# sourceMappingURL=index.d.ts.map