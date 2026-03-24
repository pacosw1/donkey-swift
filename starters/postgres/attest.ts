import { eq, and, gt, lt } from "drizzle-orm";
import type { AttestDB } from "../attest/index.js";
import type { DrizzleDB } from "./index.js";
import { userAttestKeys, attestChallenges } from "./schema.js";

/** Mixin: adds AttestDB methods to PostgresDB. */
export function withAttestDB(db: DrizzleDB): AttestDB {
  return {
    async storeAttestKey(userId: string, keyId: string, publicKey: string): Promise<void> {
      await db
        .insert(userAttestKeys)
        .values({ userId, keyId, publicKey })
        .onConflictDoUpdate({
          target: userAttestKeys.userId,
          set: { keyId, publicKey },
        });
    },

    async getAttestKey(userId: string): Promise<{ keyId: string; publicKey: string }> {
      const [row] = await db
        .select({ keyId: userAttestKeys.keyId, publicKey: userAttestKeys.publicKey })
        .from(userAttestKeys)
        .where(eq(userAttestKeys.userId, userId))
        .limit(1);

      if (!row) throw new Error("no attest key found");
      return row;
    },

    async storeChallenge(nonce: string, userId: string, expiresAt: Date): Promise<void> {
      await db
        .insert(attestChallenges)
        .values({ nonce, userId, expiresAt });
    },

    async consumeChallenge(nonce: string, userId: string): Promise<boolean> {
      // Delete expired challenges opportunistically
      await db
        .delete(attestChallenges)
        .where(lt(attestChallenges.expiresAt, new Date()))
        .catch(() => {});

      // Find and consume the challenge in one operation
      const deleted = await db
        .delete(attestChallenges)
        .where(
          and(
            eq(attestChallenges.nonce, nonce),
            eq(attestChallenges.userId, userId),
            gt(attestChallenges.expiresAt, new Date()),
          )
        )
        .returning({ nonce: attestChallenges.nonce });

      return deleted.length > 0;
    },
  };
}
