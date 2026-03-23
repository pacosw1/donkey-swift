import { eq, sql } from "drizzle-orm";
import type { ReceiptDB, VerifiedTransaction } from "../receipt/index.js";
import type { DrizzleDB } from "./index.js";
import { userSubscriptions, verifiedTransactions } from "./schema.js";

/** Mixin: adds ReceiptDB methods to PostgresDB. */
export function withReceiptDB(db: DrizzleDB): ReceiptDB {
  return {
    async upsertSubscription(
      userId: string,
      productId: string,
      originalTransactionId: string,
      status: string,
      expiresAt: Date | null,
      priceCents: number,
      currencyCode: string
    ): Promise<void> {
      await db
        .insert(userSubscriptions)
        .values({
          userId,
          productId,
          originalTransactionId,
          status,
          expiresAt,
          priceCents,
          currencyCode,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userSubscriptions.userId,
          set: {
            productId,
            originalTransactionId,
            status,
            expiresAt,
            priceCents,
            currencyCode,
            updatedAt: new Date(),
          },
        });
    },

    async userIdByTransactionId(originalTransactionId: string): Promise<string> {
      // Try user_subscriptions first
      const [subRow] = await db
        .select({ userId: userSubscriptions.userId })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.originalTransactionId, originalTransactionId))
        .limit(1);

      if (subRow) return subRow.userId;

      // Fall back to verified_transactions
      const [txRow] = await db
        .select({ userId: verifiedTransactions.userId })
        .from(verifiedTransactions)
        .where(eq(verifiedTransactions.originalTransactionId, originalTransactionId))
        .limit(1);

      return txRow?.userId ?? "";
    },

    async storeTransaction(t: VerifiedTransaction): Promise<void> {
      await db
        .insert(verifiedTransactions)
        .values({
          transactionId: t.transaction_id,
          originalTransactionId: t.original_transaction_id,
          userId: t.user_id,
          productId: t.product_id,
          status: t.status,
          purchaseDate: t.purchase_date,
          expiresDate: t.expires_date,
          environment: t.environment,
          priceCents: t.price_cents,
          currencyCode: t.currency_code,
          notificationType: t.notification_type ?? "",
        })
        .onConflictDoUpdate({
          target: verifiedTransactions.transactionId,
          set: {
            originalTransactionId: t.original_transaction_id,
            userId: t.user_id,
            productId: t.product_id,
            status: t.status,
            purchaseDate: t.purchase_date,
            expiresDate: t.expires_date,
            environment: t.environment,
            priceCents: t.price_cents,
            currencyCode: t.currency_code,
            notificationType: t.notification_type ?? "",
          },
        });
    },
  };
}
