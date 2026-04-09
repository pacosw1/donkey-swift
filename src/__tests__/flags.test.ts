import { describe, it, expect, vi } from "vitest";
import {
  FlagsService,
  evaluateFlag,
  resolveAttr,
  type FlagsDB,
  type Flag,
  type FlagContext,
  type FlagRule,
  type Variant,
} from "../flags/index.js";
import { parseSemver, compareSemver, semverGte, semverLt } from "../flags/semver.js";
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

// ═════════════════════════════════════════════════════════════════════════
// v2 targeting engine tests
// ═════════════════════════════════════════════════════════════════════════

// ── semver helper ───────────────────────────────────────────────────────────

describe("semver helper", () => {
  it("parses plain semver strings", () => {
    expect(parseSemver("1.4.2")).toEqual([1, 4, 2]);
    expect(parseSemver("2")).toEqual([2, 0, 0]);
    expect(parseSemver("1.4")).toEqual([1, 4, 0]);
  });

  it("tolerates leading v and pre-release tags", () => {
    expect(parseSemver("v1.4.2")).toEqual([1, 4, 2]);
    expect(parseSemver("1.4.2-beta.3")).toEqual([1, 4, 2]);
    expect(parseSemver("1.4.2+build.5")).toEqual([1, 4, 2]);
  });

  it("returns null for invalid input", () => {
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("nope")).toBeNull();
    expect(parseSemver("-1.0.0")).toBeNull();
  });

  it("compareSemver orders triples correctly", () => {
    expect(compareSemver([1, 4, 2], [1, 4, 2])).toBe(0);
    expect(compareSemver([1, 4, 2], [1, 4, 3])).toBe(-1);
    expect(compareSemver([2, 0, 0], [1, 9, 9])).toBe(1);
  });

  it("semverGte / semverLt cover boundary cases", () => {
    expect(semverGte("1.4.2", "1.4.0")).toBe(true);
    expect(semverGte("1.4.0", "1.4.0")).toBe(true);
    expect(semverGte("1.3.9", "1.4.0")).toBe(false);
    expect(semverLt("1.3.9", "1.4.0")).toBe(true);
    expect(semverLt("1.4.0", "1.4.0")).toBe(false);
    // Unparseable input → false on both sides (not a throw)
    expect(semverGte("garbage", "1.0.0")).toBe(false);
    expect(semverLt("garbage", "1.0.0")).toBe(false);
  });
});

// ── resolveAttr ─────────────────────────────────────────────────────────────

describe("resolveAttr", () => {
  const ctx: FlagContext = {
    userId: "u1",
    appVersion: "1.4.2",
    platform: "ios",
    locale: "en-US",
    country: "US",
    isPro: true,
    email: "u1@example.com",
    deviceModel: "iPhone15,3",
    osVersion: "17.4",
    custom: { cohort: "early_access", step: 3 },
  };

  it("maps known dotted paths onto context fields", () => {
    expect(resolveAttr(ctx, "user.id")).toBe("u1");
    expect(resolveAttr(ctx, "user.email")).toBe("u1@example.com");
    expect(resolveAttr(ctx, "user.isPro")).toBe(true);
    expect(resolveAttr(ctx, "app.version")).toBe("1.4.2");
    expect(resolveAttr(ctx, "app.platform")).toBe("ios");
    expect(resolveAttr(ctx, "app.locale")).toBe("en-US");
    expect(resolveAttr(ctx, "app.country")).toBe("US");
    expect(resolveAttr(ctx, "device.model")).toBe("iPhone15,3");
    expect(resolveAttr(ctx, "device.osVersion")).toBe("17.4");
  });

  it("resolves custom.* from the custom bag", () => {
    expect(resolveAttr(ctx, "custom.cohort")).toBe("early_access");
    expect(resolveAttr(ctx, "custom.step")).toBe(3);
  });

  it("returns undefined for unknown paths and missing fields", () => {
    expect(resolveAttr(ctx, "unknown.path")).toBeUndefined();
    expect(resolveAttr(ctx, "custom.missing")).toBeUndefined();
    expect(resolveAttr({ userId: "u1" }, "app.version")).toBeUndefined();
  });
});

// ── evaluateFlag: condition ops ─────────────────────────────────────────────

