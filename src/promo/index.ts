import { ValidationError, NotFoundError, ServiceError } from "../errors/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export type CommissionModel =
  | { type: "revenue_share"; percent: number }
  | { type: "flat_per_purchase"; amount_cents: number; currency: string }
  | { type: "flat_per_redemption"; amount_cents: number; currency: string };

export interface Influencer {
  id: string;
  name: string;
  email?: string;
  portal_token: string;
  commission: CommissionModel;
  active: boolean;
  created_at: Date;
}

export interface PromoCode {
  code: string;
  influencer_id: string;
  type: "discount" | "trial_extension" | "premium_grant";
  discount_pct?: number;
  grant_days?: number;
  max_redemptions: number;
  redeemed_count: number;
  expires_at?: Date;
  active: boolean;
  created_at: Date;
}

export interface PromoRedemption {
  id: string;
  user_id: string;
  code: string;
  influencer_id: string;
  redeemed_at: Date;
  purchase_amount_cents?: number;
  commission_cents?: number;
}

export interface PromoDB {
  getCode(code: string): Promise<PromoCode | null>;
  createCode(code: PromoCode): Promise<void>;
  updateCode(code: string, updates: Partial<PromoCode>): Promise<void>;
  listCodes(opts?: { influencer_id?: string; active?: boolean }): Promise<PromoCode[]>;
  incrementRedeemed(code: string): Promise<void>;

  recordRedemption(redemption: PromoRedemption): Promise<void>;
  hasRedeemed(userId: string, code: string): Promise<boolean>;
  listRedemptions(opts: { influencer_id?: string; code?: string }): Promise<PromoRedemption[]>;

