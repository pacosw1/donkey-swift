import { describe, it, expect, vi } from "vitest";
import { ReceiptService, type ReceiptDB, type ReceiptConfig } from "../receipt/index.js";
import { ValidationError } from "../errors/index.js";

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
    it("rejects missing transaction", async () => {
      const svc = new ReceiptService(mockDB(), {});
      await expect(svc.verifyReceipt("user-1", ""))
        .rejects.toThrow(ValidationError);
    });

    it("rejects unauthorized (no userId)", async () => {
      const svc = new ReceiptService(mockDB(), {});
      await expect(svc.verifyReceipt("", "fake.jws.token"))
        .rejects.toThrow(ValidationError);
    });
  });

  describe("processWebhook", () => {
    it("rejects missing signedPayload", async () => {
      const svc = new ReceiptService(mockDB(), {});
      await expect(svc.processWebhook(""))
        .rejects.toThrow(ValidationError);
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
  });

  describe("notificationToStatus", () => {
    // Access the private method via prototype for status mapping tests
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
