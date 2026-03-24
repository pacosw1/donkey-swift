export interface ReceiptDB {
    upsertSubscription(userId: string, productId: string, originalTransactionId: string, status: string, expiresAt: Date | string | null, priceCents: number, currencyCode: string): Promise<void>;
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
    appAccountToken?: string;
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