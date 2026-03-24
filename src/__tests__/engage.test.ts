import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { EngageService, type EngageDB, type EngageConfig, type EventHook } from "../engage/index.js";

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

function buildApp(db: EngageDB, cfg: EngageConfig = {}) {
  const svc = new EngageService(cfg, db);
  const a = new Hono();
  a.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  a.post("/events", svc.handleTrackEvents);
  a.put("/subscription", svc.handleUpdateSubscription);
  a.post("/sessions", svc.handleSessionReport);
  a.post("/feedback", svc.handleSubmitFeedback);
  return { app: a, svc };
}

describe("EngageService", () => {
  describe("handleTrackEvents", () => {
    it("rejects empty events (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [] }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("events array is required");
    });

    it("rejects > 100 events (400)", async () => {
      const { app } = buildApp(mockDB());
      const events = Array.from({ length: 101 }, (_, i) => ({ event: `e${i}` }));
      const res = await app.request("/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("maximum 100");
    });

    it("rejects events with missing event name (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ metadata: {} }] }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("event");
    });

    it("tracks valid events successfully", async () => {
      const db = mockDB();
      const { app } = buildApp(db);
      const res = await app.request("/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ event: "tap_button" }, { event: "view_screen" }] }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.tracked).toBe(2);
      expect(db.trackEvents).toHaveBeenCalledWith("user-1", expect.any(Array));
    });

    it("triggers event hooks", async () => {
      const db = mockDB();
      const { app, svc } = buildApp(db);
      const hook: EventHook = vi.fn();
      svc.registerEventHook(hook);

      await app.request("/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ event: "purchase" }] }),
      });

      expect(hook).toHaveBeenCalledWith("user-1", expect.arrayContaining([
        expect.objectContaining({ event: "purchase" }),
      ]));
    });
  });

  describe("handleUpdateSubscription", () => {
    it("rejects invalid status (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "bogus" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("status must be one of");
    });
  });

  describe("handleSessionReport", () => {
    it("rejects missing session_id (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("session_id");
    });

    it("rejects invalid action (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: "s1", action: "pause" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("action must be");
    });

    it("rejects duration > 86400 (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: "s1", action: "end", duration_s: 90000 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("duration_s");
    });
  });

  describe("handleSubmitFeedback", () => {
    it("rejects missing message (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("message is required");
    });

    it("rejects message > 5000 chars (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "x".repeat(5001) }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("too long");
    });

    it("rejects invalid feedback type (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "great app", type: "rant" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("type must be one of");
    });
  });
});
