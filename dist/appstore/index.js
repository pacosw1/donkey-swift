import * as jose from "jose";
import { readFile } from "node:fs/promises";
/** StoreKit 2 subscription status codes. */
export const SUBSCRIPTION_STATUS_CODES = {
    1: "active",
    2: "expired",
    3: "billing_retry",
    4: "grace_period",
    5: "revoked",
};
// ── Client ──────────────────────────────────────────────────────────────────
export class AppStoreServerClient {
    cfg;
    key = null;
    keyId;
    issuerId;
    bundleId;
    baseUrl;
    privateKeySource;
    cachedToken = null;
    tokenExpiry = 0;
    constructor(cfg) {
        this.cfg = cfg;
        this.keyId = cfg.keyId;
        this.issuerId = cfg.issuerId;
        this.bundleId = cfg.bundleId;
        this.privateKeySource = cfg.privateKey;
        this.baseUrl =
            cfg.environment === "sandbox"
                ? "https://api.storekit-sandbox.itunes.apple.com"
                : "https://api.storekit.itunes.apple.com";
    }
    // ── Auth ────────────────────────────────────────────────────────────────
    async getKey() {
        if (this.key)
            return this.key;
        let keyData = this.privateKeySource;
        if (!keyData.includes("-----BEGIN")) {
            keyData = await readFile(keyData, "utf-8");
        }
        this.key = (await jose.importPKCS8(keyData, "ES256"));
        return this.key;
    }
    async getToken() {
        if (this.cachedToken && Date.now() < this.tokenExpiry)
            return this.cachedToken;
        const key = await this.getKey();
        const token = await new jose.SignJWT({ bid: this.bundleId })
            .setProtectedHeader({ alg: "ES256", kid: this.keyId, typ: "JWT" })
            .setIssuer(this.issuerId)
            .setIssuedAt()
            .setExpirationTime("1h")
            .setAudience("appstoreconnect-v1")
            .sign(key);
        this.cachedToken = token;
        this.tokenExpiry = Date.now() + 50 * 60 * 1000; // refresh at 50min
        return token;
    }
    async request(method, path, body) {
        const token = await this.getToken();
        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new AppStoreError(res.status, text);
        }
        if (res.status === 204)
            return {};
        return (await res.json());
    }
    // ── Transaction History ──────────────────────────────────────────────────
    /**
     * Get a customer's transaction history.
     * Returns signed transactions that you can verify and decode.
     */
    async getTransactionHistory(transactionId, opts) {
        const params = new URLSearchParams();
        if (opts?.revision)
            params.set("revision", opts.revision);
        if (opts?.sort)
            params.set("sort", opts.sort);
        if (opts?.productTypes)
            opts.productTypes.forEach((t) => params.append("productType", t));
        const qs = params.toString() ? `?${params}` : "";
        return this.request("GET", `/inApps/v1/history/${transactionId}${qs}`);
    }
    /**
     * Get all pages of transaction history.
     */
    async getAllTransactionHistory(transactionId, opts) {
        const allTransactions = [];
        let revision;
        let hasMore = true;
        while (hasMore) {
            const res = await this.getTransactionHistory(transactionId, { ...opts, revision });
            allTransactions.push(...res.signedTransactions);
            hasMore = res.hasMore;
            revision = res.revision;
        }
        return allTransactions;
    }
    // ── Subscription Status ──────────────────────────────────────────────────
    /**
     * Get the status of all subscriptions for a customer.
     * Returns grouped by subscription group with the latest transaction info.
     */
    async getSubscriptionStatuses(transactionId) {
        return this.request("GET", `/inApps/v1/subscriptions/${transactionId}`);
    }
    // ── Extend Subscription ──────────────────────────────────────────────────
    /**
     * Extend a subscription renewal date for a specific user.
     */
    async extendSubscription(originalTransactionId, extendByDays, extendReasonCode, requestIdentifier) {
        return this.request("PUT", `/inApps/v1/subscriptions/extend/${originalTransactionId}`, {
            extendByDays,
            extendReasonCode,
            requestIdentifier,
        });
    }
    /**
     * Extend subscriptions for all eligible users of a product.
     */
    async massExtendSubscriptions(productId, extendByDays, extendReasonCode, requestIdentifier) {
        return this.request("POST", "/inApps/v1/subscriptions/extend/mass", {
            productId,
            extendByDays,
            extendReasonCode,
            requestIdentifier,
        });
    }
    // ── Notification History ──────────────────────────────────────────────────
    /**
     * Request notification history replay. Use after server downtime to catch up on missed webhooks.
     */
    async getNotificationHistory(startDate, endDate, opts) {
        return this.request("POST", "/inApps/v1/notifications/history", {
            startDate: startDate.getTime(),
            endDate: endDate.getTime(),
            ...(opts?.paginationToken ? { paginationToken: opts.paginationToken } : {}),
            ...(opts?.notificationType ? { notificationType: opts.notificationType } : {}),
            ...(opts?.notificationSubtype ? { notificationSubtype: opts.notificationSubtype } : {}),
        });
    }
    // ── Order Lookup ───────────────────────────────────────────────────────────
    /**
     * Look up an order by order ID (from a customer's receipt email).
     */
    async lookupOrder(orderId) {
        return this.request("GET", `/inApps/v1/lookup/${orderId}`);
    }
    // ── Request Test Notification ──────────────────────────────────────────────
    /**
     * Request a test notification from Apple. Useful for verifying your webhook endpoint.
     */
    async requestTestNotification() {
        return this.request("POST", "/inApps/v1/notifications/test");
    }
    /**
     * Check the status of a test notification.
     */
    async getTestNotificationStatus(testNotificationToken) {
        return this.request("GET", `/inApps/v1/notifications/test/${testNotificationToken}`);
    }
}
// ── Error ───────────────────────────────────────────────────────────────────
export class AppStoreError extends Error {
    statusCode;
    body;
    constructor(statusCode, body) {
        super(`App Store API error ${statusCode}: ${body}`);
        this.statusCode = statusCode;
        this.body = body;
        this.name = "AppStoreError";
    }
}
//# sourceMappingURL=index.js.map