describe("evaluateFlag conditions", () => {
  const base = (rules: FlagRule[], defaultValue: unknown = false): Flag => ({
    key: "t",
    enabled: true,
    rollout_pct: 0, // opt out of legacy fallback — force v2 path
    description: "",
    default_value: defaultValue as Flag["default_value"],
    rules,
    created_at: new Date(),
    updated_at: new Date(),
  });

  it("eq / neq against string attrs", () => {
    const flag = base([
      { id: "r1", condition: { op: "eq", attr: "app.platform", value: "ios" }, serve: { kind: "value", value: true } },
    ]);
    expect(evaluateFlag(flag, { userId: "u", platform: "ios" }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "u", platform: "android" }).value).toBe(false);
    expect(evaluateFlag(flag, { userId: "u" }).value).toBe(false); // missing attr → no match
  });

  it("in / nin against a value list", () => {
    const flag = base([
      { id: "r1", condition: { op: "in", attr: "app.country", values: ["US", "CA", "MX"] }, serve: { kind: "value", value: true } },
    ]);
    expect(evaluateFlag(flag, { userId: "u", country: "US" }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "u", country: "DE" }).value).toBe(false);
  });

  it("semver_gte / semver_lt on app.version", () => {
    const flag = base([
      { id: "r1", condition: { op: "semver_gte", attr: "app.version", value: "1.4.0" }, serve: { kind: "value", value: true } },
    ]);
    expect(evaluateFlag(flag, { userId: "u", appVersion: "1.4.2" }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "u", appVersion: "1.3.9" }).value).toBe(false);
    expect(evaluateFlag(flag, { userId: "u" }).value).toBe(false); // missing → no match
  });

  it("nested AND: platform ios AND version >= 1.4", () => {
    const flag = base([
      {
        id: "r1",
        condition: {
          op: "and",
          children: [
            { op: "eq", attr: "app.platform", value: "ios" },
            { op: "semver_gte", attr: "app.version", value: "1.4.0" },
          ],
        },
        serve: { kind: "value", value: true },
      },
    ]);
    expect(evaluateFlag(flag, { userId: "u", platform: "ios", appVersion: "1.4.2" }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "u", platform: "ios", appVersion: "1.3.9" }).value).toBe(false);
    expect(evaluateFlag(flag, { userId: "u", platform: "android", appVersion: "1.4.2" }).value).toBe(false);
  });

  it("nested OR + NOT: (pro OR early_access) AND NOT android", () => {
    const flag = base([
      {
        id: "r1",
        condition: {
          op: "and",
          children: [
            {
              op: "or",
              children: [
                { op: "eq", attr: "user.isPro", value: true },
                { op: "eq", attr: "custom.cohort", value: "early_access" },
              ],
            },
            { op: "not", child: { op: "eq", attr: "app.platform", value: "android" } },
          ],
        },
        serve: { kind: "value", value: true },
      },
    ]);
    expect(evaluateFlag(flag, { userId: "u", isPro: true, platform: "ios" }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "u", custom: { cohort: "early_access" }, platform: "web" }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "u", isPro: true, platform: "android" }).value).toBe(false);
    expect(evaluateFlag(flag, { userId: "u", platform: "ios" }).value).toBe(false);
  });

  it("first matching rule wins — ordering matters", () => {
    const flag = base([
      { id: "r-ios", condition: { op: "eq", attr: "app.platform", value: "ios" }, serve: { kind: "value", value: "ios-branch" } },
      { id: "r-all", condition: { op: "percentage", pct: 100 }, serve: { kind: "value", value: "catch-all" } },
    ]);
    const ios = evaluateFlag(flag, { userId: "u", platform: "ios" });
    expect(ios.value).toBe("ios-branch");
    expect(ios.ruleId).toBe("r-ios");

    const web = evaluateFlag(flag, { userId: "u", platform: "web" });
    expect(web.value).toBe("catch-all");
    expect(web.ruleId).toBe("r-all");
  });

  it("serves default_value when no rule matches", () => {
    const flag = base([
      { id: "r1", condition: { op: "eq", attr: "app.platform", value: "ios" }, serve: { kind: "value", value: "yes" } },
    ], "fallback");
    const res = evaluateFlag(flag, { userId: "u", platform: "web" });
    expect(res.value).toBe("fallback");
    expect(res.matched).toBe(false);
    expect(res.ruleId).toBeUndefined();
  });

  it("disabled flag short-circuits to default_value", () => {
    const flag = base([
      { id: "r1", condition: { op: "percentage", pct: 100 }, serve: { kind: "value", value: "on" } },
    ], "off");
    flag.enabled = false;
    const res = evaluateFlag(flag, { userId: "u" });
    expect(res.value).toBe("off");
    expect(res.matched).toBe(false);
  });
});

