import { describe, it, expect, vi } from "vitest";
import { GrantService, type GrantDB, type PremiumGrant } from "../grants/index.js";

function makeGrant(overrides: Partial<PremiumGrant> = {}): PremiumGrant {
  return {
    id: "grant-1",
    user_id: "user-1",
    granted_by: "admin",
    reason: "test",
    created_at: new Date("2025-01-01"),
    ...overrides,
  };
}

function mockDB(overrides: Partial<GrantDB> = {}): GrantDB {
  return {
    createGrant: vi.fn().mockResolvedValue(undefined),
    getActiveGrant: vi.fn().mockResolvedValue(null),
    listGrants: vi.fn().mockResolvedValue([]),
    revokeGrant: vi.fn().mockResolvedValue(undefined),
    listAllActiveGrants: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("GrantService", () => {
  describe("grantPremium", () => {
    it("creates grant with expiry (e.g. 30 days)", async () => {
      const db = mockDB();
      const svc = new GrantService(db);
      const grant = await svc.grantPremium({
        userId: "user-1",
        grantedBy: "admin",
        reason: "promo",
        days: 30,
      });
      expect(grant.user_id).toBe("user-1");
      expect(grant.expires_at).toBeInstanceOf(Date);
      expect(grant.expires_at!.getTime()).toBeGreaterThan(Date.now());
      expect(db.createGrant).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1" }));
    });

    it("creates forever grant (days=0)", async () => {
      const db = mockDB();
      const svc = new GrantService(db);
      const grant = await svc.grantPremium({
        userId: "user-1",
        grantedBy: "admin",
        reason: "lifetime",
        days: 0,
      });
      expect(grant.expires_at).toBeUndefined();
    });
  });

  describe("isGrantedPremium", () => {
    it("returns true when active grant exists", async () => {
      const db = mockDB({ getActiveGrant: vi.fn().mockResolvedValue(makeGrant()) });
      const svc = new GrantService(db);
      expect(await svc.isGrantedPremium("user-1")).toBe(true);
    });

    it("returns false when no grant", async () => {
      const db = mockDB({ getActiveGrant: vi.fn().mockResolvedValue(null) });
      const svc = new GrantService(db);
      expect(await svc.isGrantedPremium("user-1")).toBe(false);
    });

    it("returns false when grant expired", async () => {
      // The DB layer is expected to filter expired grants, so getActiveGrant returns null
      const db = mockDB({ getActiveGrant: vi.fn().mockResolvedValue(null) });
      const svc = new GrantService(db);
      expect(await svc.isGrantedPremium("user-1")).toBe(false);
    });

    it("returns false when grant revoked", async () => {
      // The DB layer is expected to filter revoked grants, so getActiveGrant returns null
      const db = mockDB({ getActiveGrant: vi.fn().mockResolvedValue(null) });
      const svc = new GrantService(db);
      expect(await svc.isGrantedPremium("user-1")).toBe(false);
    });
  });

  describe("revokeGrant", () => {
    it("sets revoked_at", async () => {
      const db = mockDB();
      const svc = new GrantService(db);
      await svc.revokeGrant("grant-1");
      expect(db.revokeGrant).toHaveBeenCalledWith("grant-1", expect.any(Date));
    });
  });

  describe("listGrants", () => {
    it("returns all grants including revoked", async () => {
      const grants = [
        makeGrant({ id: "g1" }),
        makeGrant({ id: "g2", revoked_at: new Date() }),
      ];
      const db = mockDB({ listGrants: vi.fn().mockResolvedValue(grants) });
      const svc = new GrantService(db);
      const result = await svc.listGrants("user-1");
      expect(result).toHaveLength(2);
      expect(result[1].revoked_at).toBeDefined();
    });
  });

  describe("listAllActiveGrants", () => {
    it("returns only active grants", async () => {
      const grants = [makeGrant({ id: "g1" })];
      const db = mockDB({ listAllActiveGrants: vi.fn().mockResolvedValue(grants) });
      const svc = new GrantService(db);
      const result = await svc.listAllActiveGrants();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("g1");
    });
  });
});
