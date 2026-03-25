import { describe, it, expect, vi } from "vitest";
import { PromoService, type PromoDB, type PromoCode, type Influencer, type PromoRedemption } from "../promo/index.js";
import { ValidationError, NotFoundError } from "../errors/index.js";

function makeCode(overrides: Partial<PromoCode> = {}): PromoCode {
  return {
    code: "SAVE20",
    influencer_id: "inf-1",
    type: "discount",
    discount_pct: 20,
    max_redemptions: 100,
    redeemed_count: 5,
    active: true,
    created_at: new Date("2025-01-01"),
    ...overrides,
  };
}

function makeInfluencer(overrides: Partial<Influencer> = {}): Influencer {
  return {
    id: "inf-1",
    name: "Test Influencer",
    email: "inf@example.com",
    portal_token: "tok-abc",
    commission: { type: "revenue_share", percent: 10 },
    active: true,
    created_at: new Date("2025-01-01"),
    ...overrides,
  };
}

function mockDB(overrides: Partial<PromoDB> = {}): PromoDB {
  return {
    getCode: vi.fn().mockResolvedValue(makeCode()),
    createCode: vi.fn().mockResolvedValue(undefined),
    updateCode: vi.fn().mockResolvedValue(undefined),
    listCodes: vi.fn().mockResolvedValue([]),
    incrementRedeemed: vi.fn().mockResolvedValue(undefined),
    recordRedemption: vi.fn().mockResolvedValue(undefined),
    hasRedeemed: vi.fn().mockResolvedValue(false),
    listRedemptions: vi.fn().mockResolvedValue([]),
    getInfluencer: vi.fn().mockResolvedValue(makeInfluencer()),
    getInfluencerByToken: vi.fn().mockResolvedValue(makeInfluencer()),
    createInfluencer: vi.fn().mockResolvedValue(undefined),
    updateInfluencer: vi.fn().mockResolvedValue(undefined),
    listInfluencers: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("PromoService", () => {
  describe("redeemCode", () => {
    it("valid code returns grant details", async () => {
      const db = mockDB();
      const svc = new PromoService(db);
      const result = await svc.redeemCode("user-1", "SAVE20");
      expect(result.type).toBe("discount");
      expect(result.discount_pct).toBe(20);
      expect(db.recordRedemption).toHaveBeenCalled();
      expect(db.incrementRedeemed).toHaveBeenCalledWith("SAVE20");
    });

    it("throws ValidationError for inactive code", async () => {
      const db = mockDB({ getCode: vi.fn().mockResolvedValue(makeCode({ active: false })) });
      const svc = new PromoService(db);
      await expect(svc.redeemCode("user-1", "SAVE20")).rejects.toThrow(ValidationError);
      await expect(svc.redeemCode("user-1", "SAVE20")).rejects.toThrow("not active");
    });

    it("throws ValidationError for expired code", async () => {
      const db = mockDB({
        getCode: vi.fn().mockResolvedValue(makeCode({ expires_at: new Date("2020-01-01") })),
      });
      const svc = new PromoService(db);
      await expect(svc.redeemCode("user-1", "SAVE20")).rejects.toThrow(ValidationError);
      await expect(svc.redeemCode("user-1", "SAVE20")).rejects.toThrow("expired");
    });

    it("throws ValidationError when max redemptions reached", async () => {
      const db = mockDB({
        getCode: vi.fn().mockResolvedValue(makeCode({ max_redemptions: 10, redeemed_count: 10 })),
      });
      const svc = new PromoService(db);
      await expect(svc.redeemCode("user-1", "SAVE20")).rejects.toThrow(ValidationError);
      await expect(svc.redeemCode("user-1", "SAVE20")).rejects.toThrow("maximum redemptions");
    });

    it("throws ValidationError when already redeemed by same user", async () => {
      const db = mockDB({ hasRedeemed: vi.fn().mockResolvedValue(true) });
      const svc = new PromoService(db);
      await expect(svc.redeemCode("user-1", "SAVE20")).rejects.toThrow(ValidationError);
      await expect(svc.redeemCode("user-1", "SAVE20")).rejects.toThrow("already redeemed");
    });

    it("throws NotFoundError for non-existent code", async () => {
      const db = mockDB({ getCode: vi.fn().mockResolvedValue(null) });
      const svc = new PromoService(db);
      await expect(svc.redeemCode("user-1", "NOPE")).rejects.toThrow(NotFoundError);
      await expect(svc.redeemCode("user-1", "NOPE")).rejects.toThrow("not found");
    });
  });

  describe("recordPurchase", () => {
    it("calculates revenue_share commission correctly", async () => {
      const redemption: PromoRedemption = {
        id: "r-1",
        user_id: "user-1",
        code: "SAVE20",
        influencer_id: "inf-1",
        redeemed_at: new Date(),
      };
      const db = mockDB({
        listRedemptions: vi.fn().mockResolvedValue([redemption]),
        getInfluencer: vi.fn().mockResolvedValue(
          makeInfluencer({ commission: { type: "revenue_share", percent: 10 } })
        ),
      });
      const svc = new PromoService(db);
      await svc.recordPurchase("user-1", "SAVE20", 5000);
      // 10% of 5000 = 500
      expect(db.recordRedemption).toHaveBeenCalledWith(
        expect.objectContaining({
          purchase_amount_cents: 5000,
          commission_cents: 500,
        })
      );
    });

    it("calculates flat_per_purchase commission correctly", async () => {
      const redemption: PromoRedemption = {
        id: "r-1",
        user_id: "user-1",
        code: "SAVE20",
        influencer_id: "inf-1",
        redeemed_at: new Date(),
      };
      const db = mockDB({
        listRedemptions: vi.fn().mockResolvedValue([redemption]),
        getInfluencer: vi.fn().mockResolvedValue(
          makeInfluencer({ commission: { type: "flat_per_purchase", amount_cents: 200, currency: "USD" } })
        ),
      });
      const svc = new PromoService(db);
      await svc.recordPurchase("user-1", "SAVE20", 5000);
      expect(db.recordRedemption).toHaveBeenCalledWith(
        expect.objectContaining({
          purchase_amount_cents: 5000,
          commission_cents: 200,
        })
      );
    });
  });

  describe("getInfluencerStats", () => {
    it("returns totals", async () => {
      const redemptions: PromoRedemption[] = [
        { id: "r-1", user_id: "u1", code: "C1", influencer_id: "inf-1", redeemed_at: new Date(), purchase_amount_cents: 1000, commission_cents: 100 },
        { id: "r-2", user_id: "u2", code: "C1", influencer_id: "inf-1", redeemed_at: new Date() },
      ];
      const codes = [makeCode()];
      const db = mockDB({
        listRedemptions: vi.fn().mockResolvedValue(redemptions),
        listCodes: vi.fn().mockResolvedValue(codes),
      });
      const svc = new PromoService(db);
      const stats = await svc.getInfluencerStats("inf-1");
      expect(stats.totalRedemptions).toBe(2);
      expect(stats.totalPurchases).toBe(1);
      expect(stats.totalEarningsCents).toBe(100);
      expect(stats.codes).toEqual(codes);
    });
  });

  describe("getInfluencerPortal", () => {
    it("throws NotFoundError for invalid token", async () => {
      const db = mockDB({ getInfluencerByToken: vi.fn().mockResolvedValue(null) });
      const svc = new PromoService(db);
      await expect(svc.getInfluencerPortal("bad-token")).rejects.toThrow(NotFoundError);
      await expect(svc.getInfluencerPortal("bad-token")).rejects.toThrow("invalid portal token");
    });
  });

  describe("createCode", () => {
    it("validates required fields", async () => {
      const db = mockDB();
      const svc = new PromoService(db);
      await expect(svc.createCode({})).rejects.toThrow(ValidationError);
      await expect(svc.createCode({ code: "X" })).rejects.toThrow("influencer_id is required");
      await expect(svc.createCode({ code: "X", influencer_id: "inf-1" })).rejects.toThrow("type is required");
    });
  });

  describe("createInfluencer", () => {
    it("validates required fields", async () => {
      const db = mockDB();
      const svc = new PromoService(db);
      await expect(svc.createInfluencer({})).rejects.toThrow(ValidationError);
      await expect(svc.createInfluencer({ name: "Test" })).rejects.toThrow("commission is required");
    });
  });

  describe("deactivateCode", () => {
    it("sets active=false", async () => {
      const db = mockDB();
      const svc = new PromoService(db);
      await svc.deactivateCode("SAVE20");
      expect(db.updateCode).toHaveBeenCalledWith("SAVE20", { active: false });
    });
  });
});
