import * as jose from "jose";
import { readFile } from "node:fs/promises";

// ── Config ──────────────────────────────────────────────────────────────────

export interface AppStoreConfig {
  /** Private key (.p8 file) for App Store Connect API. Path or PEM string. */
  privateKey: string;
  /** Key ID from App Store Connect. */
  keyId: string;
  /** Issuer ID from App Store Connect (your team's UUID). */
  issuerId: string;
  /** Your app's bundle ID. */
  bundleId: string;
  /** "sandbox" or "production" (default: "production"). */
  environment?: "sandbox" | "production";
}

// ── Response Types ──────────────────────────────────────────────────────────

export interface TransactionHistoryResponse {
  signedTransactions: string[];
  revision: string;
  hasMore: boolean;
  bundleId: string;
  environment: string;
}

export interface SubscriptionStatusResponse {
  data: SubscriptionGroupStatus[];
  bundleId: string;
  environment: string;
}

export interface SubscriptionGroupStatus {
  subscriptionGroupIdentifier: string;
  lastTransactions: LastTransaction[];
}

export interface LastTransaction {
  originalTransactionId: string;
  status: number;
  signedTransactionInfo: string;
  signedRenewalInfo: string;
}

export interface NotificationHistoryResponse {
  notificationHistory: NotificationHistoryEntry[];
  hasMore: boolean;
  paginationToken?: string;
}

export interface NotificationHistoryEntry {
  signedPayload: string;
  sendAttempts: SendAttempt[];
}

export interface SendAttempt {
  attemptDate: number;
  sendAttemptResult: string;
}

export interface OrderLookupResponse {
  status: number;
  signedTransactions: string[];
}

export interface ExtendSubscriptionResponse {
  requestIdentifier: string;
}

export interface MassExtendResponse {
  requestIdentifier: string;
}

/** StoreKit 2 subscription status codes. */
export const SUBSCRIPTION_STATUS_CODES = {
  1: "active",
  2: "expired",
  3: "billing_retry",
  4: "grace_period",
  5: "revoked",
} as const;

// ── Client ──────────────────────────────────────────────────────────────────

export class AppStoreServerClient {
  private key: CryptoKey | null = null;
  private keyId: string;
  private issuerId: string;
  private bundleId: string;
  private baseUrl: string;
  private privateKeySource: string;
  private cachedToken: string | null = null;
  private tokenExpiry = 0;

  constructor(private cfg: AppStoreConfig) {
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

  private async getKey(): Promise<CryptoKey> {
    if (this.key) return this.key;
    let keyData = this.privateKeySource;
    if (!keyData.includes("-----BEGIN")) {
      keyData = await readFile(keyData, "utf-8");
    }
    this.key = (await jose.importPKCS8(keyData, "ES256")) as CryptoKey;
    return this.key;
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiry) return this.cachedToken;

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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
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

    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }

  // ── Transaction History ──────────────────────────────────────────────────

  /**
   * Get a customer's transaction history.
   * Returns signed transactions that you can verify and decode.
   */
  async getTransactionHistory(
    transactionId: string,
    opts?: { revision?: string; sort?: "ASCENDING" | "DESCENDING"; productTypes?: string[] }
  ): Promise<TransactionHistoryResponse> {
    const params = new URLSearchParams();
    if (opts?.revision) params.set("revision", opts.revision);
    if (opts?.sort) params.set("sort", opts.sort);
    if (opts?.productTypes) opts.productTypes.forEach((t) => params.append("productType", t));
    const qs = params.toString() ? `?${params}` : "";
    return this.request("GET", `/inApps/v1/history/${transactionId}${qs}`);
  }

  /**
   * Get all pages of transaction history.
   */
  async getAllTransactionHistory(
    transactionId: string,
    opts?: { sort?: "ASCENDING" | "DESCENDING"; productTypes?: string[] }
  ): Promise<string[]> {
    const allTransactions: string[] = [];
    let revision: string | undefined;
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
  async getSubscriptionStatuses(transactionId: string): Promise<SubscriptionStatusResponse> {
    return this.request("GET", `/inApps/v1/subscriptions/${transactionId}`);
  }

  // ── Extend Subscription ──────────────────────────────────────────────────

  /**
   * Extend a subscription renewal date for a specific user.
   */
  async extendSubscription(
    originalTransactionId: string,
    extendByDays: number,
    extendReasonCode: 0 | 1 | 2 | 3,
    requestIdentifier: string
  ): Promise<ExtendSubscriptionResponse> {
    return this.request("PUT", `/inApps/v1/subscriptions/extend/${originalTransactionId}`, {
      extendByDays,
      extendReasonCode,
      requestIdentifier,
    });
  }

  /**
   * Extend subscriptions for all eligible users of a product.
   */
  async massExtendSubscriptions(
    productId: string,
    extendByDays: number,
    extendReasonCode: 0 | 1 | 2 | 3,
    requestIdentifier: string
  ): Promise<MassExtendResponse> {
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
  async getNotificationHistory(
    startDate: Date,
    endDate: Date,
    opts?: { paginationToken?: string; notificationType?: string; notificationSubtype?: string }
  ): Promise<NotificationHistoryResponse> {
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
  async lookupOrder(orderId: string): Promise<OrderLookupResponse> {
    return this.request("GET", `/inApps/v1/lookup/${orderId}`);
  }

  // ── Request Test Notification ──────────────────────────────────────────────

  /**
   * Request a test notification from Apple. Useful for verifying your webhook endpoint.
   */
  async requestTestNotification(): Promise<{ testNotificationToken: string }> {
    return this.request("POST", "/inApps/v1/notifications/test");
  }

  /**
   * Check the status of a test notification.
   */
  async getTestNotificationStatus(testNotificationToken: string): Promise<{
    signedPayload: string;
    sendAttempts: SendAttempt[];
  }> {
    return this.request("GET", `/inApps/v1/notifications/test/${testNotificationToken}`);
  }
}

// ── Error ───────────────────────────────────────────────────────────────────

export class AppStoreError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string
  ) {
    super(`App Store API error ${statusCode}: ${body}`);
    this.name = "AppStoreError";
  }
}
