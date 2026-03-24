import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
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

// ── Admin handler tests ─────────────────────────────────────────────────────

describe("FlagsService admin handlers", () => {
  function buildAdminApp(svc: FlagsService): Hono {
    const a = new Hono();
    a.post("/admin/flags", svc.handleAdminCreate);
    a.put("/admin/flags/:key", svc.handleAdminUpdate);
    a.delete("/admin/flags/:key", svc.handleAdminDelete);
    a.post("/admin/flags/:key/overrides", svc.handleAdminSetOverride);
    a.delete("/admin/flags/:key/overrides/:user_id", svc.handleAdminDeleteOverride);
    return a;
  }

  describe("handleAdminCreate", () => {
    it("rejects rollout_pct > 100 with 400", async () => {
      const svc = new FlagsService(mockDB());
      const app = buildAdminApp(svc);

      const res = await app.request("/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "flag_over", rollout_pct: 101 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("rollout_pct");
    });

    it("rejects rollout_pct < 0 with 400", async () => {
      const svc = new FlagsService(mockDB());
      const app = buildAdminApp(svc);

      const res = await app.request("/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "flag_neg", rollout_pct: -5 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("rollout_pct");
    });
  });

  describe("handleAdminUpdate", () => {
    it("rejects rollout_pct < 0 with 400", async () => {
      const db = mockDB({
        getFlag: vi.fn().mockResolvedValue(makeFlag()),
      });
      const svc = new FlagsService(db);
      const app = buildAdminApp(svc);

      const res = await app.request("/admin/flags/test_flag", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollout_pct: -1 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("rollout_pct");
    });

    it("rejects rollout_pct > 100 with 400", async () => {
      const db = mockDB({
        getFlag: vi.fn().mockResolvedValue(makeFlag()),
      });
      const svc = new FlagsService(db);
      const app = buildAdminApp(svc);

      const res = await app.request("/admin/flags/test_flag", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollout_pct: 150 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("rollout_pct");
    });
  });

  describe("handleAdminDelete", () => {
    it("returns 404 for non-existent flag", async () => {
      const db = mockDB({
        getFlag: vi.fn().mockResolvedValue(null),
      });
      const svc = new FlagsService(db);
      const app = buildAdminApp(svc);

      const res = await app.request("/admin/flags/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("flag not found");
    });
  });

  describe("handleAdminSetOverride", () => {
    it("requires user_id", async () => {
      const svc = new FlagsService(mockDB());
      const app = buildAdminApp(svc);

      const res = await app.request("/admin/flags/test_flag/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("user_id");
    });

    it("requires enabled field", async () => {
      const svc = new FlagsService(mockDB());
      const app = buildAdminApp(svc);

      const res = await app.request("/admin/flags/test_flag/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "user-1" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("enabled");
    });
  });

  describe("handleAdminDeleteOverride", () => {
    it("requires key and user_id (route params)", async () => {
      const svc = new FlagsService(mockDB());
      const app = buildAdminApp(svc);

      // Valid route with both params should succeed
      const deleteOverride = vi.fn().mockResolvedValue(undefined);
      const db2 = mockDB({ deleteUserOverride: deleteOverride });
      const svc2 = new FlagsService(db2);
      const app2 = buildAdminApp(svc2);

      const res = await app2.request("/admin/flags/my_flag/overrides/user-1", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
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
