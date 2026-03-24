import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SyncService,
  type SyncDB,
  type EntityHandler,
  type BatchItem,
} from "../sync/index.js";
import { ValidationError, ServiceError } from "../errors/index.js";

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

describe("SyncService", () => {
  let svc: SyncService;

  afterEach(() => {
    svc?.close();
  });

  describe("getChanges", () => {
    it("returns changes with synced_at timestamp", async () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler({
        changedSince: vi.fn().mockResolvedValue({ habits: [{ id: "h1" }] }),
      });
      svc = new SyncService(db, handler);

      const result = await svc.getChanges("user-1", { since: "2025-01-01T00:00:00Z" });
      expect(result.synced_at).toBeDefined();
      expect(result.deleted).toEqual([]);
      expect(result.habits).toEqual([{ id: "h1" }]);
    });

    it("rejects invalid since format", async () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler();
      svc = new SyncService(db, handler);

      await expect(svc.getChanges("user-1", { since: "not-a-date" }))
        .rejects.toThrow(ValidationError);
    });
  });

  describe("syncBatch", () => {
    it("rejects empty items", async () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler();
      svc = new SyncService(db, handler);

      await expect(svc.syncBatch("user-1", []))
        .rejects.toThrow(ValidationError);
    });

    it("rejects > 500 items", async () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler();
      svc = new SyncService(db, handler);

      const items: BatchItem[] = Array.from({ length: 501 }, (_, i) => ({
        client_id: `c-${i}`,
        entity_type: "habit",
        version: 1,
        fields: {},
      }));

      await expect(svc.syncBatch("user-1", items))
        .rejects.toThrow(/500/);
    });

    it("validates items have client_id and entity_type", async () => {
      const db = mockSyncDB();
      const handler = mockEntityHandler();
      svc = new SyncService(db, handler);

      // Missing client_id
      await expect(
        svc.syncBatch("user-1", [{ entity_type: "habit", version: 1, fields: {} } as BatchItem])
      ).rejects.toThrow(/client_id/i);

      // Missing entity_type
      await expect(
        svc.syncBatch("user-1", [{ client_id: "c-1", version: 1, fields: {} } as BatchItem])
      ).rejects.toThrow(/entity_type/i);
    });

    it("returns cached response for same idempotency key", async () => {
      const batchUpsert = vi.fn().mockResolvedValue({
        items: [{ client_id: "c-1", server_id: "s-1", version: 1 }],
        errors: [],
      });
      const db = mockSyncDB();
      const handler = mockEntityHandler({ batchUpsert });
      svc = new SyncService(db, handler);

      const items: BatchItem[] = [{ client_id: "c-1", entity_type: "habit", version: 1, fields: {} }];

      const result1 = await svc.syncBatch("user-1", items, { idempotencyKey: "idem-123" });
      const result2 = await svc.syncBatch("user-1", items, { idempotencyKey: "idem-123" });

      expect(result1).toEqual(result2);
      // batchUpsert should only be called once (second request uses cache)
      expect(batchUpsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("deleteEntity", () => {
    it("deletes entity and records tombstone", async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const recordTombstone = vi.fn().mockResolvedValue(undefined);
      const db = mockSyncDB({ recordTombstone });
      const handler = mockEntityHandler({ delete: deleteFn });
      svc = new SyncService(db, handler);

      const result = await svc.deleteEntity("user-1", "habit", "h-1");
      expect(result.status).toBe("deleted");

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

      const items: BatchItem[] = [{ client_id: "c-1", entity_type: "habit", version: 1, fields: {} }];

      // 3 rapid syncs within debounce window
      await svc.syncBatch("user-1", items, { deviceId: "device-A" });
      await svc.syncBatch("user-1", items, { deviceId: "device-A" });
      await svc.syncBatch("user-1", items, { deviceId: "device-A" });

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

      const items: BatchItem[] = [{ client_id: "c-1", entity_type: "habit", version: 1, fields: {} }];
      await svc.syncBatch("user-1", items, { deviceId: "device-A" });

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

      const items: BatchItem[] = [{ client_id: "c-1", entity_type: "habit", version: 1, fields: {} }];
      await svc.syncBatch("user-1", items, { deviceId: "device-A" });

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
