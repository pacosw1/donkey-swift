import { describe, it, expect, vi } from "vitest";
import { LifecycleService, type LifecycleDB, type LifecycleConfig } from "../lifecycle/index.js";
import type { PushProvider } from "../push/index.js";

function mockDB(overrides: Partial<LifecycleDB> = {}): LifecycleDB {
  return {
    userCreatedAndLastActive: vi.fn().mockResolvedValue({
      createdAt: new Date(),
      lastActiveAt: new Date(),
    }),
    countSessions: vi.fn().mockResolvedValue(0),
    countRecentSessions: vi.fn().mockResolvedValue(0),
    countDistinctEventDays: vi.fn().mockResolvedValue(0),
    isProUser: vi.fn().mockResolvedValue(false),
    lastPrompt: vi.fn().mockResolvedValue(null),
    countPrompts: vi.fn().mockResolvedValue(0),
    recordPrompt: vi.fn().mockResolvedValue(undefined),
    enabledDeviceTokens: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function mockPush(): PushProvider {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendSilent: vi.fn().mockResolvedValue(undefined),
    sendWithData: vi.fn().mockResolvedValue(undefined),
  };
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

describe("LifecycleService.evaluateUser", () => {
  it("new user: low sessions, recently created, no aha moment", async () => {
    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(2),
        lastActiveAt: daysAgo(0),
      }),
      countSessions: vi.fn().mockResolvedValue(3),
      countRecentSessions: vi.fn().mockResolvedValue(2),
    });

    const svc = new LifecycleService({}, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    expect(es.stage).toBe("new");
    expect(es.score).toBeLessThan(40);
    expect(es.aha_reached).toBe(false);
    expect(es.is_pro).toBe(false);
  });

  it("engaged user: high recent activity, aha reached, no subscription", async () => {
    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(30),
        lastActiveAt: daysAgo(0),
      }),
      countSessions: vi.fn().mockResolvedValue(50),
      countRecentSessions: vi.fn().mockResolvedValue(7),
      countDistinctEventDays: vi.fn().mockResolvedValue(5),
    });

    const cfg: LifecycleConfig = {
      ahaMomentRules: [{ name: "logging", description: "", eventName: "log_created", threshold: 3, windowDays: 14 }],
    };

    const svc = new LifecycleService(cfg, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    expect(es.aha_reached).toBe(true);
    expect(es.score).toBeGreaterThanOrEqual(40);
    expect(es.stage).toBe("engaged");
  });

  it("churned user: inactive for 30+ days", async () => {
    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(90),
        lastActiveAt: daysAgo(35),
      }),
      countSessions: vi.fn().mockResolvedValue(20),
      countRecentSessions: vi.fn().mockResolvedValue(0),
    });

    const svc = new LifecycleService({}, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    expect(es.stage).toBe("churned");
    expect(es.days_since_active).toBeGreaterThanOrEqual(30);
  });

  it("loyal user: pro + high engagement score", async () => {
    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(60),
        lastActiveAt: daysAgo(0),
      }),
      countSessions: vi.fn().mockResolvedValue(100),
      countRecentSessions: vi.fn().mockResolvedValue(7),
      countDistinctEventDays: vi.fn().mockResolvedValue(10),
      isProUser: vi.fn().mockResolvedValue(true),
    });

    const cfg: LifecycleConfig = {
      ahaMomentRules: [{ name: "logging", description: "", eventName: "log_created", threshold: 3, windowDays: 14 }],
    };

    const svc = new LifecycleService(cfg, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    expect(es.is_pro).toBe(true);
    expect(es.score).toBeGreaterThanOrEqual(60);
    expect(es.stage).toBe("loyal");
  });

  it("at_risk user: inactive 7-13 days", async () => {
    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(60),
        lastActiveAt: daysAgo(10),
      }),
      countSessions: vi.fn().mockResolvedValue(15),
      countRecentSessions: vi.fn().mockResolvedValue(0),
    });

    const svc = new LifecycleService({}, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    expect(es.stage).toBe("at_risk");
  });

  it("dormant user: inactive 14-29 days", async () => {
    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(90),
        lastActiveAt: daysAgo(20),
      }),
      countSessions: vi.fn().mockResolvedValue(10),
      countRecentSessions: vi.fn().mockResolvedValue(0),
    });

    const svc = new LifecycleService({}, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    expect(es.stage).toBe("dormant");
  });

  it("monetized user: pro but lower engagement", async () => {
    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(30),
        lastActiveAt: daysAgo(1),
      }),
      countSessions: vi.fn().mockResolvedValue(10),
      countRecentSessions: vi.fn().mockResolvedValue(3),
      isProUser: vi.fn().mockResolvedValue(true),
    });

    const svc = new LifecycleService({}, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    expect(es.is_pro).toBe(true);
    // score = 18 (sessions) + 20 (pro) + 5 (daysSinceActive=1) + 3 (totalSessions/3) = 46
    // since pro and score < 60, should be "monetized"
    expect(es.stage).toBe("monetized");
  });
});
