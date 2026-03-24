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
    matches: (ctx: StageContext) => boolean;
}
export interface StageContext {
    score: number;
    daysSinceActive: number;
    createdDaysAgo: number;
    ahaReached: boolean;
    isPro: boolean;
}
/** Configurable scoring weights. */
export interface ScoreWeights {
    /** Max score from recent sessions (default: 40). */
    recentSessionsMax?: number;
    /** Score per recent session (default: 6, capped at recentSessionsMax). */
    recentSessionsPerSession?: number;
    /** Bonus for reaching an aha moment (default: 20). */
    ahaBonus?: number;
    /** Bonus for being a pro/paying user (default: 20). */
    proBonus?: number;
    /** Bonus for activity today (default: 10). */
    activeTodayBonus?: number;
    /** Bonus for activity in last 2 days (default: 5). */
    activeRecentBonus?: number;
    /** Max score from total sessions (default: 10). */
    totalSessionsMax?: number;
    /** Sessions divisor for total sessions score (default: 3). */
    totalSessionsDivisor?: number;
}
export interface LifecycleDB {
    userCreatedAndLastActive(userId: string): Promise<{
        createdAt: Date | string;
        lastActiveAt: Date | string;
    }>;
    countSessions(userId: string): Promise<number>;
    countRecentSessions(userId: string, since: Date | string): Promise<number>;
    countDistinctEventDays(userId: string, eventName: string, since: Date | string): Promise<number>;
    isProUser(userId: string): Promise<boolean>;
    lastPrompt(userId: string): Promise<{
        promptType: string;
        promptAt: Date | string;
    } | null>;
    countPrompts(userId: string, promptType: string, since: Date | string): Promise<number>;
    recordPrompt(userId: string, event: string, metadata: string): Promise<void>;
    enabledDeviceTokens(userId: string): Promise<string[]>;
}
export interface LifecycleConfig {
    ahaMomentRules?: AhaMomentRule[];
    customStages?: StageRule[];
    promptBuilder?: (userId: string, es: EngagementScore) => Promise<Prompt | null>;
    /** Days between prompts of the same type (default: 3). */
    promptCooldownDays?: number;
    /** Max number of prompts of each type per 30-day window. Prevents prompt fatigue. */
    maxPromptsPerType?: Record<PromptType, number>;
    /** Custom scoring weights. */
    scoreWeights?: ScoreWeights;
}
export declare class LifecycleService {
    private cfg;
    private db;
    private push;
    private weights;
    constructor(cfg: LifecycleConfig, db: LifecycleDB, push: PushProvider);
    evaluateUser(userId: string): Promise<EngagementScore>;
    calculateScore(recentSessions: number, ahaReached: boolean, isPro: boolean, daysSinceActive: number, totalSessions: number): number;
    private checkAhaMoment;
    private determineStage;
    determinePrompt(userId: string, es: EngagementScore): Promise<Prompt | null>;
    /** Acknowledge a lifecycle prompt (shown, accepted, or dismissed). */
    ackPrompt(userId: string, promptType: string, action: string): Promise<void>;
    /** Evaluate users and send winback pushes to at-risk/dormant/churned users. */
    evaluateNotifications(userIds: string[]): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map