// ── evaluateFlag: percentage determinism ───────────────────────────────────

describe("evaluateFlag percentage rollout", () => {
  const pctFlag = (pct: number): Flag => ({
    key: "p",
    enabled: true,
    rollout_pct: 0,
    description: "",
    default_value: false,
    rules: [
      { id: "r1", condition: { op: "percentage", pct }, serve: { kind: "value", value: true } },
    ],
    created_at: new Date(),
    updated_at: new Date(),
  });

  it("0% never matches, 100% always matches", () => {
    expect(evaluateFlag(pctFlag(0), { userId: "u-1" }).value).toBe(false);
    expect(evaluateFlag(pctFlag(100), { userId: "u-1" }).value).toBe(true);
  });

  it("same user always lands in the same bucket", () => {
    const flag = pctFlag(30);
    const first = evaluateFlag(flag, { userId: "user-abc" }).value;
    for (let i = 0; i < 20; i++) {
      expect(evaluateFlag(flag, { userId: "user-abc" }).value).toBe(first);
    }
  });

  it("rolls ~30% of users at pct=30 (N=5000, ±3%)", () => {
    const flag = pctFlag(30);
    let on = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      if (evaluateFlag(flag, { userId: `u-${i}` }).value === true) on++;
    }
    const rate = on / N;
    expect(rate).toBeGreaterThan(0.27);
    expect(rate).toBeLessThan(0.33);
  });

  it("supports fractional percent (0.5% = 50 buckets out of 10_000)", () => {
    const flag = pctFlag(0.5);
    let on = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      if (evaluateFlag(flag, { userId: `u-${i}` }).value === true) on++;
    }
    const rate = on / N;
    expect(rate).toBeGreaterThan(0.002);
    expect(rate).toBeLessThan(0.008);
  });
});

// ── evaluateFlag: variants (A/B testing) ──────────────────────────────────

describe("evaluateFlag variants / A-B testing", () => {
  const abFlag = (variants: Variant[]): Flag => ({
    key: "ab",
    enabled: true,
    rollout_pct: 0,
    description: "",
    default_value: "control",
    rules: [
      {
        id: "split",
        condition: { op: "percentage", pct: 100 },
        serve: { kind: "variants", variants },
      },
    ],
    created_at: new Date(),
    updated_at: new Date(),
  });

  it("50/50 weighted split lands in both buckets deterministically", () => {
    const flag = abFlag([
      { key: "A", value: "headline-A", weight: 50 },
      { key: "B", value: "headline-B", weight: 50 },
    ]);
    const buckets = new Map<string, number>();
    for (let i = 0; i < 10_000; i++) {
      const res = evaluateFlag(flag, { userId: `u-${i}` });
      buckets.set(res.variantKey!, (buckets.get(res.variantKey!) ?? 0) + 1);
    }
    const a = buckets.get("A") ?? 0;
    const b = buckets.get("B") ?? 0;
    expect(a + b).toBe(10_000);
    expect(Math.abs(a - b)).toBeLessThan(400); // ±2% tolerance
  });

  it("same user always gets the same variant across calls", () => {
    const flag = abFlag([
      { key: "A", value: "a", weight: 50 },
      { key: "B", value: "b", weight: 50 },
    ]);
    const first = evaluateFlag(flag, { userId: "alice" }).variantKey;
    for (let i = 0; i < 20; i++) {
      expect(evaluateFlag(flag, { userId: "alice" }).variantKey).toBe(first);
    }
  });

  it("uneven weights respect the distribution (80/20)", () => {
    const flag = abFlag([
      { key: "big", value: 1, weight: 80 },
      { key: "small", value: 2, weight: 20 },
    ]);
    let big = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      if (evaluateFlag(flag, { userId: `u-${i}` }).variantKey === "big") big++;
    }
    const rate = big / N;
    expect(rate).toBeGreaterThan(0.77);
    expect(rate).toBeLessThan(0.83);
  });

  it("ruleId and variantKey are surfaced in the result", () => {
    const flag = abFlag([
      { key: "A", value: "a", weight: 1 },
      { key: "B", value: "b", weight: 1 },
    ]);
    const res = evaluateFlag(flag, { userId: "u" });
    expect(res.ruleId).toBe("split");
    expect(res.variantKey).toBeDefined();
    expect(res.matched).toBe(true);
  });
});

