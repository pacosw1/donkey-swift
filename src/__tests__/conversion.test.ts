import { describe, it, expect, vi } from "vitest";
import { ConversionService, type ConversionDB, type ConversionOffer, type ConversionConfig } from "../conversion/index.js";
import { NotFoundError } from "../errors/index.js";

function makeOffer(overrides: Partial<ConversionOffer> = {}): ConversionOffer {
  return {
    user_id: "user-1",
    discount_pct: 20,
    expires_at: new Date(Date.now() + 86_400_000),
    trigger: "paywall_dismissals",
    redeemed: false,
    created_at: new Date(),
    ...overrides,
  };
}

function mockDB(overrides: Partial<ConversionDB> = {}): ConversionDB {
  return {
    getActiveOffer: vi.fn().mockResolvedValue(null),
    createOffer: vi.fn().mockResolvedValue(undefined),
    markRedeemed: vi.fn().mockResolvedValue(undefined),
    countDismissals: vi.fn().mockResolvedValue(0),
    recordDismissal: vi.fn().mockResolvedValue(undefined),
    lastOfferDate: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function buildService(dbOverrides: Partial<ConversionDB> = {}, cfg: ConversionConfig = {}): { svc: ConversionService; db: ConversionDB } {
  const db = mockDB(dbOverrides);
  const svc = new ConversionService(cfg, db);
  return { svc, db };
}

describe("ConversionService", () => {
  describe("recordDismissal", () => {
    it("records dismissal in DB", async () => {
      const { svc, db } = buildService();
      await svc.recordDismissal("user-1");
      expect(db.recordDismissal).toHaveBeenCalledWith("user-1");
    });

    it("triggers offer when threshold reached", async () => {
      const { svc, db } = buildService({
        countDismissals: vi.fn().mockResolvedValue(3),
      }, { dismissalThreshold: 3 });
      await svc.recordDismissal("user-1");
      expect(db.createOffer).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: "user-1", trigger: "paywall_dismissals" })
      );
    });

    it("respects cooldown (no offer if recent offer exists)", async () => {
      const { svc, db } = buildService({
        countDismissals: vi.fn().mockResolvedValue(5),
        lastOfferDate: vi.fn().mockResolvedValue(new Date()), // just now
      }, { dismissalThreshold: 3, cooldownDays: 7 });
      await svc.recordDismissal("user-1");
      expect(db.createOffer).not.toHaveBeenCalled();
    });
  });

  describe("checkEligibility", () => {
    it("triggers for lifecycle stage match", async () => {
      const { svc, db } = buildService({
        countDismissals: vi.fn().mockResolvedValue(0),
      }, { triggerStages: ["at_risk"] });
      const offer = await svc.checkEligibility("user-1", { stage: "at_risk" });
      expect(offer).not.toBeNull();
      expect(offer!.trigger).toBe("lifecycle_stage");
      expect(db.createOffer).toHaveBeenCalled();
    });

    it("triggers for inactivity", async () => {
      const { svc, db } = buildService({
        countDismissals: vi.fn().mockResolvedValue(0),
      }, { inactivityDays: 14 });
      const offer = await svc.checkEligibility("user-1", { daysSinceActive: 20 });
      expect(offer).not.toBeNull();
      expect(offer!.trigger).toBe("inactivity_winback");
      expect(db.createOffer).toHaveBeenCalled();
    });

    it("no offer when already has active offer", async () => {
      const existing = makeOffer();
      const { svc, db } = buildService({
        getActiveOffer: vi.fn().mockResolvedValue(existing),
      });
      const offer = await svc.checkEligibility("user-1", { stage: "at_risk" });
      expect(offer).toEqual(existing);
      expect(db.createOffer).not.toHaveBeenCalled();
    });
  });

  describe("getActiveOffer", () => {
    it("returns offer when exists", async () => {
      const existing = makeOffer();
      const { svc } = buildService({
        getActiveOffer: vi.fn().mockResolvedValue(existing),
      });
      const offer = await svc.getActiveOffer("user-1");
      expect(offer).not.toBeNull();
      expect(offer!.user_id).toBe("user-1");
    });

    it("returns null when expired", async () => {
      const expired = makeOffer({ expires_at: new Date("2020-01-01") });
      const { svc } = buildService({
        getActiveOffer: vi.fn().mockResolvedValue(expired),
      });
      const offer = await svc.getActiveOffer("user-1");
      expect(offer).toBeNull();
    });
  });

  describe("redeemOffer", () => {
    it("marks redeemed", async () => {
      const existing = makeOffer();
      const { svc, db } = buildService({
        getActiveOffer: vi.fn().mockResolvedValue(existing),
      });
      await svc.redeemOffer("user-1");
      expect(db.markRedeemed).toHaveBeenCalledWith("user-1");
    });

    it("throws when no active offer", async () => {
      const { svc } = buildService();
      await expect(svc.redeemOffer("user-1")).rejects.toThrow(NotFoundError);
      await expect(svc.redeemOffer("user-1")).rejects.toThrow("no active offer");
    });
  });
});
