import { eq, and, inArray } from "drizzle-orm";
import type { FlagsDB, Flag, FlagJsonValue, FlagRule, Variant } from "../../src/flags/index.js";
import type { DrizzleDB } from "./index.js";
import { featureFlags, featureFlagOverrides } from "./schema.js";

type FlagRow = typeof featureFlags.$inferSelect;

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
          value: flag.value ?? null,
          valueType: flag.value_type ?? "boolean",
          defaultValue: (flag.default_value ?? false) as unknown as Record<string, unknown>,
          rules: (flag.rules ?? []) as unknown as Record<string, unknown>,
          variants: (flag.variants ?? null) as unknown as Record<string, unknown> | null,
          createdAt: flag.created_at ?? new Date(),
          updatedAt: flag.updated_at ?? new Date(),
        })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: {
            enabled: flag.enabled,
            rolloutPct: flag.rollout_pct,
            description: flag.description,
            value: flag.value ?? null,
            valueType: flag.value_type ?? "boolean",
            defaultValue: (flag.default_value ?? false) as unknown as Record<string, unknown>,
            rules: (flag.rules ?? []) as unknown as Record<string, unknown>,
            variants: (flag.variants ?? null) as unknown as Record<string, unknown> | null,
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
      return row ? toFlag(row) : null;
    },

    async listFlags(): Promise<Flag[]> {
      const rows = await db.select().from(featureFlags).orderBy(featureFlags.key);
      return rows.map(toFlag);
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

    async getFlags(keys: string[]): Promise<Flag[]> {
      if (!keys.length) return [];
      const rows = await db
        .select()
        .from(featureFlags)
        .where(inArray(featureFlags.key, keys));
      return rows.map(toFlag);
    },
  };
}

function toFlag(row: FlagRow): Flag {
  return {
    key: row.key,
    enabled: row.enabled,
    rollout_pct: row.rolloutPct,
    description: row.description,
    value: row.value,
    value_type:
      row.valueType === "string" ||
      row.valueType === "number" ||
      row.valueType === "json" ||
      row.valueType === "boolean"
        ? row.valueType
        : "boolean",
    default_value: (row.defaultValue ?? false) as FlagJsonValue,
    rules: (row.rules ?? []) as unknown as FlagRule[],
    variants: (row.variants ?? undefined) as Variant[] | undefined,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
