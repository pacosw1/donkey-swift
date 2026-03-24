import * as jose from "jose";
import { X509Certificate } from "node:crypto";
import { ValidationError, ServiceError } from "../errors/index.js";
// ── Apple Root CA ───────────────────────────────────────────────────────────
const APPLE_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;
// ── Service ─────────────────────────────────────────────────────────────────
export class ReceiptService {
    db;
    cfg;
    constructor(db, cfg) {
        this.db = db;
        this.cfg = cfg;
    }
    async verifyReceipt(userId, transactionJWS) {
        if (!userId)
            throw new ValidationError("unauthorized");
        if (!transactionJWS)
            throw new ValidationError("transaction is required");
        let txn;
        try {
            txn = await this.verifyAndParseTransaction(transactionJWS);
        }
        catch (err) {
            console.log(`[receipt] verification failed for user ${userId}: ${err}`);
            throw new ValidationError("transaction verification failed");
        }
        const validationErr = this.validateTransaction(txn);
        if (validationErr)
            throw new ValidationError(validationErr);
        const status = this.transactionToStatus(txn);
        const expiresAt = txn.expiresDate ? new Date(txn.expiresDate) : null;
        const currency = txn.currency || "USD";
        const priceCents = this.cfg.priceToCents
            ? this.cfg.priceToCents(txn.price, currency)
            : Math.round(txn.price * 100);
        try {
            await this.db.upsertSubscription(userId, txn.productId, txn.originalTransactionId, status, expiresAt, priceCents, currency);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to update subscription");
        }
        await this.db.storeTransaction({
            transaction_id: txn.transactionId,
            original_transaction_id: txn.originalTransactionId,
            user_id: userId,
            product_id: txn.productId,
            status,
            purchase_date: new Date(txn.purchaseDate),
            expires_date: expiresAt,
            environment: txn.environment,
            price_cents: priceCents,
            currency_code: currency,
        }).catch((err) => console.log(`[receipt] failed to store audit: ${err}`));
        return {
            verified: true,
            status,
            product_id: txn.productId,
            transaction_id: txn.transactionId,
            expires_at: expiresAt,
        };
    }
    async processWebhook(signedPayload) {
        if (!signedPayload)
            throw new ValidationError("invalid webhook payload");
        let notificationPayload;
        try {
            notificationPayload = await this.verifyAndDecodePayload(signedPayload);
        }
        catch (err) {
            console.log(`[receipt] webhook JWS verification failed: ${err}`);
            throw new ValidationError("invalid signature");
        }
        let notification;
        try {
            notification = JSON.parse(notificationPayload);
        }
        catch {
            throw new ValidationError("malformed notification payload");
        }
        console.log(`[receipt] webhook: type=${notification.notificationType} subtype=${notification.subtype} env=${notification.data?.environment}`);
        if (notification.notificationType === "TEST") {
            return { status: "ok" };
        }
        if (!notification.data?.signedTransactionInfo) {
            throw new ValidationError("missing signed transaction info");
        }
        let txn;
        try {
            txn = await this.verifyAndParseTransaction(notification.data.signedTransactionInfo);
        }
        catch (err) {
            console.log(`[receipt] webhook transaction verification failed: ${err}`);
            throw new ValidationError("invalid transaction signature");
        }
        const validationErr = this.validateTransaction(txn);
        if (validationErr)
            throw new ValidationError(validationErr);
        let userId = await this.db.userIdByTransactionId(txn.originalTransactionId).catch(() => "");
        if (!userId && txn.appAccountToken)
            userId = txn.appAccountToken;
        if (!userId) {
            console.log(`[receipt] webhook: unknown transaction ${txn.originalTransactionId}`);
            return { status: "unknown_transaction" };
        }
        const notifType = notification.notificationType ?? "";
        const notifSubtype = notification.subtype ?? "";
        const status = this.notificationToStatus(notifType, notifSubtype, txn);
        const expiresAt = txn.expiresDate ? new Date(txn.expiresDate) : null;
        const currency = txn.currency || "USD";
        const priceCents = this.cfg.priceToCents
            ? this.cfg.priceToCents(txn.price, currency)
            : Math.round(txn.price * 100);
        await this.db.upsertSubscription(userId, txn.productId, txn.originalTransactionId, status, expiresAt, priceCents, currency)
            .catch((err) => console.log(`[receipt] webhook subscription update failed: ${err}`));
        await this.db.storeTransaction({
            transaction_id: txn.transactionId,
            original_transaction_id: txn.originalTransactionId,
            user_id: userId,
            product_id: txn.productId,
            status,
            purchase_date: new Date(txn.purchaseDate),
            expires_date: expiresAt,
            environment: txn.environment,
            price_cents: priceCents,
            currency_code: currency,
            notification_type: notifType || undefined,
        }).catch((err) => console.log(`[receipt] failed to store audit: ${err}`));
        return { status: "ok" };
    }
    // ── JWS Verification ────────────────────────────────────────────────────
    async verifyAndDecodePayload(jwsString) {
        const parts = jwsString.split(".");
        if (parts.length !== 3)
            throw new Error("invalid JWS format");
        // Decode header to get x5c chain
        const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
        const x5c = header.x5c;
        if (!x5c?.length || x5c.length < 2)
            throw new Error("missing x5c header");
        // Verify cert chain against Apple Root CA
        const leafCert = new X509Certificate(Buffer.from(x5c[0], "base64"));
        const rootCert = new X509Certificate(APPLE_ROOT_CA_PEM);
        // Build intermediate chain and verify full chain: leaf → intermediate(s) → root
        const intermediates = x5c.slice(1).map((c) => new X509Certificate(Buffer.from(c, "base64")));
        if (intermediates.length > 0) {
            // Verify leaf cert was signed by first intermediate
            if (!leafCert.verify(intermediates[0].publicKey)) {
                throw new Error("leaf certificate verification failed");
            }
            // Verify each intermediate was signed by the next
            for (let i = 0; i < intermediates.length - 1; i++) {
                if (!intermediates[i].verify(intermediates[i + 1].publicKey)) {
                    throw new Error("intermediate certificate chain verification failed");
                }
            }
            // Verify last intermediate was signed by Apple Root CA
            if (!intermediates[intermediates.length - 1].verify(rootCert.publicKey)) {
                throw new Error("root certificate chain verification failed");
            }
        }
        // Verify JWS signature using leaf cert public key
        const publicKey = await jose.importX509(`-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`, "ES256");
        const { payload } = await jose.compactVerify(jwsString, publicKey);
        return new TextDecoder().decode(payload);
    }
    async verifyAndParseTransaction(jwsString) {
        const payload = await this.verifyAndDecodePayload(jwsString);
        return JSON.parse(payload);
    }
    validateTransaction(txn) {
        if (!txn.transactionId || !txn.originalTransactionId)
            return "missing transaction ID";
        if (!txn.productId)
            return "missing product ID";
        if (this.cfg.bundleId && txn.bundleId !== this.cfg.bundleId) {
            return `bundle ID mismatch: got "${txn.bundleId}", expected "${this.cfg.bundleId}"`;
        }
        if (this.cfg.environment && txn.environment !== this.cfg.environment) {
            return `environment mismatch: got "${txn.environment}", expected "${this.cfg.environment}"`;
        }
        if (txn.revocationDate && txn.revocationDate > 0)
            return "transaction has been revoked";
        return null;
    }
    transactionToStatus(txn) {
        if (txn.type !== "Auto-Renewable Subscription")
            return "active";
        if (txn.offerType === 1)
            return "trial";
        if (txn.expiresDate > 0 && new Date(txn.expiresDate) < new Date())
            return "expired";
        return "active";
    }
    notificationToStatus(notifType, subtype, txn) {
        switch (notifType) {
            case "SUBSCRIBED": return txn.offerType === 1 ? "trial" : "active";
            case "DID_RENEW": return "active";
            case "EXPIRED": return "expired";
            case "REFUND": return "refunded";
            case "REVOKE": return "revoked";
            case "DID_CHANGE_RENEWAL_STATUS": return subtype === "AUTO_RENEW_DISABLED" ? "cancelled" : "active";
            case "DID_FAIL_TO_RENEW": return subtype === "GRACE_PERIOD" ? "grace_period" : "billing_retry_failed";
            case "GRACE_PERIOD_EXPIRED": return "expired";
            case "OFFER_REDEEMED": return "active";
            case "PRICE_INCREASE": return subtype === "ACCEPTED" ? "active" : "price_increase_pending";
            case "RENEWAL_EXTENDED": return "active";
            case "REFUND_DECLINED": return "active";
            case "REFUND_REVERSED": return "active";
            default: return this.transactionToStatus(txn);
        }
    }
}
// ── Subscription Status Constants ───────────────────────────────────────────
export const SUBSCRIPTION_STATUSES = [
    "active",
    "expired",
    "cancelled",
    "trial",
    "free",
    "refunded",
    "revoked",
    "grace_period",
    "billing_retry_failed",
    "price_increase_pending",
];
//# sourceMappingURL=index.js.map