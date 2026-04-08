import { describe, it, expect, vi } from "vitest";
import {
  AccountService,
  type AccountDB,
  type AccountConfig,
  type AppCleanup,
  type AppExporter,
  type IdentityRevoker,
  type UserDataExport,
} from "../account/index.js";
import { ServiceError } from "../errors/index.js";

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

function createService(
  dbOverrides: Partial<AccountDB> = {},
  cfg: AccountConfig = {},
  opts?: { cleanup?: AppCleanup; exporter?: AppExporter; revoker?: IdentityRevoker }
) {
  const db = mockDB(dbOverrides);
  const svc = new AccountService(cfg, db, opts);
  return { svc, db };
}

describe("AccountService", () => {
  describe("deleteAccount", () => {
    it("deletes all data in order", async () => {
      const callOrder: string[] = [];
      const { svc, db } = createService({
        deleteUserData: vi.fn().mockImplementation(async () => { callOrder.push("deleteUserData"); }),
        deleteUser: vi.fn().mockImplementation(async () => { callOrder.push("deleteUser"); }),
      });

      const result = await svc.deleteAccount("user-1");
      expect(result.status).toBe("deleted");

      // deleteUserData must be called before deleteUser
      expect(callOrder).toEqual(["deleteUserData", "deleteUser"]);
      expect(db.deleteUserData).toHaveBeenCalledWith("user-1");
      expect(db.deleteUser).toHaveBeenCalledWith("user-1");
    });

    it("calls withTransaction if available", async () => {
      const withTransaction = vi.fn().mockImplementation(async (fn: () => Promise<void>) => fn());
      const { svc } = createService({ withTransaction });

      const result = await svc.deleteAccount("user-1");
      expect(result.status).toBe("deleted");
      expect(withTransaction).toHaveBeenCalled();
    });

    it("fires onDelete callback", async () => {
      const onDelete = vi.fn();
      const { svc } = createService({}, { onDelete });

      const result = await svc.deleteAccount("user-1");
      expect(result.status).toBe("deleted");
      expect(onDelete).toHaveBeenCalledWith("user-1", "user@example.com");
    });

    it("revokes external identity before deletion when configured", async () => {
      const revoker: IdentityRevoker = {
        revokeIdentity: vi.fn().mockResolvedValue({
          provider: "apple",
          attempted: true,
          revoked: true,
        }),
      };
      const { svc } = createService({}, {}, { revoker });

      const result = await svc.deleteAccount("user-1");
      expect(result.identityRevocation).toEqual({
        provider: "apple",
        attempted: true,
        revoked: true,
      });
      expect(revoker.revokeIdentity).toHaveBeenCalledWith("user-1");
    });

    it("throws ServiceError if deletion fails", async () => {
      const { svc } = createService({
        deleteUserData: vi.fn().mockRejectedValue(new Error("db down")),
      });

      await expect(svc.deleteAccount("user-1")).rejects.toThrow(ServiceError);
      await expect(svc.deleteAccount("user-1")).rejects.toThrow("failed to delete account");
    });

    it("throws ServiceError if identity revocation fails", async () => {
      const revoker: IdentityRevoker = {
        revokeIdentity: vi.fn().mockRejectedValue(new Error("apple down")),
      };
      const { svc } = createService({}, {}, { revoker });

      await expect(svc.deleteAccount("user-1")).rejects.toThrow(ServiceError);
      await expect(svc.deleteAccount("user-1")).rejects.toThrow("failed to revoke account identity");
    });
  });

  describe("anonymizeAccount", () => {
    it("anonymizes successfully", async () => {
      const { svc, db } = createService();

      const result = await svc.anonymizeAccount("user-1");
      expect(result.status).toBe("anonymized");
      expect(db.anonymizeUser).toHaveBeenCalledWith("user-1");
    });
  });

  describe("exportData", () => {
    it("exports user data", async () => {
      const { svc } = createService();

      const result = await svc.exportData("user-1");
      expect(result.user).toEqual({ id: "user-1" });
    });

    it("includes app data if exporter configured", async () => {
      const exporter: AppExporter = {
        exportAppData: vi.fn().mockResolvedValue({ workouts: [1, 2, 3] }),
      };
      const { svc } = createService({}, {}, { exporter });

      const result = await svc.exportData("user-1");
      expect(result.app_data).toEqual({ workouts: [1, 2, 3] });
      expect(exporter.exportAppData).toHaveBeenCalledWith("user-1");
    });
  });
});
