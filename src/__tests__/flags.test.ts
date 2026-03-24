import { describe, it, expect, vi } from "vitest";
import { FlagsService, type FlagsDB, type Flag } from "../flags/index.js";
import { ValidationError, NotFoundError, ServiceError } from "../errors/index.js";

function mockDB(overrides: Partial<FlagsDB> = {}): FlagsDB {
  return {
    upsertFlag: vi.fn().mockResolvedValue(undefined),
    getFlag: vi.fn().mockResolvedValue(null),
    listFlags: vi.fn().mockResolvedValue([]),
    deleteFlag: vi.fn().mockResolvedValue(undefined),
    getUserOverride: vi.fn().mockResolvedValue(null),
    setUserOverride: vi.fn().mockResolvedValue(undefined),
    deleteUserOverride: vi.fn().mockResolvedValue(undefined),
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

// ── Admin method tests ──────────────────────────────────────────────────────

describe("FlagsService admin methods", () => {
  describe("createFlag", () => {
    it("rejects missing key", async () => {
      const svc = new FlagsService(mockDB());
      await expect(svc.createFlag({})).rejects.toThrow(ValidationError);
      await expect(svc.createFlag({})).rejects.toThrow(/key/i);
    });

    it("rejects rollout_pct > 100", async () => {
      const svc = new FlagsService(mockDB());
      await expect(
        svc.createFlag({ key: "flag_over", rollout_pct: 101 })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.createFlag({ key: "flag_over", rollout_pct: 101 })
      ).rejects.toThrow(/rollout_pct/);
    });

    it("rejects rollout_pct < 0", async () => {
      const svc = new FlagsService(mockDB());
      await expect(
        svc.createFlag({ key: "flag_neg", rollout_pct: -5 })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.createFlag({ key: "flag_neg", rollout_pct: -5 })
      ).rejects.toThrow(/rollout_pct/);
    });

    it("creates a flag successfully", async () => {
      const db = mockDB();
      const svc = new FlagsService(db);
      const flag = await svc.createFlag({ key: "new_flag", enabled: true, rollout_pct: 50 });
      expect(flag.key).toBe("new_flag");
      expect(flag.enabled).toBe(true);
      expect(flag.rollout_pct).toBe(50);
      expect(db.upsertFlag).toHaveBeenCalled();
    });

    it("throws ServiceError when DB fails", async () => {
      const db = mockDB({
        upsertFlag: vi.fn().mockRejectedValue(new Error("db down")),
      });
      const svc = new FlagsService(db);
      await expect(
        svc.createFlag({ key: "fail_flag" })
      ).rejects.toThrow(ServiceError);
    });
  });

  describe("updateFlag", () => {
    it("rejects missing key", async () => {
      const svc = new FlagsService(mockDB());
      await expect(svc.updateFlag("", { enabled: false })).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError for non-existent flag", async () => {
      const db = mockDB({ getFlag: vi.fn().mockResolvedValue(null) });
      const svc = new FlagsService(db);
      await expect(
        svc.updateFlag("nonexistent", { enabled: false })
      ).rejects.toThrow(NotFoundError);
      await expect(
        svc.updateFlag("nonexistent", { enabled: false })
      ).rejects.toThrow(/flag not found/);
    });

    it("rejects rollout_pct < 0", async () => {
      const db = mockDB({
        getFlag: vi.fn().mockResolvedValue(makeFlag()),
      });
      const svc = new FlagsService(db);
      await expect(
        svc.updateFlag("test_flag", { rollout_pct: -1 })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.updateFlag("test_flag", { rollout_pct: -1 })
      ).rejects.toThrow(/rollout_pct/);
    });

    it("rejects rollout_pct > 100", async () => {
      const db = mockDB({
        getFlag: vi.fn().mockResolvedValue(makeFlag()),
      });
      const svc = new FlagsService(db);
      await expect(
        svc.updateFlag("test_flag", { rollout_pct: 150 })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.updateFlag("test_flag", { rollout_pct: 150 })
      ).rejects.toThrow(/rollout_pct/);
    });

    it("updates a flag successfully", async () => {
      const db = mockDB({
        getFlag: vi.fn().mockResolvedValue(makeFlag({ rollout_pct: 50 })),
      });
      const svc = new FlagsService(db);
      const flag = await svc.updateFlag("test_flag", { rollout_pct: 75, description: "updated" });
      expect(flag.rollout_pct).toBe(75);
      expect(flag.description).toBe("updated");
      expect(db.upsertFlag).toHaveBeenCalled();
    });
  });

  describe("deleteFlag", () => {
    it("rejects missing key", async () => {
      const svc = new FlagsService(mockDB());
      await expect(svc.deleteFlag("")).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError for non-existent flag", async () => {
      const db = mockDB({ getFlag: vi.fn().mockResolvedValue(null) });
      const svc = new FlagsService(db);
      await expect(svc.deleteFlag("nonexistent")).rejects.toThrow(NotFoundError);
      await expect(svc.deleteFlag("nonexistent")).rejects.toThrow(/flag not found/);
    });

    it("deletes a flag successfully", async () => {
      const db = mockDB({
        getFlag: vi.fn().mockResolvedValue(makeFlag()),
      });
      const svc = new FlagsService(db);
      const result = await svc.deleteFlag("test_flag");
      expect(result.status).toBe("deleted");
      expect(db.deleteFlag).toHaveBeenCalledWith("test_flag");
    });
  });

  describe("setOverride", () => {
    it("requires flag key", async () => {
      const svc = new FlagsService(mockDB());
      await expect(
        svc.setOverride("", "user-1", true)
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.setOverride("", "user-1", true)
      ).rejects.toThrow(/flag key/i);
    });

    it("requires user_id", async () => {
      const svc = new FlagsService(mockDB());
      await expect(
        svc.setOverride("test_flag", "", true)
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.setOverride("test_flag", "", true)
      ).rejects.toThrow(/user_id/i);
    });

    it("sets override successfully", async () => {
      const db = mockDB();
      const svc = new FlagsService(db);
      await svc.setOverride("test_flag", "user-1", true);
      expect(db.setUserOverride).toHaveBeenCalledWith("test_flag", "user-1", true);
    });

    it("throws ServiceError when DB fails", async () => {
      const db = mockDB({
        setUserOverride: vi.fn().mockRejectedValue(new Error("db down")),
      });
      const svc = new FlagsService(db);
      await expect(
        svc.setOverride("test_flag", "user-1", true)
      ).rejects.toThrow(ServiceError);
    });
  });

  describe("deleteOverride", () => {
    it("requires key and user_id", async () => {
      const svc = new FlagsService(mockDB());
      await expect(
        svc.deleteOverride("", "user-1")
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.deleteOverride("test_flag", "")
      ).rejects.toThrow(ValidationError);
    });

    it("deletes override successfully", async () => {
      const deleteOverride = vi.fn().mockResolvedValue(undefined);
      const db = mockDB({ deleteUserOverride: deleteOverride });
      const svc = new FlagsService(db);
      await svc.deleteOverride("my_flag", "user-1");
      expect(deleteOverride).toHaveBeenCalledWith("my_flag", "user-1");
    });
  });
});

// ── check and batchCheck ────────────────────────────────────────────────────

describe("FlagsService.check", () => {
  it("rejects empty key", async () => {
    const svc = new FlagsService(mockDB());
    await expect(svc.check("user-1", "")).rejects.toThrow(ValidationError);
  });

  it("returns enabled status and value for a flag", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({ value: "hello", rollout_pct: 100 })),
    });
    const svc = new FlagsService(db);
    const result = await svc.check("user-1", "test_flag");
    expect(result.key).toBe("test_flag");
    expect(result.enabled).toBe(true);
    expect(result.value).toBe("hello");
  });
});

