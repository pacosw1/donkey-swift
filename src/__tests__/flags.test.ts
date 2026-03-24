import { describe, it, expect, vi } from "vitest";
import { FlagsService, type FlagsDB, type Flag } from "../flags/index.js";
import { ValidationError, NotFoundError } from "../errors/index.js";

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

// ── Admin method tests ─────────────────────────────────────────────────────

describe("FlagsService admin methods", () => {
  describe("createFlag", () => {
    it("rejects rollout_pct > 100", async () => {
      const svc = new FlagsService(mockDB());
      await expect(svc.createFlag({ key: "flag_over", rollout_pct: 101 }))
        .rejects.toThrow(ValidationError);
    });

    it("rejects rollout_pct < 0", async () => {
      const svc = new FlagsService(mockDB());
      await expect(svc.createFlag({ key: "flag_neg", rollout_pct: -5 }))
        .rejects.toThrow(ValidationError);
    });
  });

  describe("updateFlag", () => {
    it("rejects rollout_pct < 0", async () => {
      const db = mockDB({
        getFlag: vi.fn().mockResolvedValue(makeFlag()),
      });
      const svc = new FlagsService(db);
      await expect(svc.updateFlag("test_flag", { rollout_pct: -1 }))
        .rejects.toThrow(ValidationError);
    });

    it("rejects rollout_pct > 100", async () => {
      const db = mockDB({
        getFlag: vi.fn().mockResolvedValue(makeFlag()),
      });
      const svc = new FlagsService(db);
      await expect(svc.updateFlag("test_flag", { rollout_pct: 150 }))
        .rejects.toThrow(ValidationError);
    });
  });

  describe("deleteFlag", () => {
    it("throws NotFoundError for non-existent flag", async () => {
      const db = mockDB({
        getFlag: vi.fn().mockResolvedValue(null),
      });
      const svc = new FlagsService(db);
      await expect(svc.deleteFlag("nonexistent"))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe("setOverride", () => {
    it("requires user_id", async () => {
      const svc = new FlagsService(mockDB());
      await expect(svc.setOverride("test_flag", "", true))
        .rejects.toThrow(ValidationError);
    });
  });

  describe("deleteOverride", () => {
    it("deletes override successfully", async () => {
      const deleteOverride = vi.fn().mockResolvedValue(undefined);
      const db = mockDB({ deleteUserOverride: deleteOverride });
      const svc = new FlagsService(db);

      await svc.deleteOverride("my_flag", "user-1");
      expect(deleteOverride).toHaveBeenCalledWith("my_flag", "user-1");
    });
  });
});

// ── getValue typed values ───────────────────────────────────────────────────

describe("FlagsService.getValue", () => {
  it("returns string value", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({
        value: "hello world",
        value_type: "string",
        rollout_pct: 100,
      })),
    });
    const svc = new FlagsService(db);
    const val = await svc.getValue("str_flag", "user-1");
    expect(val).toBe("hello world");
  });

  it("returns number value", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({
        value: "42",
        value_type: "number",
        rollout_pct: 100,
      })),
    });
    const svc = new FlagsService(db);
    const val = await svc.getValue("num_flag", "user-1");
    expect(val).toBe(42);
  });

  it("returns parsed JSON value", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({
        value: '{"color":"red","size":10}',
        value_type: "json",
        rollout_pct: 100,
      })),
    });
    const svc = new FlagsService(db);
    const val = await svc.getValue("json_flag", "user-1");
    expect(val).toEqual({ color: "red", size: 10 });
  });

  it("returns null when flag is disabled", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({
        enabled: false,
        value: "hello",
        value_type: "string",
      })),
    });
    const svc = new FlagsService(db);
    const val = await svc.getValue("disabled_flag", "user-1");
    expect(val).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({
        value: "not-valid-json{",
        value_type: "json",
        rollout_pct: 100,
      })),
    });
    const svc = new FlagsService(db);
    const val = await svc.getValue("bad_json_flag", "user-1");
    expect(val).toBeNull();
  });
});

// ── Cache behavior ──────────────────────────────────────────────────────────

describe("FlagsService cache", () => {
  it("second isEnabled call does not hit DB when cache is warm", async () => {
    const getFlag = vi.fn().mockResolvedValue(makeFlag({ rollout_pct: 100 }));
    const db = mockDB({ getFlag });
    const svc = new FlagsService(db, { cacheTtlMs: 30000 });

    // First call populates cache
    const result1 = await svc.isEnabled("cached_flag", "user-1");
    expect(result1).toBe(true);
    expect(getFlag).toHaveBeenCalledTimes(1);

    // Second call should use cache
    const result2 = await svc.isEnabled("cached_flag", "user-1");
    expect(result2).toBe(true);
    expect(getFlag).toHaveBeenCalledTimes(1); // still 1 — cache hit
  });

  it("cache miss after invalidation", async () => {
    const getFlag = vi.fn().mockResolvedValue(makeFlag({ rollout_pct: 100 }));
    const db = mockDB({ getFlag });
    const svc = new FlagsService(db, { cacheTtlMs: 30000 });

    await svc.isEnabled("cached_flag", "user-1");
    expect(getFlag).toHaveBeenCalledTimes(1);

    svc.invalidate("cached_flag");

    await svc.isEnabled("cached_flag", "user-1");
    expect(getFlag).toHaveBeenCalledTimes(2); // cache was invalidated
  });

  it("no caching when cacheTtlMs is 0 (default)", async () => {
    const getFlag = vi.fn().mockResolvedValue(makeFlag({ rollout_pct: 100 }));
    const db = mockDB({ getFlag });
    const svc = new FlagsService(db); // no config = no cache

    await svc.isEnabled("flag", "user-1");
    await svc.isEnabled("flag", "user-1");
    expect(getFlag).toHaveBeenCalledTimes(2); // no caching
  });
});