// ── Original feature-request scenarios ─────────────────────────────────
// Each `it` here maps 1:1 to something the user asked for in the initial
// feature-flags v2 request. Keeping them grouped makes the coverage legible
// against the original prompt.

describe("v2 scenarios from the original feature request", () => {
  const base = (rules: FlagRule[], defaultValue: unknown = false): Flag => ({
    key: "t",
    enabled: true,
    rollout_pct: 0,
    description: "",
    default_value: defaultValue as Flag["default_value"],
    rules,
    created_at: new Date(),
    updated_at: new Date(),
  });

  it("scenario: different value types (string, number, json, bool) via rule serves", () => {
    const boolFlag = base([
      { id: "r", condition: { op: "percentage", pct: 100 }, serve: { kind: "value", value: true } },
    ]);
    const stringFlag = base([
      { id: "r", condition: { op: "percentage", pct: 100 }, serve: { kind: "value", value: "ocean_blue" } },
    ]);
    const numberFlag = base([
      { id: "r", condition: { op: "percentage", pct: 100 }, serve: { kind: "value", value: 42 } },
    ]);
    const jsonFlag = base([
      {
        id: "r",
        condition: { op: "percentage", pct: 100 },
        serve: { kind: "value", value: { theme: "dark", radius: 8 } },
      },
    ]);

    expect(evaluateFlag(boolFlag, { userId: "u" }).value).toBe(true);
    expect(evaluateFlag(stringFlag, { userId: "u" }).value).toBe("ocean_blue");
    expect(evaluateFlag(numberFlag, { userId: "u" }).value).toBe(42);
    expect(evaluateFlag(jsonFlag, { userId: "u" }).value).toEqual({ theme: "dark", radius: 8 });
  });

  it("scenario: % based random rollout, deterministic per user", () => {
    const flag = base([
      { id: "canary", condition: { op: "percentage", pct: 10 }, serve: { kind: "value", value: true } },
    ]);
    // Deterministic
    const a = evaluateFlag(flag, { userId: "alice" }).value;
    expect(evaluateFlag(flag, { userId: "alice" }).value).toBe(a);
    // ~10% hit rate at N=5000 (±2%)
    let on = 0;
    for (let i = 0; i < 5000; i++) {
      if (evaluateFlag(flag, { userId: `u-${i}` }).value === true) on++;
    }
    const rate = on / 5000;
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.12);
  });

  it("scenario: userList targeting via 'in' op on user.id", () => {
    const allowList = ["alice", "bob", "carol"];
    const flag = base([
      {
        id: "whitelist",
        condition: { op: "in", attr: "user.id", values: allowList },
        serve: { kind: "value", value: true },
      },
    ]);
    expect(evaluateFlag(flag, { userId: "alice" }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "bob" }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "eve" }).value).toBe(false);
    expect(evaluateFlag(flag, { userId: "dave" }).value).toBe(false);
  });

  it("scenario: target by app version AND device model", () => {
    const flag = base([
      {
        id: "r",
        condition: {
          op: "and",
          children: [
            { op: "semver_gte", attr: "app.version", value: "1.4.0" },
            { op: "eq", attr: "device.model", value: "iPhone15,3" },
          ],
        },
        serve: { kind: "value", value: true },
      },
    ]);
    expect(evaluateFlag(flag, { userId: "u", appVersion: "1.4.2", deviceModel: "iPhone15,3" }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "u", appVersion: "1.3.9", deviceModel: "iPhone15,3" }).value).toBe(false);
    expect(evaluateFlag(flag, { userId: "u", appVersion: "1.4.2", deviceModel: "iPhone13,1" }).value).toBe(false);
  });

  it("scenario: allow multiple conditions together (platform + version + country all ANDed)", () => {
    const flag = base([
      {
        id: "r",
        condition: {
          op: "and",
          children: [
            { op: "eq", attr: "app.platform", value: "ios" },
            { op: "semver_gte", attr: "app.version", value: "1.4.0" },
            { op: "in", attr: "app.country", values: ["US", "CA", "MX"] },
          ],
        },
        serve: { kind: "value", value: true },
      },
    ]);

    const match = evaluateFlag(flag, {
      userId: "u",
      platform: "ios",
      appVersion: "1.4.2",
      country: "US",
    });
    expect(match.value).toBe(true);

    // Fails each individual leaf
    expect(evaluateFlag(flag, { userId: "u", platform: "android", appVersion: "1.4.2", country: "US" }).value).toBe(false);
    expect(evaluateFlag(flag, { userId: "u", platform: "ios", appVersion: "1.3.9", country: "US" }).value).toBe(false);
    expect(evaluateFlag(flag, { userId: "u", platform: "ios", appVersion: "1.4.2", country: "DE" }).value).toBe(false);
  });

  it("scenario: OR group — ship to pro users OR early-access cohort", () => {
    const flag = base([
      {
        id: "r",
        condition: {
          op: "or",
          children: [
            { op: "eq", attr: "user.isPro", value: true },
            { op: "eq", attr: "custom.cohort", value: "early_access" },
          ],
        },
        serve: { kind: "value", value: true },
      },
    ]);
    expect(evaluateFlag(flag, { userId: "u", isPro: true }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "u", custom: { cohort: "early_access" } }).value).toBe(true);
    expect(evaluateFlag(flag, { userId: "u", isPro: false, custom: { cohort: "free" } }).value).toBe(false);
  });

  it("scenario: A/B test — 50/50 split + sticky per user", () => {
    const flag = base([
      {
        id: "split",
        condition: { op: "percentage", pct: 100 },
        serve: {
          kind: "variants",
          variants: [
            { key: "control", value: "headline_A", weight: 50 },
            { key: "treatment", value: "headline_B", weight: 50 },
          ],
        },
      },
    ]);

    // Stable per user across many calls
    const first = evaluateFlag(flag, { userId: "alice" }).variantKey;
    for (let i = 0; i < 50; i++) {
      expect(evaluateFlag(flag, { userId: "alice" }).variantKey).toBe(first);
    }

    // Distribution is ~50/50 at N=10k
    let control = 0;
    for (let i = 0; i < 10_000; i++) {
      if (evaluateFlag(flag, { userId: `u-${i}` }).variantKey === "control") control++;
    }
    expect(control).toBeGreaterThan(4700);
    expect(control).toBeLessThan(5300);
  });

  it("scenario: combining everything — AND + OR + percentage + version + A/B", () => {
    // "10% of US iOS 1.4+ pro users OR early-access, A/B split the headline."
    const flag = base([
      {
        id: "beta_ab",
        condition: {
          op: "and",
          children: [
            { op: "eq", attr: "app.platform", value: "ios" },
            { op: "semver_gte", attr: "app.version", value: "1.4.0" },
            { op: "eq", attr: "app.country", value: "US" },
            {
              op: "or",
              children: [
                { op: "eq", attr: "user.isPro", value: true },
                { op: "eq", attr: "custom.cohort", value: "early_access" },
              ],
            },
            { op: "percentage", pct: 10, seed: "beta_ab_rollout" },
          ],
        },
        serve: {
          kind: "variants",
          variants: [
            { key: "A", value: "headline_A", weight: 50 },
            { key: "B", value: "headline_B", weight: 50 },
          ],
        },
      },
    ]);

    // Deterministic: same context → same outcome
    const ctxA = { userId: "qualified-1", platform: "ios" as const, appVersion: "1.4.2", country: "US", isPro: true };
    const r1 = evaluateFlag(flag, ctxA);
    const r2 = evaluateFlag(flag, ctxA);
    expect(r1).toEqual(r2);

    // Android users never match — percentage short-circuits before variant bucketing
    expect(evaluateFlag(flag, { ...ctxA, platform: "android" }).matched).toBe(false);

    // Users who ARE in the 10% bucket get assigned to A or B
    const ctxBucket = { userId: "in-bucket", platform: "ios" as const, appVersion: "1.5.0", country: "US", isPro: true };
    const bucketRun = evaluateFlag(flag, ctxBucket);
    if (bucketRun.matched) {
      expect(["A", "B"]).toContain(bucketRun.variantKey);
      expect(["headline_A", "headline_B"]).toContain(bucketRun.value);
    }
  });
});