  getInfluencer(id: string): Promise<Influencer | null>;
  getInfluencerByToken(portalToken: string): Promise<Influencer | null>;
  createInfluencer(influencer: Influencer): Promise<void>;
  updateInfluencer(id: string, updates: Partial<Influencer>): Promise<void>;
  listInfluencers(): Promise<Influencer[]>;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class PromoService {
  constructor(private db: PromoDB) {}

  // ── Public: Redemption ──────────────────────────────────────────────────

  async redeemCode(
    userId: string,
    code: string
  ): Promise<{ type: PromoCode["type"]; discount_pct?: number; grant_days?: number }> {
    if (!userId) throw new ValidationError("user_id is required");
    if (!code) throw new ValidationError("code is required");

    const promo = await this.db.getCode(code);
    if (!promo) throw new NotFoundError("promo code not found");
    if (!promo.active) throw new ValidationError("promo code is not active");
    if (promo.expires_at && promo.expires_at < new Date()) {
      throw new ValidationError("promo code has expired");
    }
    if (promo.max_redemptions > 0 && promo.redeemed_count >= promo.max_redemptions) {
      throw new ValidationError("promo code has reached maximum redemptions");
    }

    const alreadyRedeemed = await this.db.hasRedeemed(userId, code);
    if (alreadyRedeemed) throw new ValidationError("user has already redeemed this code");

    const redemption: PromoRedemption = {
      id: crypto.randomUUID(),
      user_id: userId,
      code,
      influencer_id: promo.influencer_id,
      redeemed_at: new Date(),
    };

    try {
      await this.db.recordRedemption(redemption);
      await this.db.incrementRedeemed(code);
    } catch {
      throw new ServiceError("INTERNAL", "failed to record redemption");
    }

    const result: { type: PromoCode["type"]; discount_pct?: number; grant_days?: number } = {
      type: promo.type,
    };
    if (promo.discount_pct !== undefined) result.discount_pct = promo.discount_pct;
    if (promo.grant_days !== undefined) result.grant_days = promo.grant_days;
    return result;
  }

  async recordPurchase(userId: string, code: string, amountCents: number): Promise<void> {
    if (!userId) throw new ValidationError("user_id is required");
    if (!code) throw new ValidationError("code is required");
    if (amountCents < 0) throw new ValidationError("amount_cents must be non-negative");

    const promo = await this.db.getCode(code);
    if (!promo) throw new NotFoundError("promo code not found");

    const influencer = await this.db.getInfluencer(promo.influencer_id);
    if (!influencer) throw new NotFoundError("influencer not found");

    const commissionCents = this.calculateCommission(influencer.commission, amountCents);

    const redemptions = await this.db.listRedemptions({ code });
    const redemption = redemptions.find((r) => r.user_id === userId);
    if (!redemption) throw new NotFoundError("redemption not found for this user and code");

    try {
      await this.db.recordRedemption({
        ...redemption,
        purchase_amount_cents: amountCents,
        commission_cents: commissionCents,
      });
    } catch {
      throw new ServiceError("INTERNAL", "failed to record purchase");
    }
  }

  // ── Public: Influencer Portal ───────────────────────────────────────────

  async getInfluencerStats(influencerId: string): Promise<{
    totalRedemptions: number;
    totalPurchases: number;
    totalEarningsCents: number;
    codes: PromoCode[];
  }> {
    if (!influencerId) throw new ValidationError("influencer_id is required");

    const influencer = await this.db.getInfluencer(influencerId);
    if (!influencer) throw new NotFoundError("influencer not found");

    const codes = await this.db.listCodes({ influencer_id: influencerId });
    const redemptions = await this.db.listRedemptions({ influencer_id: influencerId });

    const totalRedemptions = redemptions.length;
    const totalPurchases = redemptions.filter((r) => r.purchase_amount_cents !== undefined).length;
    const totalEarningsCents = redemptions.reduce((sum, r) => sum + (r.commission_cents ?? 0), 0);

    return { totalRedemptions, totalPurchases, totalEarningsCents, codes };
  }

  async getInfluencerPortal(portalToken: string): Promise<{
    influencer: Omit<Influencer, "portal_token">;
    stats: { totalRedemptions: number; totalPurchases: number; totalEarningsCents: number };
    recentRedemptions: Array<{ code: string; redeemed_at: Date }>;
  }> {
    if (!portalToken) throw new ValidationError("portal_token is required");

    const influencer = await this.db.getInfluencerByToken(portalToken);
    if (!influencer) throw new NotFoundError("invalid portal token");

    const stats = await this.getInfluencerStats(influencer.id);
    const redemptions = await this.db.listRedemptions({ influencer_id: influencer.id });

    const recentRedemptions = redemptions
      .sort((a, b) => b.redeemed_at.getTime() - a.redeemed_at.getTime())
      .slice(0, 50)
      .map((r) => ({ code: r.code, redeemed_at: r.redeemed_at }));

    const { portal_token: _omit, ...influencerInfo } = influencer;

    return {
      influencer: influencerInfo,
      stats: {
        totalRedemptions: stats.totalRedemptions,
        totalPurchases: stats.totalPurchases,
        totalEarningsCents: stats.totalEarningsCents,
      },
      recentRedemptions,
    };
  }

  // ── Admin: Codes ────────────────────────────────────────────────────────

  async createCode(input: {
    code?: string;
    influencer_id?: string;
    type?: PromoCode["type"];
    discount_pct?: number;
    grant_days?: number;
    max_redemptions?: number;
    expires_at?: Date;
  }): Promise<PromoCode> {
    if (!input.code) throw new ValidationError("code is required");
    if (!input.influencer_id) throw new ValidationError("influencer_id is required");
    if (!input.type) throw new ValidationError("type is required");

    const existing = await this.db.getCode(input.code);
    if (existing) throw new ValidationError("code already exists");

    const influencer = await this.db.getInfluencer(input.influencer_id);
    if (!influencer) throw new NotFoundError("influencer not found");

    const promo: PromoCode = {
      code: input.code,
      influencer_id: input.influencer_id,
      type: input.type,
      discount_pct: input.discount_pct,
      grant_days: input.grant_days,
      max_redemptions: input.max_redemptions ?? 0,
      redeemed_count: 0,
      expires_at: input.expires_at,
      active: true,
      created_at: new Date(),
    };

    try {
      await this.db.createCode(promo);
    } catch {
      throw new ServiceError("INTERNAL", "failed to create promo code");
    }
    return promo;
  }

  async updateCode(
    code: string,
    input: {
      discount_pct?: number;
      grant_days?: number;
      max_redemptions?: number;
      expires_at?: Date;
      active?: boolean;
    }
  ): Promise<PromoCode> {
    if (!code) throw new ValidationError("code is required");

    const existing = await this.db.getCode(code);
    if (!existing) throw new NotFoundError("promo code not found");

    try {
      await this.db.updateCode(code, input);
    } catch {
      throw new ServiceError("INTERNAL", "failed to update promo code");
    }

    return { ...existing, ...input };
  }

  async deactivateCode(code: string): Promise<void> {
    if (!code) throw new ValidationError("code is required");

    const existing = await this.db.getCode(code);
    if (!existing) throw new NotFoundError("promo code not found");

    try {
      await this.db.updateCode(code, { active: false });
    } catch {
      throw new ServiceError("INTERNAL", "failed to deactivate promo code");
    }
  }

  async listCodes(opts?: { influencer_id?: string; active?: boolean }): Promise<PromoCode[]> {
    return this.db.listCodes(opts);
  }

  // ── Admin: Influencers ──────────────────────────────────────────────────

  async createInfluencer(input: {
    id?: string;
    name?: string;
    email?: string;
    commission?: CommissionModel;
  }): Promise<Influencer> {
    if (!input.name) throw new ValidationError("name is required");
    if (!input.commission) throw new ValidationError("commission is required");

    const influencer: Influencer = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name,
      email: input.email,
      portal_token: crypto.randomUUID(),
      commission: input.commission,
      active: true,
      created_at: new Date(),
    };

    try {
      await this.db.createInfluencer(influencer);
    } catch {
      throw new ServiceError("INTERNAL", "failed to create influencer");
    }
    return influencer;
  }

  async updateInfluencer(
    id: string,
    input: { name?: string; email?: string; commission?: CommissionModel; active?: boolean }
  ): Promise<void> {
    if (!id) throw new ValidationError("influencer id is required");

    const existing = await this.db.getInfluencer(id);
    if (!existing) throw new NotFoundError("influencer not found");

    try {
      await this.db.updateInfluencer(id, input);
    } catch {
      throw new ServiceError("INTERNAL", "failed to update influencer");
    }
  }

  async listInfluencers(): Promise<Influencer[]> {
    return this.db.listInfluencers();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private calculateCommission(model: CommissionModel, amountCents: number): number {
    switch (model.type) {
      case "revenue_share":
        return Math.round(amountCents * (model.percent / 100));
      case "flat_per_purchase":
        return model.amount_cents;
      case "flat_per_redemption":
        return model.amount_cents;
    }
  }
}
