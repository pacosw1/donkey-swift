import { describe, it, expect, vi } from "vitest";
import { LifecycleService, type LifecycleDB, type LifecycleConfig, type StageRule, type StageContext } from "../lifecycle/index.js";
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

// ── determinePrompt with maxPromptsPerType ──────────────────────────────────

describe("LifecycleService.determinePrompt", () => {
  it("respects maxPromptsPerType and returns null when limit reached", async () => {
    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(60),
        lastActiveAt: daysAgo(10),
      }),
      countSessions: vi.fn().mockResolvedValue(15),
      countRecentSessions: vi.fn().mockResolvedValue(0),
      // Simulate that 2 winback prompts have been sent in 30 days
      countPrompts: vi.fn().mockResolvedValue(2),
      lastPrompt: vi.fn().mockResolvedValue(null), // no cooldown issue
    });

    const cfg: LifecycleConfig = {
      maxPromptsPerType: { review: 3, paywall: 3, winback: 2, milestone: 1 },
    };

    const svc = new LifecycleService(cfg, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    // at_risk stage would normally produce a winback prompt,
    // but max winback prompts (2) has been reached
    expect(es.stage).toBe("at_risk");
    expect(es.prompt).toBeNull();
  });

  it("returns prompt when under the maxPromptsPerType limit", async () => {
    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(60),
        lastActiveAt: daysAgo(10),
      }),
      countSessions: vi.fn().mockResolvedValue(15),
      countRecentSessions: vi.fn().mockResolvedValue(0),
      // Only 1 winback prompt sent — under the limit of 2
      countPrompts: vi.fn().mockResolvedValue(1),
      lastPrompt: vi.fn().mockResolvedValue(null),
    });

    const cfg: LifecycleConfig = {
      maxPromptsPerType: { review: 3, paywall: 3, winback: 2, milestone: 1 },
    };

    const svc = new LifecycleService(cfg, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    expect(es.stage).toBe("at_risk");
    expect(es.prompt).not.toBeNull();
    expect(es.prompt!.type).toBe("winback");
  });
});

// ── calculateScore with configurable weights ────────────────────────────────

describe("LifecycleService.calculateScore with custom weights", () => {
  it("uses configurable weights for scoring", () => {
    const cfg: LifecycleConfig = {
      scoreWeights: {
        recentSessionsMax: 30,
        recentSessionsPerSession: 10,
        ahaBonus: 15,
        proBonus: 25,
        activeTodayBonus: 5,
        activeRecentBonus: 3,
        totalSessionsMax: 5,
        totalSessionsDivisor: 5,
      },
    };

    const svc = new LifecycleService(cfg, mockDB(), mockPush());

    // recentSessions=3 => min(3*10, 30) = 30
    // ahaReached=true => +15
    // isPro=false => +0
    // daysSinceActive=0 => +5 (activeTodayBonus)
    // totalSessions=20 => min(floor(20/5), 5) = 4
    // total = 30 + 15 + 5 + 4 = 54
    const score = svc.calculateScore(3, true, false, 0, 20);
    expect(score).toBe(54);
  });

  it("uses default weights when none provided", () => {
    const svc = new LifecycleService({}, mockDB(), mockPush());

    // recentSessions=5 => min(5*6, 40) = 30
    // ahaReached=false => +0
    // isPro=true => +20
    // daysSinceActive=1 => +5 (activeRecentBonus)
    // totalSessions=9 => min(floor(9/3), 10) = 3
    // total = 30 + 20 + 5 + 3 = 58
    const score = svc.calculateScore(5, false, true, 1, 9);
    expect(score).toBe(58);
  });
});

// ── StageRule.matches receives StageContext ──────────────────────────────────

describe("LifecycleService custom stage rules", () => {
  it("StageRule.matches receives StageContext object", async () => {
    const matchesFn = vi.fn().mockReturnValue(true);
    const customRule: StageRule = {
      name: "vip",
      stage: "loyal",
      matches: matchesFn,
    };

    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(45),
        lastActiveAt: daysAgo(0),
      }),
      countSessions: vi.fn().mockResolvedValue(80),
      countRecentSessions: vi.fn().mockResolvedValue(5),
      isProUser: vi.fn().mockResolvedValue(true),
    });

    const cfg: LifecycleConfig = {
      customStages: [customRule],
      ahaMomentRules: [{ name: "logging", description: "", eventName: "log_created", threshold: 3, windowDays: 14 }],
    };

    const svc = new LifecycleService(cfg, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    // Custom rule matched, so stage should be "loyal"
    expect(es.stage).toBe("loyal");

    // Verify that matches was called with a StageContext object
    expect(matchesFn).toHaveBeenCalledTimes(1);
    const ctx: StageContext = matchesFn.mock.calls[0][0];
    expect(typeof ctx.score).toBe("number");
    expect(typeof ctx.daysSinceActive).toBe("number");
    expect(typeof ctx.createdDaysAgo).toBe("number");
    expect(typeof ctx.ahaReached).toBe("boolean");
    expect(typeof ctx.isPro).toBe("boolean");
    expect(ctx.daysSinceActive).toBe(0);
    expect(ctx.isPro).toBe(true);
  });

  it("falls through custom rules when none match", async () => {
    const customRule: StageRule = {
      name: "never_matches",
      stage: "loyal",
      matches: () => false,
    };

    const db = mockDB({
      userCreatedAndLastActive: vi.fn().mockResolvedValue({
        createdAt: daysAgo(2),
        lastActiveAt: daysAgo(0),
      }),
      countSessions: vi.fn().mockResolvedValue(3),
      countRecentSessions: vi.fn().mockResolvedValue(2),
    });

    const cfg: LifecycleConfig = { customStages: [customRule] };
    const svc = new LifecycleService(cfg, db, mockPush());
    const es = await svc.evaluateUser("user-1");

    // Falls through to default stage determination
    expect(es.stage).toBe("new");
  });
});