// ── legacy rollout_pct fallback (no v2 rules present) ─────────────────────

describe("evaluateFlag legacy fallback", () => {
  it("uses rollout_pct when rules is empty", () => {
    const flag: Flag = {
      key: "legacy",
      enabled: true,
      rollout_pct: 100,
      description: "",
      rules: [],
      created_at: new Date(),
      updated_at: new Date(),
    };
    expect(evaluateFlag(flag, { userId: "u" }).value).toBe(true);

    flag.rollout_pct = 0;
    expect(evaluateFlag(flag, { userId: "u" }).value).toBe(false);
  });
});

// ── FlagsService.evaluate: override precedence, exposure hook ─────────────

describe("FlagsService.evaluate", () => {
  const v2Flag = (rules: FlagRule[], defaultValue: unknown = false): Flag => ({
    key: "e",
    enabled: true,
    rollout_pct: 0,
    description: "",
    default_value: defaultValue as Flag["default_value"],
    rules,
    created_at: new Date(),
    updated_at: new Date(),
  });

  it("user override wins over rules", async () => {
    const flag = v2Flag([
      { id: "r1", condition: { op: "percentage", pct: 100 }, serve: { kind: "value", value: true } },
    ]);
    const db = mockDB({
      getFlag: vi.fn().mockResolvedValue(flag),
      getUserOverride: vi.fn().mockResolvedValue(false),
    });
    const svc = new FlagsService(db);
    const res = await svc.evaluate("e", { userId: "u" });
    expect(res.value).toBe(false);
    expect(res.ruleId).toBe("user-override");
  });

  it("missing flag returns {value: false, matched: false}", async () => {
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(null) });
    const svc = new FlagsService(db);
    const res = await svc.evaluate("missing", { userId: "u" });
    expect(res.value).toBe(false);
    expect(res.matched).toBe(false);
  });

  it("rejects empty key and missing userId", async () => {
    const svc = new FlagsService(mockDB());
    await expect(svc.evaluate("", { userId: "u" })).rejects.toThrow(ValidationError);
    await expect(svc.evaluate("k", { userId: "" } as FlagContext)).rejects.toThrow(ValidationError);
  });

  it("onExposure hook fires for every evaluation", async () => {
    const flag = v2Flag([
      { id: "r1", condition: { op: "percentage", pct: 100 }, serve: { kind: "value", value: true } },
    ]);
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(flag) });
    const onExposure = vi.fn();
    const svc = new FlagsService(db, { onExposure });
    await svc.evaluate("e", { userId: "u", platform: "ios" });
    expect(onExposure).toHaveBeenCalledTimes(1);
    const [ctx, key, result] = onExposure.mock.calls[0]!;
    expect(ctx.userId).toBe("u");
    expect(key).toBe("e");
    expect(result.value).toBe(true);
    expect(result.ruleId).toBe("r1");
  });

  it("onExposure errors never break evaluation", async () => {
    const flag = v2Flag([
      { id: "r1", condition: { op: "percentage", pct: 100 }, serve: { kind: "value", value: true } },
    ]);
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(flag) });
    const svc = new FlagsService(db, {
      onExposure: () => { throw new Error("boom"); },
    });
    const res = await svc.evaluate("e", { userId: "u" });
    expect(res.value).toBe(true);
  });
});

