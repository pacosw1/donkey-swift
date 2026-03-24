import type { PushProvider } from "../push/index.js";
import { ValidationError } from "../errors/index.js";

// ── Types ───────────────────────────────────────────────────────────────────

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

// ── Database Interface ──────────────────────────────────────────────────────

export interface LifecycleDB {
  userCreatedAndLastActive(userId: string): Promise<{ createdAt: Date | string; lastActiveAt: Date | string }>;
  countSessions(userId: string): Promise<number>;
  countRecentSessions(userId: string, since: Date | string): Promise<number>;
  countDistinctEventDays(userId: string, eventName: string, since: Date | string): Promise<number>;
  isProUser(userId: string): Promise<boolean>;
  lastPrompt(userId: string): Promise<{ promptType: string; promptAt: Date | string } | null>;
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

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

// ── Service ─────────────────────────────────────────────────────────────────

export class LifecycleService {
  private weights: Required<ScoreWeights>;

  constructor(
    private cfg: LifecycleConfig,
    private db: LifecycleDB,
    private push: PushProvider
  ) {
    const w = cfg.scoreWeights ?? {};
    this.weights = {
      recentSessionsMax: w.recentSessionsMax ?? 40,
      recentSessionsPerSession: w.recentSessionsPerSession ?? 6,
      ahaBonus: w.ahaBonus ?? 20,
      proBonus: w.proBonus ?? 20,
      activeTodayBonus: w.activeTodayBonus ?? 10,
      activeRecentBonus: w.activeRecentBonus ?? 5,
      totalSessionsMax: w.totalSessionsMax ?? 10,
      totalSessionsDivisor: w.totalSessionsDivisor ?? 3,
    };
  }

