import type { Context } from "hono";
export interface ReceiptDB {
    upsertSubscription(userId: string, productId: string, originalTransactionId: string, status: string, expiresAt: Date | null, priceCents: number, currencyCode: string): Promise<void>;
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
    purchase_date: Date;
    expires_date: Date | null;
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
    /** POST /api/v1/receipt/verify */
    handleVerifyReceipt: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 401, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        verified: true;
        status: string;
        product_id: string;
        transaction_id: string;
        expires_at: string | null;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /api/v1/receipt/webhook (no auth - Apple calls directly) */
    handleWebhook: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    private verifyAndDecodePayload;
    private verifyAndParseTransaction;
    private validateTransaction;
    private transactionToStatus;
    private notificationToStatus;
}
//# sourceMappingURL=index.d.ts.map