// ── evaluateAll batching ──────────────────────────────────────────────────

describe("FlagsService.evaluateAll", () => {
  it("evaluates a list of keys in one call", async () => {
    const flags: Record<string, Flag> = {
      a: makeFlag({ key: "a", rollout_pct: 100 }),
      b: makeFlag({ key: "b", rollout_pct: 0 }),
    };
    const db = mockDB({ getFlag: vi.fn((k: string) => Promise.resolve(flags[k] ?? null)) });
    const svc = new FlagsService(db);
    const result = await svc.evaluateAll({ userId: "u" }, ["a", "b"]);
    expect(result.a!.value).toBe(true);
    expect(result.b!.value).toBe(false);
  });

  it("falls back to listFlags when keys omitted", async () => {
    const list = vi.fn().mockResolvedValue([makeFlag({ key: "x", rollout_pct: 100 })]);
    const db = mockDB({ listFlags: list, getFlag: vi.fn().mockResolvedValue(makeFlag({ key: "x", rollout_pct: 100 })) });
    const svc = new FlagsService(db);
    const result = await svc.evaluateAll({ userId: "u" });
    expect(list).toHaveBeenCalled();
    expect(result.x!.value).toBe(true);
  });

  it("rejects > 200 keys", async () => {
    const svc = new FlagsService(mockDB());
    const keys = Array.from({ length: 201 }, (_, i) => `k${i}`);
    await expect(svc.evaluateAll({ userId: "u" }, keys)).rejects.toThrow(ValidationError);
  });
});

