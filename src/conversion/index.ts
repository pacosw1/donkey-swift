import { NotFoundError } from "../errors/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface ConversionOffer {
  user_id: string;
  discount_pct: number;
  product_id?: string;
  expires_at: Date | string;
  trigger: "paywall_dismissals" | "lifecycle_stage" | "inactivity_winback";
  redeemed: boolean;
  created_at: Date | string;
}

export interface ConversionConfig {
  dismissalThreshold?: number;
  discountPct?: number;
  offerTtlMinutes?: number;
  cooldownDays?: number;
  triggerStages?: string[];
  inactivityDays?: number;
}

export interface ConversionDB {
  getActiveOffer(userId: string): Promise<ConversionOffer | null>;
  createOffer(offer: ConversionOffer): Promise<void>;
  markRedeemed(userId: string): Promise<void>;
  countDismissals(userId: string, since: Date): Promise<number>;
  recordDismissal(userId: string): Promise<void>;
  lastOfferDate(userId: string): Promise<Date | string | null>;
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS = {
  dismissalThreshold: 3,
  discountPct: 20,
  offerTtlMinutes: 1440,
  cooldownDays: 7,
  triggerStages: ["at_risk"] as string[],
  inactivityDays: 14,
} as const;

// ── Service ─────────────────────────────────────────────────────────────────

export class ConversionService {
  private dismissalThreshold: number;
  private discountPct: number;
  private offerTtlMinutes: number;
  private cooldownDays: number;
  private triggerStages: string[];
  private inactivityDays: number;

  constructor(
    cfg: ConversionConfig,
    private db: ConversionDB
  ) {
    this.dismissalThreshold = cfg.dismissalThreshold ?? DEFAULTS.dismissalThreshold;
    this.discountPct = cfg.discountPct ?? DEFAULTS.discountPct;
    this.offerTtlMinutes = cfg.offerTtlMinutes ?? DEFAULTS.offerTtlMinutes;
    this.cooldownDays = cfg.cooldownDays ?? DEFAULTS.cooldownDays;
    this.triggerStages = cfg.triggerStages ?? [...DEFAULTS.triggerStages];
    this.inactivityDays = cfg.inactivityDays ?? DEFAULTS.inactivityDays;
  }

  async recordDismissal(userId: string): Promise<void> {
    await this.db.recordDismissal(userId);

    const since = new Date();
    since.setDate(since.getDate() - 30);
    const count = await this.db.countDismissals(userId, since);

    if (count >= this.dismissalThreshold) {
      const inCooldown = await this.isInCooldown(userId);
      if (!inCooldown) {
        await this.createOffer(userId, "paywall_dismissals");
      }
    }
  }

  async checkEligibility(
    userId: string,
    opts?: { stage?: string; daysSinceActive?: number }
  ): Promise<ConversionOffer | null> {
    const existing = await this.db.getActiveOffer(userId);
    if (existing && !this.isExpired(existing)) return existing;

    const inCooldown = await this.isInCooldown(userId);
    if (inCooldown) return null;

    // Check paywall dismissal trigger
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const dismissals = await this.db.countDismissals(userId, since);
    if (dismissals >= this.dismissalThreshold) {
      return this.createOffer(userId, "paywall_dismissals");
    }

    // Check lifecycle stage trigger
    if (opts?.stage && this.triggerStages.includes(opts.stage)) {
      return this.createOffer(userId, "lifecycle_stage");
    }

    // Check inactivity winback trigger
    if (opts?.daysSinceActive !== undefined && opts.daysSinceActive >= this.inactivityDays) {
      return this.createOffer(userId, "inactivity_winback");
    }

    return null;
  }

  async getActiveOffer(userId: string): Promise<ConversionOffer | null> {
    const offer = await this.db.getActiveOffer(userId);
    if (!offer) return null;
    if (this.isExpired(offer) || offer.redeemed) return null;
    return offer;
  }

  async redeemOffer(userId: string): Promise<void> {
    const offer = await this.getActiveOffer(userId);
    if (!offer) throw new NotFoundError("no active offer");
    await this.db.markRedeemed(userId);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async isInCooldown(userId: string): Promise<boolean> {
    const last = await this.db.lastOfferDate(userId);
    if (!last) return false;
    const lastDate = last instanceof Date ? last : new Date(last);
    const cooldownEnd = new Date(lastDate.getTime() + this.cooldownDays * 86_400_000);
    return new Date() < cooldownEnd;
  }

  private isExpired(offer: ConversionOffer): boolean {
    const expires = offer.expires_at instanceof Date ? offer.expires_at : new Date(offer.expires_at);
    return new Date() > expires;
  }

  private async createOffer(
    userId: string,
    trigger: ConversionOffer["trigger"]
  ): Promise<ConversionOffer> {
    const now = new Date();
    const offer: ConversionOffer = {
      user_id: userId,
      discount_pct: this.discountPct,
      expires_at: new Date(now.getTime() + this.offerTtlMinutes * 60_000),
      trigger,
      redeemed: false,
      created_at: now,
    };
    await this.db.createOffer(offer);
    return offer;
  }
}