  async evaluateUser(userId: string): Promise<EngagementScore> {
    const { createdAt, lastActiveAt } = await this.db.userCreatedAndLastActive(userId);
    const now = new Date();
    const daysSinceActive = Math.floor((now.getTime() - toDate(lastActiveAt).getTime()) / (24 * 60 * 60 * 1000));
    const createdDaysAgo = Math.floor((now.getTime() - toDate(createdAt).getTime()) / (24 * 60 * 60 * 1000));

    const totalSessions = await this.db.countSessions(userId);
    const recentSessions = await this.db.countRecentSessions(userId, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    const ahaReached = await this.checkAhaMoment(userId, now);
    const isPro = await this.db.isProUser(userId);

    const score = this.calculateScore(recentSessions, ahaReached, isPro, daysSinceActive, totalSessions);
    const stage = this.determineStage(score, daysSinceActive, createdDaysAgo, ahaReached, isPro);

    const es: EngagementScore = {
      user_id: userId,
      stage,
      score,
      days_since_active: daysSinceActive,
      total_sessions: totalSessions,
      aha_reached: ahaReached,
      is_pro: isPro,
      created_days_ago: createdDaysAgo,
    };

    es.prompt = await this.determinePrompt(userId, es);
    return es;
  }

  calculateScore(
    recentSessions: number,
    ahaReached: boolean,
    isPro: boolean,
    daysSinceActive: number,
    totalSessions: number
  ): number {
    const w = this.weights;
    let score = 0;
    score += Math.min(recentSessions * w.recentSessionsPerSession, w.recentSessionsMax);
    if (ahaReached) score += w.ahaBonus;
    if (isPro) score += w.proBonus;
    if (daysSinceActive === 0) score += w.activeTodayBonus;
    else if (daysSinceActive <= 2) score += w.activeRecentBonus;
    score += Math.min(Math.floor(totalSessions / w.totalSessionsDivisor), w.totalSessionsMax);
    return Math.min(score, 100);
  }

  private async checkAhaMoment(userId: string, now: Date): Promise<boolean> {
    for (const rule of this.cfg.ahaMomentRules ?? []) {
      const since = new Date(now.getTime() - rule.windowDays * 24 * 60 * 60 * 1000);
      const count = await this.db.countDistinctEventDays(userId, rule.eventName, since);
      if (count >= rule.threshold) return true;
    }
    return false;
  }

  private determineStage(score: number, daysSinceActive: number, createdDaysAgo: number, ahaReached: boolean, isPro: boolean): Stage {
    const ctx: StageContext = { score, daysSinceActive, createdDaysAgo, ahaReached, isPro };
    for (const rule of this.cfg.customStages ?? []) {
      if (rule.matches(ctx)) return rule.stage;
    }

    if (daysSinceActive >= 30) return "churned";
    if (daysSinceActive >= 14) return "dormant";
    if (daysSinceActive >= 7 || (score < 20 && createdDaysAgo > 7)) return "at_risk";
    if (isPro && score >= 60) return "loyal";
    if (isPro) return "monetized";
    if (score >= 40) return "engaged";
    if (ahaReached) return "activated";
    return "new";
  }

  async determinePrompt(userId: string, es: EngagementScore): Promise<Prompt | null> {
    const cooldownDays = this.cfg.promptCooldownDays ?? 3;
    const lastPrompt = await this.db.lastPrompt(userId).catch(() => null);
    if (lastPrompt && Date.now() - toDate(lastPrompt.promptAt).getTime() < cooldownDays * 24 * 60 * 60 * 1000) {
      return null;
    }

    if (this.cfg.promptBuilder) return this.cfg.promptBuilder(userId, es);

    let candidate: Prompt | null = null;
    switch (es.stage) {
      case "engaged":
        candidate = es.is_pro
          ? { type: "review", title: "Enjoying the app?", body: "Your feedback helps us improve. Leave a review?", reason: "engaged_pro_user" }
          : { type: "paywall", title: "Unlock Premium", body: "You're getting great value — upgrade to unlock everything.", reason: "engaged_free_user" };
        break;
      case "loyal":
        candidate = { type: "milestone", title: "You're a power user!", body: "Thanks for being a loyal subscriber.", reason: "loyal_user" };
        break;
      case "activated":
        candidate = { type: "paywall", title: "Ready for more?", body: "You've discovered the core experience — unlock premium features.", reason: "aha_moment_reached" };
        break;
      case "at_risk":
        candidate = { type: "winback", title: "We miss you!", body: "Come back and check out what's new.", reason: "at_risk" };
        break;
      case "dormant":
        candidate = { type: "winback", title: "It's been a while", body: "We've made improvements since your last visit.", reason: "dormant" };
        break;
      case "churned":
        candidate = { type: "winback", title: "Welcome back", body: "A lot has changed — give us another try.", reason: "churned" };
        break;
      default:
        return null;
    }

    if (!candidate) return null;

    // Enforce max prompts per type (prevents prompt fatigue)
    const maxPerType = this.cfg.maxPromptsPerType;
    if (maxPerType && maxPerType[candidate.type] !== undefined) {
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const count = await this.db.countPrompts(userId, candidate.type, since30d).catch(() => 0);
      if (count >= maxPerType[candidate.type]) return null;
    }

    return candidate;
  }

  /** Acknowledge a lifecycle prompt (shown, accepted, or dismissed). */
  async ackPrompt(userId: string, promptType: string, action: string): Promise<void> {
    if (!promptType || !action) {
      throw new ValidationError("prompt_type and action are required");
    }
    const validActions = new Set(["shown", "accepted", "dismissed"]);
    if (!validActions.has(action)) {
      throw new ValidationError("action must be one of: shown, accepted, dismissed");
    }

    const event = `lifecycle_prompt_${action}`;
    const metadata = JSON.stringify({ prompt_type: promptType });
    await this.db.recordPrompt(userId, event, metadata).catch(() => {});
  }

  /** Evaluate users and send winback pushes to at-risk/dormant/churned users. */
  async evaluateNotifications(userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      try {
        const es = await this.evaluateUser(userId);
        if (!["at_risk", "dormant", "churned"].includes(es.stage)) continue;
        if (!es.prompt || es.prompt.type !== "winback") continue;

        const tokens = await this.db.enabledDeviceTokens(userId).catch(() => []);
        for (const token of tokens) {
          await this.push.send(token, es.prompt.title, es.prompt.body).catch((err) => {
            console.log(`[lifecycle] push ${userId}: ${err}`);
          });
        }
        await this.db.recordPrompt(userId, "lifecycle_prompt_sent", JSON.stringify({ prompt_type: es.prompt.type })).catch(() => {});
      } catch (err) {
        console.log(`[lifecycle] evaluate ${userId}: ${err}`);
      }
    }
  }
}