describe("FlagsService.batchCheck", () => {
  it("rejects empty keys array", async () => {
    const svc = new FlagsService(mockDB());
    await expect(svc.batchCheck("user-1", [])).rejects.toThrow(ValidationError);
  });

  it("rejects > 100 keys", async () => {
    const svc = new FlagsService(mockDB());
    const keys = Array.from({ length: 101 }, (_, i) => `flag_${i}`);
    await expect(svc.batchCheck("user-1", keys)).rejects.toThrow(ValidationError);
    await expect(svc.batchCheck("user-1", keys)).rejects.toThrow(/100/);
  });

  it("returns flags map", async () => {
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(makeFlag({ rollout_pct: 100 })),
    });
    const svc = new FlagsService(db);
    const result = await svc.batchCheck("user-1", ["flag_a", "flag_b"]);
    expect(result.flags).toBeDefined();
    expect(typeof result.flags.flag_a).toBe("boolean");
    expect(typeof result.flags.flag_b).toBe("boolean");
  });
});

describe("FlagsService.listFlags", () => {
  it("returns empty array when no flags exist", async () => {
    const svc = new FlagsService(mockDB());
    const result = await svc.listFlags();
    expect(result.flags).toEqual([]);
  });

  it("returns all flags", async () => {
    const flags = [makeFlag({ key: "a" }), makeFlag({ key: "b" })];
    const db = mockDB({ listFlags: vi.fn().mockResolvedValue(flags) });
    const svc = new FlagsService(db);
    const result = await svc.listFlags();
    expect(result.flags).toHaveLength(2);
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
