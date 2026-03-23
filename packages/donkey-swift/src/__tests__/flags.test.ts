import { describe, it, expect, vi } from "vitest";
import { FlagsService, type FlagsDB, type Flag } from "../flags/index.js";

function mockDB(overrides: Partial<FlagsDB> = {}): FlagsDB {
  return {
    upsertFlag: vi.fn(),
    getFlag: vi.fn().mockResolvedValue(null),
    listFlags: vi.fn().mockResolvedValue([]),
    deleteFlag: vi.fn(),
    getUserOverride: vi.fn().mockResolvedValue(null),
    setUserOverride: vi.fn(),
    deleteUserOverride: vi.fn(),
    ...overrides,
  };
}

function makeFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    key: "test_flag",
    enabled: true,
    rollout_pct: 100,
    description: "",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("FlagsService.isEnabled", () => {
  it("returns false when flag is not found", async () => {
    const db = mockDB();
    const svc = new FlagsService(db);
    expect(await svc.isEnabled("missing_flag", "user-1")).toBe(false);
  });

  it("returns false when flag is disabled", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({ enabled: false })),
    });
    const svc = new FlagsService(db);
    expect(await svc.isEnabled("test_flag", "user-1")).toBe(false);
  });

  it("returns true when rollout is 100%", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({ rollout_pct: 100 })),
    });
    const svc = new FlagsService(db);
    expect(await svc.isEnabled("test_flag", "user-1")).toBe(true);
  });

  it("returns false when rollout is 0%", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({ rollout_pct: 0 })),
    });
    const svc = new FlagsService(db);
    expect(await svc.isEnabled("test_flag", "user-1")).toBe(false);
  });

  it("CRC32 rollout is deterministic for same key+user", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({ rollout_pct: 50 })),
    });
    const svc = new FlagsService(db);
    const result1 = await svc.isEnabled("my_flag", "user-42");
    const result2 = await svc.isEnabled("my_flag", "user-42");
    expect(result1).toBe(result2);
  });

  it("user override takes priority over rollout", async () => {
    const db = mockDB({
      getUserOverride: vi.fn().mockResolvedValue(true),
      getFlag: vi.fn().mockResolvedValue(makeFlag({ enabled: false, rollout_pct: 0 })),
    });
    const svc = new FlagsService(db);
    expect(await svc.isEnabled("test_flag", "user-1")).toBe(true);
    // getFlag should NOT be called since override takes priority
    expect(db.getFlag).not.toHaveBeenCalled();
  });

  it("user override false disables even if flag is 100%", async () => {
    const db = mockDB({
      getUserOverride: vi.fn().mockResolvedValue(false),
      getFlag: vi.fn().mockResolvedValue(makeFlag({ rollout_pct: 100 })),
    });
    const svc = new FlagsService(db);
    expect(await svc.isEnabled("test_flag", "user-1")).toBe(false);
  });

  it("different users get different rollout results at 50%", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({ rollout_pct: 50 })),
    });
    const svc = new FlagsService(db);

    // With enough users, we should see both true and false
    const results = new Set<boolean>();
    for (let i = 0; i < 100; i++) {
      results.add(await svc.isEnabled("feature_x", `user-${i}`));
    }
    expect(results.has(true)).toBe(true);
    expect(results.has(false)).toBe(true);
  });
});