// ── rule + variant management ─────────────────────────────────────────────

describe("FlagsService rule management", () => {
  const okRule: FlagRule = {
    id: "r1",
    condition: { op: "eq", attr: "app.platform", value: "ios" },
    serve: { kind: "value", value: true },
  };

  it("upsertRules replaces the rule list", async () => {
    const existing = makeFlag({ key: "f", rules: [] });
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(existing) });
    const svc = new FlagsService(db);
    const out = await svc.upsertRules("f", [okRule]);
    expect(out.rules).toEqual([okRule]);
    expect(db.upsertFlag).toHaveBeenCalled();
  });

  it("upsertRules rejects duplicate rule ids", async () => {
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(makeFlag()) });
    const svc = new FlagsService(db);
    await expect(
      svc.upsertRules("f", [okRule, { ...okRule }])
    ).rejects.toThrow(/duplicate rule id/);
  });

  it("upsertRules rejects deeply-nested trees (> 8 levels)", async () => {
    let cond: FlagRule["condition"] = { op: "eq", attr: "user.id", value: "x" };
    for (let i = 0; i < 10; i++) cond = { op: "not", child: cond };
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(makeFlag()) });
    const svc = new FlagsService(db);
    await expect(
      svc.upsertRules("f", [{ id: "deep", condition: cond, serve: { kind: "value", value: true } }])
    ).rejects.toThrow(/too deep/);
  });

  it("upsertRules throws NotFoundError for missing flag", async () => {
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(null) });
    const svc = new FlagsService(db);
    await expect(svc.upsertRules("nope", [okRule])).rejects.toThrow(NotFoundError);
  });

  it("listRules returns [] for legacy flags without v2 rules", async () => {
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(makeFlag({ rules: undefined })) });
    const svc = new FlagsService(db);
    expect(await svc.listRules("f")).toEqual([]);
  });

  it("addVariant appends a new variant or replaces an existing one by key", async () => {
    const existing = makeFlag({ variants: [{ key: "A", value: "a", weight: 50 }] });
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(existing) });
    const svc = new FlagsService(db);

    const after1 = await svc.addVariant("f", { key: "B", value: "b", weight: 50 });
    expect(after1.variants).toHaveLength(2);

    const after2 = await svc.addVariant("f", { key: "A", value: "a2", weight: 60 });
    expect(after2.variants).toHaveLength(2);
    expect(after2.variants!.find((v) => v.key === "A")!.value).toBe("a2");
    expect(after2.variants!.find((v) => v.key === "A")!.weight).toBe(60);
  });

  it("removeVariant filters out the given key", async () => {
    const existing = makeFlag({
      variants: [
        { key: "A", value: "a", weight: 50 },
        { key: "B", value: "b", weight: 50 },
      ],
    });
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(existing) });
    const svc = new FlagsService(db);
    const after = await svc.removeVariant("f", "A");
    expect(after.variants).toHaveLength(1);
    expect(after.variants![0]!.key).toBe("B");
  });

  it("variant validation rejects negative weight", async () => {
    const db = mockDB({ getFlag: vi.fn().mockResolvedValue(makeFlag()) });
    const svc = new FlagsService(db);
    await expect(
      svc.addVariant("f", { key: "A", value: "a", weight: -1 })
    ).rejects.toThrow(/weight/);
  });
});
