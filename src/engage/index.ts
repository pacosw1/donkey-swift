import type { Context } from "hono";

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

// ── Default Paywall Trigger ─────────────────────────────────────────────────

export function defaultPaywallTrigger(data: EngagementData): string {
  if (data.days_active >= 14 && data.total_logs >= 50) return "power_user";
  if (data.goals_completed_total >= 10 && data.paywall_shown_count < 3) return "milestone";
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
    this.paywallTrigger = cfg.paywallTrigger ?? defaultPaywallTrigger;
  }

  registerEventHook(hook: EventHook): void {
    this.eventHooks.push(hook);
  }

  /** POST /api/v1/events */
  handleTrackEvents = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{ events?: Array<{ event: string; metadata?: unknown; timestamp?: string }> }>();

    if (!body.events?.length) return c.json({ error: "events array is required" }, 400);
    if (body.events.length > 100) return c.json({ error: "maximum 100 events per batch" }, 400);

    const dbEvents: EventInput[] = body.events.map((e) => ({
      event: e.event,
      metadata: e.metadata ? JSON.stringify(e.metadata) : "{}",
      timestamp: e.timestamp ?? "",
    }));

    try {
      await this.db.trackEvents(userId, dbEvents);
    } catch {
      return c.json({ error: "failed to track events" }, 500);
    }

    for (const hook of this.eventHooks) hook(userId, dbEvents);
    return c.json({ tracked: dbEvents.length });
  };

  /** PUT /api/v1/subscription */
  handleUpdateSubscription = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{
      product_id?: string;
      status?: string;
      expires_at?: string;
      original_transaction_id?: string;
      price_cents?: number;
      currency_code?: string;
    }>();

    if (!body.status) return c.json({ error: "status is required" }, 400);
    if (!VALID_STATUSES.has(body.status)) {
      return c.json({ error: "status must be one of: active, expired, cancelled, trial, free" }, 400);
    }

    const expiresAt = body.expires_at ? new Date(body.expires_at) : null;

    try {
      await this.db.updateSubscription(userId, body.product_id ?? "", body.status, expiresAt);
    } catch {
      return c.json({ error: "failed to update subscription" }, 500);
    }

    if (body.original_transaction_id || (body.price_cents && body.price_cents > 0)) {
      await this.db.updateSubscriptionDetails(
        userId,
        body.original_transaction_id ?? "",
        body.price_cents ?? 0,
        body.currency_code ?? "USD"
      ).catch(() => {});
    }

    const sub = await this.db.getSubscription(userId).catch(() => null);
    return c.json(sub ?? { status: "updated" });
  };

  /** POST /api/v1/sessions */
  handleSessionReport = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{
      session_id?: string;
      action?: string;
      app_version?: string;
      os_version?: string;
      country?: string;
      duration_s?: number;
    }>();

    if (!body.session_id || !body.action) return c.json({ error: "session_id and action required" }, 400);
    if (body.action !== "start" && body.action !== "end") return c.json({ error: "action must be 'start' or 'end'" }, 400);

    try {
      if (body.action === "start") {
        await this.db.startSession(userId, body.session_id, body.app_version ?? "", body.os_version ?? "", body.country ?? "");
      } else {
        await this.db.endSession(userId, body.session_id, body.duration_s ?? 0);
      }
    } catch {
      return c.json({ error: `failed to ${body.action} session` }, 500);
    }

    return c.json({ status: "ok" });
  };

  /** GET /api/v1/user/eligibility */
  handleGetEligibility = async (c: Context) => {
    const userId = c.get("userId") as string;

    let data: EngagementData;
    try {
      data = await this.db.getEngagementData(userId);
    } catch {
      return c.json({ error: "failed to get engagement data" }, 500);
    }

    const isPro = await this.db.isProUser(userId).catch(() => false);

    let paywallTrigger: string | null = null;
    if (!isPro) {
      const trigger = this.paywallTrigger(data);
      if (trigger) paywallTrigger = trigger;
    }

    return c.json({
      paywall_trigger: paywallTrigger,
      days_active: data.days_active,
      total_logs: data.total_logs,
      streak: data.current_streak,
      is_pro: isPro,
    });
  };

  /** POST /api/v1/feedback */
  handleSubmitFeedback = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{ type?: string; message?: string; app_version?: string }>();

    if (!body.message) return c.json({ error: "message is required" }, 400);

    const feedbackType = body.type || "general";
    if (!VALID_FEEDBACK_TYPES.has(feedbackType)) {
      return c.json({ error: "type must be one of: positive, negative, bug, feature, general" }, 400);
    }

    try {
      await this.db.saveFeedback(userId, feedbackType, body.message, body.app_version ?? "");
    } catch {
      return c.json({ error: "failed to save feedback" }, 500);
    }

    return c.json({ status: "received" }, 201);
  };
}
