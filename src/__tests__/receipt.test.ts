import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { ReceiptService, type ReceiptDB, type ReceiptConfig } from "../receipt/index.js";

function mockDB(overrides: Partial<ReceiptDB> = {}): ReceiptDB {
  return {
    upsertSubscription: vi.fn().mockResolvedValue(undefined),
    userIdByTransactionId: vi.fn().mockResolvedValue("user-1"),
    storeTransaction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildApp(db: ReceiptDB, cfg: ReceiptConfig = {}) {
  const svc = new ReceiptService(db, cfg);
  const a = new Hono();

  // Authenticated route
  const authed = new Hono();
  authed.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  authed.post("/receipt/verify", svc.handleVerifyReceipt);

  // Unauthenticated route (webhook has no auth)
  a.route("/", authed);
  a.post("/receipt/webhook", svc.handleWebhook);

  return { app: a, svc };
}

function buildUnauthApp(db: ReceiptDB, cfg: ReceiptConfig = {}) {
  const svc = new ReceiptService(db, cfg);
  const a = new Hono();
  // No userId set -- simulates unauthenticated request
  a.post("/receipt/verify", svc.handleVerifyReceipt);
  return { app: a, svc };
}

describe("ReceiptService", () => {
  describe("handleVerifyReceipt", () => {
    it("rejects missing transaction (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/receipt/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("transaction is required");
    });

    it("rejects unauthorized (no userId)", async () => {
      const { app } = buildUnauthApp(mockDB());
      const res = await app.request("/receipt/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: "fake.jws.token" }),
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain("unauthorized");
    });
  });

  describe("handleWebhook", () => {
    it("rejects missing signedPayload (400)", async () => {
      const { app } = buildApp(mockDB());
      const res = await app.request("/receipt/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("invalid webhook payload");
    });

    it("handles TEST notification type", async () => {
      const db = mockDB();
      const { svc, app } = buildApp(db);

      // Mock the private JWS verification to return a TEST notification payload
      vi.spyOn(svc as any, "verifyAndDecodePayload").mockResolvedValue(
        JSON.stringify({ notificationType: "TEST" })
      );

      const res = await app.request("/receipt/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedPayload: "fake.jws.token" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("ok");

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
