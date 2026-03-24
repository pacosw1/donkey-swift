import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { AccountService, type AccountDB, type AccountConfig, type AppCleanup, type AppExporter, type UserDataExport } from "../account/index.js";

function mockDB(overrides: Partial<AccountDB> = {}): AccountDB {
  return {
    getUserEmail: vi.fn().mockResolvedValue("user@example.com"),
    deleteUserData: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    anonymizeUser: vi.fn().mockResolvedValue(undefined),
    exportUserData: vi.fn().mockResolvedValue({ user: { id: "user-1" } } as UserDataExport),
    ...overrides,
  };
}

function buildApp(
  db: AccountDB,
  cfg: AccountConfig = {},
  opts?: { cleanup?: AppCleanup; exporter?: AppExporter }
) {
  const svc = new AccountService(cfg, db, opts);
  const a = new Hono();
  a.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  a.delete("/account", svc.handleDeleteAccount);
  a.post("/account/anonymize", svc.handleAnonymizeAccount);
  a.get("/account/export", svc.handleExportData);
  return { app: a, svc };
}

describe("AccountService", () => {
  describe("handleDeleteAccount", () => {
    it("deletes all data in order", async () => {
      const callOrder: string[] = [];
      const db = mockDB({
        deleteUserData: vi.fn().mockImplementation(async () => { callOrder.push("deleteUserData"); }),
        deleteUser: vi.fn().mockImplementation(async () => { callOrder.push("deleteUser"); }),
      });
      const { app } = buildApp(db);

      const res = await app.request("/account", { method: "DELETE" });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("deleted");

      // deleteUserData must be called before deleteUser
      expect(callOrder).toEqual(["deleteUserData", "deleteUser"]);
      expect(db.deleteUserData).toHaveBeenCalledWith("user-1");
      expect(db.deleteUser).toHaveBeenCalledWith("user-1");
    });

    it("calls withTransaction if available", async () => {
      const withTransaction = vi.fn().mockImplementation(async (fn: () => Promise<void>) => fn());
      const db = mockDB({ withTransaction });
      const { app } = buildApp(db);

      const res = await app.request("/account", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(withTransaction).toHaveBeenCalled();
    });

    it("fires onDelete callback", async () => {
      const onDelete = vi.fn();
      const db = mockDB();
      const { app } = buildApp(db, { onDelete });

      const res = await app.request("/account", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(onDelete).toHaveBeenCalledWith("user-1", "user@example.com");
    });

    it("returns 500 if deletion fails", async () => {
      const db = mockDB({
        deleteUserData: vi.fn().mockRejectedValue(new Error("db down")),
      });
      const { app } = buildApp(db);

      const res = await app.request("/account", { method: "DELETE" });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain("failed to delete");
    });
  });

  describe("handleAnonymizeAccount", () => {
    it("anonymizes successfully", async () => {
      const db = mockDB();
      const { app } = buildApp(db);

      const res = await app.request("/account/anonymize", { method: "POST" });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("anonymized");
      expect(db.anonymizeUser).toHaveBeenCalledWith("user-1");
    });
  });

  describe("handleExportData", () => {
    it("exports with Content-Disposition header", async () => {
      const db = mockDB();
      const { app } = buildApp(db);

      const res = await app.request("/account/export", { method: "GET" });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toBe("attachment; filename=account-data.json");
      const json = await res.json();
      expect(json.user).toEqual({ id: "user-1" });
    });

    it("includes app data if exporter configured", async () => {
      const db = mockDB();
      const exporter: AppExporter = {
        exportAppData: vi.fn().mockResolvedValue({ workouts: [1, 2, 3] }),
      };
      const { app } = buildApp(db, {}, { exporter });

      const res = await app.request("/account/export", { method: "GET" });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.app_data).toEqual({ workouts: [1, 2, 3] });
      expect(exporter.exportAppData).toHaveBeenCalledWith("user-1");
    });
  });
});
