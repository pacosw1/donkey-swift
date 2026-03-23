import { eq, and, sql } from "drizzle-orm";
import type { FlagsDB, Flag } from "../flags/index.js";
import type { DrizzleDB } from "./index.js";
import { featureFlags, featureFlagOverrides } from "./schema.js";

/** Mixin: adds FlagsDB methods to PostgresDB. */
export function withFlagsDB(db: DrizzleDB): FlagsDB {
  return {
    async upsertFlag(flag: Flag): Promise<void> {
      await db
        .insert(featureFlags)
        .values({
          key: flag.key,
          enabled: flag.enabled,
          rolloutPct: flag.rollout_pct,
          description: flag.description,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: {
            enabled: flag.enabled,
            rolloutPct: flag.rollout_pct,
            description: flag.description,
            updatedAt: new Date(),
          },
        });
    },

    async getFlag(key: string): Promise<Flag | null> {
      const [row] = await db
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.key, key))
        .limit(1);

      if (!row) return null;
      return {
        key: row.key,
        enabled: row.enabled,
        rollout_pct: row.rolloutPct,
        description: row.description,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      };
    },

    async listFlags(): Promise<Flag[]> {
      const rows = await db
        .select()
        .from(featureFlags)
        .orderBy(featureFlags.key);

      return rows.map((r) => ({
        key: r.key,
        enabled: r.enabled,
        rollout_pct: r.rolloutPct,
        description: r.description,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      }));
    },

    async deleteFlag(key: string): Promise<void> {
      await db.delete(featureFlagOverrides).where(eq(featureFlagOverrides.flagKey, key));
      await db.delete(featureFlags).where(eq(featureFlags.key, key));
    },

    async getUserOverride(key: string, userId: string): Promise<boolean | null> {
      const [row] = await db
        .select({ enabled: featureFlagOverrides.enabled })
        .from(featureFlagOverrides)
        .where(and(eq(featureFlagOverrides.flagKey, key), eq(featureFlagOverrides.userId, userId)))
        .limit(1);

      return row?.enabled ?? null;
    },

    async setUserOverride(key: string, userId: string, enabled: boolean): Promise<void> {
      await db
        .insert(featureFlagOverrides)
        .values({ flagKey: key, userId, enabled })
        .onConflictDoUpdate({
          target: [featureFlagOverrides.flagKey, featureFlagOverrides.userId],
          set: { enabled },
        });
    },

    async deleteUserOverride(key: string, userId: string): Promise<void> {
      await db
        .delete(featureFlagOverrides)
        .where(and(eq(featureFlagOverrides.flagKey, key), eq(featureFlagOverrides.userId, userId)));
    },
  };
}
