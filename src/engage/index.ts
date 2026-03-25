import { ValidationError, ServiceError } from "../errors/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

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

// ── Default Paywall Trigger ─────────────────────────────────────────────────

export function examplePaywallTrigger(data: EngagementData): string {
  if (data.days_active >= 14 && (data.metrics["total_logs"] ?? 0) >= 50) return "power_user";
  if ((data.metrics["goals_completed"] ?? 0) >= 10 && (data.metrics["paywall_shown"] ?? 0) < 3) return "milestone";
  return "";
}

// ── Service ─────────────────────────────────────────────────────────────────

export const VALID_STATUSES = new Set(["active", "expired", "cancelled", "trial", "free"]);
export const VALID_FEEDBACK_TYPES = new Set(["positive", "negative", "bug", "feature", "general"]);

export class EngageService {
  private paywallTrigger: (data: EngagementData) => string;
  private eventHooks: EventHook[] = [];

  constructor(
    private cfg: EngageConfig,
    private db: EngageDB
  ) {
    this.paywallTrigger = cfg.paywallTrigger ?? examplePaywallTrigger;
  }

  registerEventHook(hook: EventHook): void {
    this.eventHooks.push(hook);
  }

  async trackEvents(
    userId: string,
    events: Array<{ event: string; metadata?: unknown; timestamp?: string }>
  ): Promise<{ tracked: number }> {
    if (!events?.length) throw new ValidationError("events array is required");
    if (events.length > 100) throw new ValidationError("maximum 100 events per batch");

    for (const e of events) {
      if (!e.event || typeof e.event !== "string") throw new ValidationError("each event must have a string 'event' field");
      if (e.event.length > 200) throw new ValidationError("event name too long (max 200 chars)");
    }

    const dbEvents: EventInput[] = events.map((e) => ({
      event: e.event,
      metadata: e.metadata ? JSON.stringify(e.metadata).slice(0, 10_000) : "{}",
      timestamp: e.timestamp ?? "",
    }));

    try {
      await this.db.trackEvents(userId, dbEvents);
    } catch {
      throw new ServiceError("INTERNAL", "failed to track events");
    }

    for (const hook of this.eventHooks) hook(userId, dbEvents);
    return { tracked: dbEvents.length };
  }

  async updateSubscription(
    userId: string,
    input: {
      product_id?: string;
      status?: string;
      expires_at?: string;
      original_transaction_id?: string;
      price_cents?: number;
      currency_code?: string;
    }
  ): Promise<UserSubscription | { status: string }> {
    if (!input.status) throw new ValidationError("status is required");
    if (!VALID_STATUSES.has(input.status)) {
      throw new ValidationError("status must be one of: active, expired, cancelled, trial, free");
    }

    const expiresAt = input.expires_at ? new Date(input.expires_at) : null;

    try {
      await this.db.updateSubscription(userId, input.product_id ?? "", input.status, expiresAt);
    } catch {
      throw new ServiceError("INTERNAL", "failed to update subscription");
    }

    if (input.original_transaction_id || (input.price_cents && input.price_cents > 0)) {
      await this.db.updateSubscriptionDetails(
        userId,
        input.original_transaction_id ?? "",
        input.price_cents ?? 0,
        input.currency_code ?? "USD"
      ).catch(() => {});
    }

    const sub = await this.db.getSubscription(userId).catch(() => null);
    return sub ?? { status: "updated" };
  }

  async reportSession(
    userId: string,
    input: {
      session_id: string;
      action: "start" | "end";
      app_version?: string;
      os_version?: string;
      country?: string;
      duration_s?: number;
    }
  ): Promise<{ status: string }> {
    if (!input.session_id || !input.action) throw new ValidationError("session_id and action required");
    if (input.session_id.length > 100) throw new ValidationError("session_id too long");
    if (input.action !== "start" && input.action !== "end") throw new ValidationError("action must be 'start' or 'end'");
    if (input.action === "end" && input.duration_s !== undefined && (input.duration_s < 0 || input.duration_s > 86400)) {
      throw new ValidationError("duration_s must be 0-86400");
    }

    try {
      if (input.action === "start") {
        await this.db.startSession(userId, input.session_id, input.app_version ?? "", input.os_version ?? "", input.country ?? "");
      } else {
        await this.db.endSession(userId, input.session_id, input.duration_s ?? 0);
      }
    } catch {
      throw new ServiceError("INTERNAL", `failed to ${input.action} session`);
    }

    return { status: "ok" };
  }

  async getEligibility(
    userId: string
  ): Promise<{ paywall_trigger: string | null; days_active: number; current_streak: number; is_pro: boolean; metrics: Record<string, number> }> {
    let data: EngagementData;
    try {
      data = await this.db.getEngagementData(userId);
    } catch {
      throw new ServiceError("INTERNAL", "failed to get engagement data");
    }

    const isPro = await this.db.isProUser(userId).catch(() => false);

    let paywallTrigger: string | null = null;
    if (!isPro) {
      const trigger = this.paywallTrigger(data);
      if (trigger) paywallTrigger = trigger;
    }

    return {
      paywall_trigger: paywallTrigger,
      days_active: data.days_active,
      current_streak: data.current_streak,
      is_pro: isPro,
      metrics: data.metrics,
    };
  }

  async submitFeedback(
    userId: string,
    input: { type?: string; message: string; app_version?: string }
  ): Promise<{ status: string }> {
    if (!input.message) throw new ValidationError("message is required");
    if (input.message.length > 5000) throw new ValidationError("message too long (max 5000 chars)");

    const feedbackType = input.type || "general";
    if (!VALID_FEEDBACK_TYPES.has(feedbackType)) {
      throw new ValidationError("type must be one of: positive, negative, bug, feature, general");
    }

    try {
      await this.db.saveFeedback(userId, feedbackType, input.message, input.app_version ?? "");
    } catch {
      throw new ServiceError("INTERNAL", "failed to save feedback");
    }

    return { status: "received" };
  }
}
