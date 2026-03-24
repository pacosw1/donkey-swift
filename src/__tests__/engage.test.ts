import { describe, it, expect, vi } from "vitest";
import { EngageService, type EngageDB, type EngageConfig, type EventHook } from "../engage/index.js";
import { ValidationError, ServiceError } from "../errors/index.js";

function mockDB(overrides: Partial<EngageDB> = {}): EngageDB {
  return {
    trackEvents: vi.fn().mockResolvedValue(undefined),
    updateSubscription: vi.fn().mockResolvedValue(undefined),
    updateSubscriptionDetails: vi.fn().mockResolvedValue(undefined),
    getSubscription: vi.fn().mockResolvedValue(null),
    isProUser: vi.fn().mockResolvedValue(false),
    getEngagementData: vi.fn().mockResolvedValue({
      days_active: 0,
      total_logs: 0,
      current_streak: 0,
      subscription_status: "free",
      paywall_shown_count: 0,
      last_paywall_date: "",
      goals_completed_total: 0,
    }),
    startSession: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
    saveFeedback: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildService(db?: EngageDB, cfg: EngageConfig = {}): EngageService {
  return new EngageService(cfg, db ?? mockDB());
}

describe("EngageService", () => {
  describe("trackEvents", () => {
    it("rejects empty events", async () => {
      const svc = buildService();
      await expect(svc.trackEvents("user-1", [])).rejects.toThrow(ValidationError);
      await expect(svc.trackEvents("user-1", [])).rejects.toThrow("events array is required");
    });

    it("rejects > 100 events", async () => {
      const svc = buildService();
      const events = Array.from({ length: 101 }, (_, i) => ({ event: `e${i}` }));
      await expect(svc.trackEvents("user-1", events)).rejects.toThrow("maximum 100");
    });

    it("rejects events with missing event name", async () => {
      const svc = buildService();
      await expect(
        svc.trackEvents("user-1", [{ metadata: {} } as { event: string }])
      ).rejects.toThrow("event");
    });

    it("tracks valid events successfully", async () => {
      const db = mockDB();
      const svc = buildService(db);
      const result = await svc.trackEvents("user-1", [{ event: "tap_button" }, { event: "view_screen" }]);
      expect(result.tracked).toBe(2);
      expect(db.trackEvents).toHaveBeenCalledWith("user-1", expect.any(Array));
    });

    it("triggers event hooks", async () => {
      const db = mockDB();
      const svc = buildService(db);
      const hook: EventHook = vi.fn();
      svc.registerEventHook(hook);

      await svc.trackEvents("user-1", [{ event: "purchase" }]);

      expect(hook).toHaveBeenCalledWith("user-1", expect.arrayContaining([
        expect.objectContaining({ event: "purchase" }),
      ]));
    });

    it("throws ServiceError when DB fails", async () => {
      const db = mockDB({ trackEvents: vi.fn().mockRejectedValue(new Error("db down")) });
      const svc = buildService(db);
      await expect(
        svc.trackEvents("user-1", [{ event: "test" }])
      ).rejects.toThrow(ServiceError);
    });
  });

  describe("updateSubscription", () => {
    it("rejects invalid status", async () => {
      const svc = buildService();
      await expect(
        svc.updateSubscription("user-1", { status: "bogus" })
      ).rejects.toThrow("status must be one of");
    });

    it("rejects missing status", async () => {
      const svc = buildService();
      await expect(
        svc.updateSubscription("user-1", {})
      ).rejects.toThrow("status is required");
    });
  });

  describe("reportSession", () => {
    it("rejects missing session_id", async () => {
      const svc = buildService();
      await expect(
        svc.reportSession("user-1", { action: "start" } as { session_id: string; action: "start" | "end" })
      ).rejects.toThrow("session_id");
    });

    it("rejects invalid action", async () => {
      const svc = buildService();
      await expect(
        svc.reportSession("user-1", { session_id: "s1", action: "pause" as "start" | "end" })
      ).rejects.toThrow("action must be");
    });

    it("rejects duration > 86400", async () => {
      const svc = buildService();
      await expect(
        svc.reportSession("user-1", { session_id: "s1", action: "end", duration_s: 90000 })
      ).rejects.toThrow("duration_s");
    });

    it("starts a session successfully", async () => {
      const db = mockDB();
      const svc = buildService(db);
      const result = await svc.reportSession("user-1", { session_id: "s1", action: "start" });
      expect(result.status).toBe("ok");
      expect(db.startSession).toHaveBeenCalledWith("user-1", "s1", "", "", "");
    });
  });

  describe("submitFeedback", () => {
    it("rejects missing message", async () => {
      const svc = buildService();
      await expect(
        svc.submitFeedback("user-1", { message: "" })
      ).rejects.toThrow("message is required");
    });

    it("rejects message > 5000 chars", async () => {
      const svc = buildService();
      await expect(
        svc.submitFeedback("user-1", { message: "x".repeat(5001) })
      ).rejects.toThrow("too long");
    });

    it("rejects invalid feedback type", async () => {
      const svc = buildService();
      await expect(
        svc.submitFeedback("user-1", { message: "great app", type: "rant" })
      ).rejects.toThrow("type must be one of");
    });

    it("saves feedback successfully", async () => {
      const db = mockDB();
      const svc = buildService(db);
      const result = await svc.submitFeedback("user-1", { message: "great app" });
      expect(result.status).toBe("received");
      expect(db.saveFeedback).toHaveBeenCalledWith("user-1", "general", "great app", "");
    });
  });
});
