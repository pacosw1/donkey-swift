import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import {
  SyncService,
  type SyncDB,
  type EntityHandler,
  type BatchItem,
} from "../sync/index.js";

function mockSyncDB(overrides: Partial<SyncDB> = {}): SyncDB {
  return {
    serverTime: vi.fn().mockResolvedValue(new Date("2026-01-01T00:00:00Z")),
    tombstones: vi.fn().mockResolvedValue([]),
    recordTombstone: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockEntityHandler(overrides: Partial<EntityHandler> = {}): EntityHandler {
  return {
    changedSince: vi.fn().mockResolvedValue({}),
    batchUpsert: vi.fn().mockResolvedValue({ items: [], errors: [] }),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildApp(svc: SyncService): Hono {
  const a = new Hono();
  a.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  a.get("/sync/changes", svc.handleSyncChanges);
  a.post("/sync/batch", svc.handleSyncBatch);
  a.delete("/sync/:entity_type/:id", svc.handleSyncDelete);
  return a;
}

describe("SyncService", () => {
  let svc: SyncService;

  afterEach(() => {
    svc?.close();
  });

  describe("handleSyncChanges", () => {
    it("returns changes with synced_at timestamp", async () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler({
        changedSince: vi.fn().mockResolvedValue({ habits: [{ id: "h1" }] }),
      });
      svc = new SyncService(db, handler);
      const app = buildApp(svc);

      const res = await app.request("/sync/changes?since=2025-01-01T00:00:00Z");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.synced_at).toBeDefined();
      expect(body.deleted).toEqual([]);
      expect(body.habits).toEqual([{ id: "h1" }]);
    });

    it("rejects invalid since format (400)", async () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler();
      svc = new SyncService(db, handler);
      const app = buildApp(svc);

      const res = await app.request("/sync/changes?since=not-a-date");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid.*since/i);
    });
  });

  describe("handleSyncBatch", () => {
    it("rejects empty items (400)", async () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler();
      svc = new SyncService(db, handler);
      const app = buildApp(svc);

      const res = await app.request("/sync/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/items/i);
    });

    it("rejects > 500 items (400)", async () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler();
      svc = new SyncService(db, handler);
      const app = buildApp(svc);

      const items: BatchItem[] = Array.from({ length: 501 }, (_, i) => ({
        client_id: `c-${i}`,
        entity_type: "habit",
        version: 1,
        fields: {},
      }));

      const res = await app.request("/sync/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/500/);
    });

    it("validates items have client_id and entity_type", async () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler();
      svc = new SyncService(db, handler);
      const app = buildApp(svc);

      // Missing client_id
      const res1 = await app.request("/sync/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ entity_type: "habit", version: 1, fields: {} }],
        }),
      });
      expect(res1.status).toBe(400);
      const body1 = await res1.json();
      expect(body1.error).toMatch(/client_id/i);

      // Missing entity_type
      const res2 = await app.request("/sync/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ client_id: "c-1", version: 1, fields: {} }],
        }),
      });
      expect(res2.status).toBe(400);
      const body2 = await res2.json();
      expect(body2.error).toMatch(/entity_type/i);
    });

    it("returns cached response for same idempotency key", async () => {
      const batchUpsert = vi.fn().mockResolvedValue({
        items: [{ client_id: "c-1", server_id: "s-1", version: 1 }],
        errors: [],
      });
      const db = mockSyncDB();
      const handler = mockEntityHandler({ batchUpsert });
      svc = new SyncService(db, handler);
      const app = buildApp(svc);

      const reqOpts = {
        method: "POST" as const,
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": "idem-123",
        },
        body: JSON.stringify({
          items: [{ client_id: "c-1", entity_type: "habit", version: 1, fields: {} }],
        }),
      };

      const res1 = await app.request("/sync/batch", reqOpts);
      expect(res1.status).toBe(200);
      const body1 = await res1.json();

      // Second request with same key should return cached response
      const res2 = await app.request("/sync/batch", {
        ...reqOpts,
        body: JSON.stringify({
          items: [{ client_id: "c-1", entity_type: "habit", version: 1, fields: {} }],
        }),
      });
      expect(res2.status).toBe(200);
      const body2 = await res2.json();

      expect(body1).toEqual(body2);
      // batchUpsert should only be called once (second request uses cache)
      expect(batchUpsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleSyncDelete", () => {
    it("deletes entity and records tombstone", async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const recordTombstone = vi.fn().mockResolvedValue(undefined);
      const db = mockSyncDB({ recordTombstone });
      const handler = mockEntityHandler({ delete: deleteFn });
      svc = new SyncService(db, handler);
      const app = buildApp(svc);

      const res = await app.request("/sync/habit/h-1", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("deleted");

      expect(deleteFn).toHaveBeenCalledWith("user-1", "habit", "h-1");
      expect(recordTombstone).toHaveBeenCalledWith("user-1", "habit", "h-1");
    });
  });

  describe("push debounce", () => {
    it("debounces rapid sync writes into one silent push", async () => {
      vi.useFakeTimers();
      const sendSilent = vi.fn().mockResolvedValue(undefined);
      const push = { send: vi.fn(), sendWithData: vi.fn(), sendSilent };
      const enabledTokensForUser = vi.fn().mockResolvedValue([
        { deviceId: "device-B", token: "token-B" },
      ]);
      const batchUpsert = vi.fn().mockResolvedValue({
        items: [{ client_id: "c-1", server_id: "s-1", version: 1 }],
        errors: [],
      });
      const db = mockSyncDB();
      const handler = mockEntityHandler({ batchUpsert });
      svc = new SyncService(db, handler, {
        push,
        deviceTokens: { enabledTokensForUser },
        pushDebounceMs: 2500,
      });
      const app = buildApp(svc);

      const req = {
        method: "POST" as const,
        headers: { "Content-Type": "application/json", "x-device-id": "device-A" },
        body: JSON.stringify({
          items: [{ client_id: "c-1", entity_type: "habit", version: 1, fields: {} }],
        }),
      };

      // 3 rapid syncs within debounce window
      await app.request("/sync/batch", req);
      await app.request("/sync/batch", req);
      await app.request("/sync/batch", req);

      // No push yet — still within debounce window
      expect(sendSilent).not.toHaveBeenCalled();

      // Advance past debounce window
      await vi.advanceTimersByTimeAsync(3000);

      // Only ONE silent push should have fired
      expect(sendSilent).toHaveBeenCalledTimes(1);
      expect(sendSilent).toHaveBeenCalledWith("token-B", { action: "sync" });

      vi.useRealTimers();
    });

    it("fires immediately when pushDebounceMs is 0", async () => {
      const sendSilent = vi.fn().mockResolvedValue(undefined);
      const push = { send: vi.fn(), sendWithData: vi.fn(), sendSilent };
      const enabledTokensForUser = vi.fn().mockResolvedValue([
        { deviceId: "device-B", token: "token-B" },
      ]);
      const batchUpsert = vi.fn().mockResolvedValue({
        items: [{ client_id: "c-1", server_id: "s-1", version: 1 }],
        errors: [],
      });
      const db = mockSyncDB();
      const handler = mockEntityHandler({ batchUpsert });
      svc = new SyncService(db, handler, {
        push,
        deviceTokens: { enabledTokensForUser },
        pushDebounceMs: 0,
      });
      const app = buildApp(svc);

      await app.request("/sync/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-device-id": "device-A" },
        body: JSON.stringify({
          items: [{ client_id: "c-1", entity_type: "habit", version: 1, fields: {} }],
        }),
      });

      // Wait for the fire-and-forget promise
      await new Promise((r) => setTimeout(r, 50));
      expect(sendSilent).toHaveBeenCalledTimes(1);
    });

    it("excludes the originating device from push", async () => {
      vi.useFakeTimers();
      const sendSilent = vi.fn().mockResolvedValue(undefined);
      const push = { send: vi.fn(), sendWithData: vi.fn(), sendSilent };
      const enabledTokensForUser = vi.fn().mockResolvedValue([
        { deviceId: "device-A", token: "token-A" },
        { deviceId: "device-B", token: "token-B" },
        { deviceId: "device-C", token: "token-C" },
      ]);
      const batchUpsert = vi.fn().mockResolvedValue({
        items: [{ client_id: "c-1", server_id: "s-1", version: 1 }],
        errors: [],
      });
      const db = mockSyncDB();
      const handler = mockEntityHandler({ batchUpsert });
      svc = new SyncService(db, handler, {
        push,
        deviceTokens: { enabledTokensForUser },
        pushDebounceMs: 2000,
      });
      const app = buildApp(svc);

      await app.request("/sync/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-device-id": "device-A" },
        body: JSON.stringify({
          items: [{ client_id: "c-1", entity_type: "habit", version: 1, fields: {} }],
        }),
      });

      await vi.advanceTimersByTimeAsync(2500);

      // Should push to B and C but NOT A
      expect(sendSilent).toHaveBeenCalledTimes(2);
      expect(sendSilent).toHaveBeenCalledWith("token-B", { action: "sync" });
      expect(sendSilent).toHaveBeenCalledWith("token-C", { action: "sync" });

      vi.useRealTimers();
    });
  });

  describe("close", () => {
    it("clears cleanup interval and pending push timers", () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler();
      svc = new SyncService(db, handler);

      const clearIntervalSpy = vi.spyOn(global, "clearInterval");
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      svc.close();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });
  });
});
