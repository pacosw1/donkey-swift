import type { Context } from "hono";
import type { PushProvider } from "../push/index.js";
export type Stage = "new" | "activated" | "engaged" | "monetized" | "loyal" | "at_risk" | "dormant" | "churned";
export type PromptType = "review" | "paywall" | "winback" | "milestone";
export interface AhaMomentRule {
    name: string;
    description: string;
    eventName: string;
    threshold: number;
    windowDays: number;
}
export interface EngagementScore {
    user_id: string;
    stage: Stage;
    score: number;
    days_since_active: number;
    total_sessions: number;
    aha_reached: boolean;
    is_pro: boolean;
    created_days_ago: number;
    prompt?: Prompt | null;
}
export interface Prompt {
    type: PromptType;
    title: string;
    body: string;
    reason: string;
}
export interface StageRule {
    name: string;
    stage: Stage;
    matches: (score: number, daysSinceActive: number, createdDaysAgo: number, ahaReached: boolean, isPro: boolean) => boolean;
}
export interface LifecycleDB {
    userCreatedAndLastActive(userId: string): Promise<{
        createdAt: Date;
        lastActiveAt: Date;
    }>;
    countSessions(userId: string): Promise<number>;
    countRecentSessions(userId: string, since: Date): Promise<number>;
    countDistinctEventDays(userId: string, eventName: string, since: Date): Promise<number>;
    isProUser(userId: string): Promise<boolean>;
    lastPrompt(userId: string): Promise<{
        promptType: string;
        promptAt: Date;
    } | null>;
    countPrompts(userId: string, promptType: string, since: Date): Promise<number>;
    recordPrompt(userId: string, event: string, metadata: string): Promise<void>;
    enabledDeviceTokens(userId: string): Promise<string[]>;
}
export interface LifecycleConfig {
    ahaMomentRules?: AhaMomentRule[];
    customStages?: StageRule[];
    promptBuilder?: (userId: string, es: EngagementScore) => Promise<Prompt | null>;
    promptCooldownDays?: number;
}
export declare class LifecycleService {
    private cfg;
    private db;
    private push;
    constructor(cfg: LifecycleConfig, db: LifecycleDB, push: PushProvider);
    evaluateUser(userId: string): Promise<EngagementScore>;
    private checkAhaMoment;
    private determineStage;
    determinePrompt(userId: string, es: EngagementScore): Promise<Prompt | null>;
    /** GET /api/v1/user/lifecycle */
    handleGetLifecycle: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        user_id: string;
        stage: Stage;
        score: number;
        days_since_active: number;
        total_sessions: number;
        aha_reached: boolean;
        is_pro: boolean;
        created_days_ago: number;
        prompt?: {
            type: PromptType;
            title: string;
            body: string;
            reason: string;
        } | null | undefined;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
    /** POST /api/v1/user/lifecycle/ack */
    handleAckPrompt: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** Evaluate users and send winback pushes to at-risk/dormant/churned users. */
    evaluateNotifications(userIds: string[]): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map