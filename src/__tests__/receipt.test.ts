import { describe, it, expect, vi } from "vitest";
import { ReceiptService, type ReceiptDB, type ReceiptConfig } from "../receipt/index.js";
import { ValidationError, ServiceError } from "../errors/index.js";

function mockDB(overrides: Partial<ReceiptDB> = {}): ReceiptDB {
  return {
    upsertSubscription: vi.fn().mockResolvedValue(undefined),
    userIdByTransactionId: vi.fn().mockResolvedValue("user-1"),
    storeTransaction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ReceiptService", () => {
  describe("verifyReceipt", () => {
    it("rejects missing userId", async () => {
      const svc = new ReceiptService(mockDB(), {});
      await expect(svc.verifyReceipt("", "fake.jws.token")).rejects.toThrow(ValidationError);
      await expect(svc.verifyReceipt("", "fake.jws.token")).rejects.toThrow(/unauthorized/);
    });

    it("rejects missing transaction", async () => {
      const svc = new ReceiptService(mockDB(), {});
      await expect(svc.verifyReceipt("user-1", "")).rejects.toThrow(ValidationError);
      await expect(svc.verifyReceipt("user-1", "")).rejects.toThrow(/transaction is required/);
    });

    it("rejects invalid JWS (verification fails)", async () => {
      const svc = new ReceiptService(mockDB(), {});
      // A non-valid JWS string will fail during verification
      await expect(svc.verifyReceipt("user-1", "not.a.real.jws")).rejects.toThrow(ValidationError);
      await expect(svc.verifyReceipt("user-1", "not.a.real.jws")).rejects.toThrow(/verification failed/);
    });
  });

  describe("processWebhook", () => {
    it("rejects missing signedPayload", async () => {
      const svc = new ReceiptService(mockDB(), {});
      await expect(svc.processWebhook("")).rejects.toThrow(ValidationError);
      await expect(svc.processWebhook("")).rejects.toThrow(/invalid webhook payload/);
    });

    it("rejects invalid JWS signature", async () => {
      const svc = new ReceiptService(mockDB(), {});
      await expect(svc.processWebhook("fake.jws.token")).rejects.toThrow(ValidationError);
      await expect(svc.processWebhook("fake.jws.token")).rejects.toThrow(/invalid signature/);
    });

    it("handles TEST notification type", async () => {
      const db = mockDB();
      const svc = new ReceiptService(db, {});

      // Mock the private JWS verification to return a TEST notification payload
      vi.spyOn(svc as any, "verifyAndDecodePayload").mockResolvedValue(
        JSON.stringify({ notificationType: "TEST" })
      );

      const result = await svc.processWebhook("fake.jws.token");
      expect(result.status).toBe("ok");

      // DB should not be called for TEST notifications
      expect(db.upsertSubscription).not.toHaveBeenCalled();
    });

    it("rejects missing signed transaction info", async () => {
      const svc = new ReceiptService(mockDB(), {});

      vi.spyOn(svc as any, "verifyAndDecodePayload").mockResolvedValue(
        JSON.stringify({ notificationType: "DID_RENEW", data: {} })
      );

      await expect(svc.processWebhook("fake.jws.token")).rejects.toThrow(ValidationError);
      await expect(svc.processWebhook("fake.jws.token")).rejects.toThrow(/missing signed transaction/);
    });
  });

  describe("processWebhook: refunds, retries, notification hook", () => {
    const baseTxn = {
      transactionId: "t1",
      originalTransactionId: "ot1",
      bundleId: "com.test",
      productId: "pro_yearly",
      purchaseDate: 1_700_000_000_000,
      expiresDate: 1_900_000_000_000,
      type: "Auto-Renewable Subscription",
      inAppOwnershipType: "PURCHASED",
      environment: "Production",
      price: 49990,
      currency: "USD",
    };

    function svcWith(
      db: ReceiptDB,
      notification: Record<string, unknown>,
      txn: Record<string, unknown> | null,
      cfg: ReceiptConfig = {},
    ): ReceiptService {
      const svc = new ReceiptService(db, cfg);
      vi.spyOn(svc as any, "verifyAndDecodePayload").mockImplementation(async (jws: unknown) => {
        if (jws === "outer.jws.sig") return JSON.stringify(notification);
        if (jws === "txn.jws.sig" && txn) return JSON.stringify(txn);
        throw new Error("unexpected jws");
      });
      return svc;
    }

    const revoked = { ...baseTxn, revocationDate: 1_750_000_000_000, revocationReason: 0 };

    it("stores status refunded for a REFUND notification on a revoked transaction", async () => {
      const db = mockDB();
      const svc = svcWith(db, { notificationType: "REFUND", data: { signedTransactionInfo: "txn.jws.sig" } }, revoked);
      const result = await svc.processWebhook("outer.jws.sig");
      expect(result.status).toBe("ok");
      expect(db.upsertSubscription).toHaveBeenCalledWith("user-1", "pro_yearly", "ot1", "refunded", expect.any(Date), expect.any(Number), "USD");
      expect(db.storeTransaction).toHaveBeenCalledWith(expect.objectContaining({ status: "refunded", notification_type: "REFUND" }));
    });

    it("stores status revoked for a REVOKE notification on a revoked transaction", async () => {
      const db = mockDB();
      const svc = svcWith(db, { notificationType: "REVOKE", data: { signedTransactionInfo: "txn.jws.sig" } }, revoked);
      await svc.processWebhook("outer.jws.sig");
      expect(db.upsertSubscription).toHaveBeenCalledWith("user-1", "pro_yearly", "ot1", "revoked", expect.any(Date), expect.any(Number), "USD");
    });

    it("still rejects a revoked transaction on a non-refund notification", async () => {
      const svc = svcWith(mockDB(), { notificationType: "DID_RENEW", data: { signedTransactionInfo: "txn.jws.sig" } }, revoked);
      await expect(svc.processWebhook("outer.jws.sig")).rejects.toThrow(/revoked/);
    });

    it("throws when the subscription write fails so Apple retries", async () => {
      const db = mockDB({ upsertSubscription: vi.fn().mockRejectedValue(new Error("db down")) });
      const svc = svcWith(db, { notificationType: "DID_RENEW", data: { signedTransactionInfo: "txn.jws.sig" } }, baseTxn);
      await expect(svc.processWebhook("outer.jws.sig")).rejects.toThrow(ServiceError);
    });

    it("throws when the transaction write fails so Apple retries", async () => {
      const db = mockDB({ storeTransaction: vi.fn().mockRejectedValue(new Error("db down")) });
      const svc = svcWith(db, { notificationType: "DID_RENEW", data: { signedTransactionInfo: "txn.jws.sig" } }, baseTxn);
      await expect(svc.processWebhook("outer.jws.sig")).rejects.toThrow(ServiceError);
    });

    it("calls onNotification with the decoded notification and transaction", async () => {
      const onNotification = vi.fn().mockResolvedValue(undefined);
      const notification = {
        notificationType: "CONSUMPTION_REQUEST",
        notificationUUID: "uuid-1",
        signedDate: 1_760_000_000_000,
        data: { signedTransactionInfo: "txn.jws.sig", environment: "Production" },
      };
      const svc = svcWith(mockDB(), notification, baseTxn, { onNotification });
      await svc.processWebhook("outer.jws.sig");
      expect(onNotification).toHaveBeenCalledWith({
        notification: expect.objectContaining({ notificationUUID: "uuid-1", notificationType: "CONSUMPTION_REQUEST" }),
        transaction: expect.objectContaining({ transactionId: "t1" }),
      });
    });

    it("calls onNotification for TEST notifications without a transaction", async () => {
      const onNotification = vi.fn().mockResolvedValue(undefined);
      const svc = svcWith(mockDB(), { notificationType: "TEST", notificationUUID: "uuid-t" }, null, { onNotification });
      await svc.processWebhook("outer.jws.sig");
      expect(onNotification).toHaveBeenCalledWith({
        notification: expect.objectContaining({ notificationUUID: "uuid-t" }),
        transaction: null,
      });
    });

    it("calls onNotification for a unknown transaction too", async () => {
      const onNotification = vi.fn().mockResolvedValue(undefined);
      const db = mockDB({ userIdByTransactionId: vi.fn().mockResolvedValue("") });
      const svc = svcWith(db, { notificationType: "SUBSCRIBED", data: { signedTransactionInfo: "txn.jws.sig" } }, baseTxn, { onNotification });
      const result = await svc.processWebhook("outer.jws.sig");
      expect(result.status).toBe("unknown_transaction");
      expect(onNotification).toHaveBeenCalledTimes(1);
    });

    it("throws when the user lookup read fails so Apple retries", async () => {
      const db = mockDB({ userIdByTransactionId: vi.fn().mockRejectedValue(new Error("db down")) });
      const svc = svcWith(db, { notificationType: "REFUND", data: { signedTransactionInfo: "txn.jws.sig" } }, revoked);
      const err = await svc.processWebhook("outer.jws.sig").catch((e) => e);
      expect(err).toBeInstanceOf(ServiceError);
      expect(err.code).toBe("INTERNAL");
      expect(db.upsertSubscription).not.toHaveBeenCalled();
    });

    it("throws when onNotification fails so Apple retries", async () => {
      const onNotification = vi.fn().mockRejectedValue(new Error("log down"));
      const db = mockDB();
      const svc = svcWith(db, { notificationType: "DID_RENEW", data: { signedTransactionInfo: "txn.jws.sig" } }, baseTxn, { onNotification });
      await expect(svc.processWebhook("outer.jws.sig")).rejects.toThrow(ServiceError);
      expect(db.upsertSubscription).not.toHaveBeenCalled();
    });
  });

  describe("notificationToStatus", () => {
    // Access the private method via (svc as any) for status mapping tests
    function callNotificationToStatus(
      notifType: string,
      subtype: string,
      txnOverrides: Record<string, unknown> = {}
    ): string {
      const svc = new ReceiptService(mockDB(), {});
      const txn = {
        transactionId: "t1",
        originalTransactionId: "ot1",
        bundleId: "com.test",
        productId: "pro_monthly",
        purchaseDate: Date.now(),
        expiresDate: Date.now() + 86400000,
        type: "Auto-Renewable Subscription",
        inAppOwnershipType: "PURCHASED",
        environment: "Production",
        price: 9990,
        currency: "USD",
        ...txnOverrides,
      };
      return (svc as any).notificationToStatus(notifType, subtype, txn);
    }

    it("maps SUBSCRIBED to trial when offerType is 1", () => {
      expect(callNotificationToStatus("SUBSCRIBED", "", { offerType: 1 })).toBe("trial");
    });

    it("maps SUBSCRIBED to active when no trial offer", () => {
      expect(callNotificationToStatus("SUBSCRIBED", "", {})).toBe("active");
    });

    it("maps EXPIRED to expired", () => {
      expect(callNotificationToStatus("EXPIRED", "", {})).toBe("expired");
    });

    it("maps DID_RENEW to active", () => {
      expect(callNotificationToStatus("DID_RENEW", "", {})).toBe("active");
    });

    it("maps REFUND to refunded", () => {
      expect(callNotificationToStatus("REFUND", "", {})).toBe("refunded");
    });

    it("maps REVOKE to revoked", () => {
      expect(callNotificationToStatus("REVOKE", "", {})).toBe("revoked");
    });

    it("maps DID_FAIL_TO_RENEW with GRACE_PERIOD to grace_period", () => {
      expect(callNotificationToStatus("DID_FAIL_TO_RENEW", "GRACE_PERIOD", {})).toBe("grace_period");
    });

    it("maps DID_FAIL_TO_RENEW without subtype to billing_retry_failed", () => {
      expect(callNotificationToStatus("DID_FAIL_TO_RENEW", "", {})).toBe("billing_retry_failed");
    });

    it("maps PRICE_INCREASE with ACCEPTED to active", () => {
      expect(callNotificationToStatus("PRICE_INCREASE", "ACCEPTED", {})).toBe("active");
    });

    it("maps PRICE_INCREASE without subtype to price_increase_pending", () => {
      expect(callNotificationToStatus("PRICE_INCREASE", "", {})).toBe("price_increase_pending");
    });

    it("maps GRACE_PERIOD_EXPIRED to expired", () => {
      expect(callNotificationToStatus("GRACE_PERIOD_EXPIRED", "", {})).toBe("expired");
    });

    it("maps DID_CHANGE_RENEWAL_STATUS AUTO_RENEW_DISABLED to cancelled", () => {
      expect(callNotificationToStatus("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", {})).toBe("cancelled");
    });

    it("maps DID_CHANGE_RENEWAL_STATUS without subtype to active", () => {
      expect(callNotificationToStatus("DID_CHANGE_RENEWAL_STATUS", "", {})).toBe("active");
    });

    it("maps OFFER_REDEEMED to active", () => {
      expect(callNotificationToStatus("OFFER_REDEEMED", "", {})).toBe("active");
    });

    it("maps RENEWAL_EXTENDED to active", () => {
      expect(callNotificationToStatus("RENEWAL_EXTENDED", "", {})).toBe("active");
    });
  });
});
