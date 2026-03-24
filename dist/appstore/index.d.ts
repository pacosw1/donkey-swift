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
export declare const SUBSCRIPTION_STATUS_CODES: {
    readonly 1: "active";
    readonly 2: "expired";
    readonly 3: "billing_retry";
    readonly 4: "grace_period";
    readonly 5: "revoked";
};
export declare class AppStoreServerClient {
    private cfg;
    private key;
    private keyId;
    private issuerId;
    private bundleId;
    private baseUrl;
    private privateKeySource;
    private cachedToken;
    private tokenExpiry;
    constructor(cfg: AppStoreConfig);
    private getKey;
    private getToken;
    private request;
    /**
     * Get a customer's transaction history.
     * Returns signed transactions that you can verify and decode.
     */
    getTransactionHistory(transactionId: string, opts?: {
        revision?: string;
        sort?: "ASCENDING" | "DESCENDING";
        productTypes?: string[];
    }): Promise<TransactionHistoryResponse>;
    /**
     * Get all pages of transaction history.
     */
    getAllTransactionHistory(transactionId: string, opts?: {
        sort?: "ASCENDING" | "DESCENDING";
        productTypes?: string[];
    }): Promise<string[]>;
    /**
     * Get the status of all subscriptions for a customer.
     * Returns grouped by subscription group with the latest transaction info.
     */
    getSubscriptionStatuses(transactionId: string): Promise<SubscriptionStatusResponse>;
    /**
     * Extend a subscription renewal date for a specific user.
     */
    extendSubscription(originalTransactionId: string, extendByDays: number, extendReasonCode: 0 | 1 | 2 | 3, requestIdentifier: string): Promise<ExtendSubscriptionResponse>;
    /**
     * Extend subscriptions for all eligible users of a product.
     */
    massExtendSubscriptions(productId: string, extendByDays: number, extendReasonCode: 0 | 1 | 2 | 3, requestIdentifier: string): Promise<MassExtendResponse>;
    /**
     * Request notification history replay. Use after server downtime to catch up on missed webhooks.
     */
    getNotificationHistory(startDate: Date, endDate: Date, opts?: {
        paginationToken?: string;
        notificationType?: string;
        notificationSubtype?: string;
    }): Promise<NotificationHistoryResponse>;
    /**
     * Look up an order by order ID (from a customer's receipt email).
     */
    lookupOrder(orderId: string): Promise<OrderLookupResponse>;
    /**
     * Request a test notification from Apple. Useful for verifying your webhook endpoint.
     */
    requestTestNotification(): Promise<{
        testNotificationToken: string;
    }>;
    /**
     * Check the status of a test notification.
     */
    getTestNotificationStatus(testNotificationToken: string): Promise<{
        signedPayload: string;
        sendAttempts: SendAttempt[];
    }>;
}
export declare class AppStoreError extends Error {
    readonly statusCode: number;
    readonly body: string;
    constructor(statusCode: number, body: string);
}
//# sourceMappingURL=index.d.ts.map