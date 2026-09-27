export interface ReceiptDB {
    upsertSubscription(userId: string, productId: string, originalTransactionId: string, status: string, expiresAt: Date | string | null, priceCents: number, currencyCode: string): Promise<void>;
    /**
     * Resolves "" when no user owns the transaction. Throw only for a read
     * failure: processWebhook then fails so Apple retries the notification.
     */
    userIdByTransactionId(originalTransactionId: string): Promise<string>;
    storeTransaction(t: VerifiedTransaction): Promise<void>;
}
export interface TransactionInfo {
    transactionId: string;
    originalTransactionId: string;
    bundleId: string;
    productId: string;
    purchaseDate: number;
    expiresDate: number;
    type: string;
    inAppOwnershipType: string;
    environment: string;
    price: number;
    currency: string;
    offerType?: number;
    revocationDate?: number;
    revocationReason?: number;
    appAccountToken?: string;
}
/** A decoded App Store Server Notification V2 payload. Unknown keys are kept. */
export interface DecodedNotification {
    notificationType?: string;
    subtype?: string;
    notificationUUID?: string;
    signedDate?: number;
    data?: {
        signedTransactionInfo?: string;
        signedRenewalInfo?: string;
        environment?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export interface NotificationEvent {
    notification: DecodedNotification;
    /** The decoded transaction, or null when the notification carries none (for example TEST). */
    transaction: TransactionInfo | null;
}
export interface VerifiedTransaction {
    transaction_id: string;
    original_transaction_id: string;
    user_id: string;
    product_id: string;
    status: string;
    purchase_date: Date | string;
    expires_date: Date | string | null;
    environment: string;
    price_cents: number;
    currency_code: string;
    notification_type?: string;
}
export interface VerifyResponse {
    verified: boolean;
    status: string;
    product_id: string;
    transaction_id: string;
    expires_at: Date | null;
}
export interface ReceiptConfig {
    bundleId?: string;
    environment?: string;
    priceToCents?: (priceMilliunits: number, currency: string) => number;
    /**
     * Called for every verified webhook notification, before any status is
     * written. Use it for an append-only notification log. If it throws, the
     * webhook throws too, so the route returns an error and Apple retries.
     */
    onNotification?: (event: NotificationEvent) => Promise<void>;
}
export declare class ReceiptService {
    private db;
    private cfg;
    constructor(db: ReceiptDB, cfg: ReceiptConfig);
    verifyReceipt(userId: string, transactionJWS: string): Promise<VerifyResponse>;
    processWebhook(signedPayload: string): Promise<{
        status: string;
    }>;
    private verifyAndDecodePayload;
    private verifyAndParseTransaction;
    private validateTransaction;
    private transactionToStatus;
    private notificationToStatus;
}
export declare const SUBSCRIPTION_STATUSES: readonly ["active", "expired", "cancelled", "trial", "free", "refunded", "revoked", "grace_period", "billing_retry_failed", "price_increase_pending"];
export type SubscriptionStatus = typeof SUBSCRIPTION_STATUSES[number];
//# sourceMappingURL=index.d.ts.map