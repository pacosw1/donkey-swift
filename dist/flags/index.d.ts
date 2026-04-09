/**
 * Any JSON-serializable value a flag can return. Used for flag default values,
 * rule serve values, and variant values.
 */
export type FlagJsonValue = string | number | boolean | null | FlagJsonValue[] | {
    [key: string]: FlagJsonValue;
};
/**
 * Attributes the targeting engine can reason about when evaluating a flag.
 *
 * Required: `userId` — used for deterministic bucketing.
 * Everything else is optional; rules that reference a missing attribute
 * simply don't match (they do not throw).
 *
 * Consumers add app-specific traits under `custom`:
 *   `{ userId, custom: { cohort: "early_access", onboardingStep: 3 } }`
 * and reference them in rules as `attr: "custom.cohort"`.
 */
export interface FlagContext {
    userId: string;
    appVersion?: string;
    appBuild?: string;
    platform?: "ios" | "android" | "web";
    deviceModel?: string;
    osVersion?: string;
    locale?: string;
    country?: string;
    email?: string;
    isPro?: boolean;
    userCreatedAt?: Date | string;
    custom?: Record<string, string | number | boolean>;
}
/**
 * Boolean expression tree evaluated against a `FlagContext`.
 * Discriminated on `op`. Trees can nest arbitrarily via `and` / `or` / `not`.
 *
 * `attr` paths are dotted against FlagContext:
 *   "app.version"    → ctx.appVersion
 *   "user.isPro"     → ctx.isPro
 *   "user.id"        → ctx.userId
 *   "custom.cohort"  → ctx.custom?.cohort
 *
 * `percentage` is the v2 replacement for the old `rollout_pct` column:
 * deterministic CRC32 bucketing of `${seed ?? flagKey}:${userId}` into
 * 10_000 buckets (0.01% precision).
 */
export type Condition = {
    op: "and";
    children: Condition[];
} | {
    op: "or";
    children: Condition[];
} | {
    op: "not";
    child: Condition;
} | {
    op: "eq" | "neq";
    attr: string;
    value: string | number | boolean;
} | {
    op: "in" | "nin";
    attr: string;
    values: Array<string | number>;
} | {
    op: "gt" | "gte" | "lt" | "lte";
    attr: string;
    value: number;
} | {
    op: "matches";
    attr: string;
    pattern: string;
} | {
    op: "semver_gte" | "semver_lt";
    attr: string;
    value: string;
} | {
    op: "percentage";
    pct: number;
    seed?: string;
};
/**
 * A named variant the rules can reference. Used for A/B testing and
 * multi-armed experiments. Weights are integers summed across variants.
 */
export interface Variant {
    key: string;
    value: FlagJsonValue;
    /** Integer weight. Variant buckets are assigned as `weight / sum(weights)`. */
    weight: number;
}
/**
 * What a rule serves when its condition matches.
 *
 * - `value`: return a literal. Fastest path, no bucketing.
 * - `variant`: return the named variant from the flag's `variants` catalog.
 * - `variants`: deterministic weighted split across the given variants
 *   (A/B testing). Bucket is sticky per user.
 */
export type FlagServe = {
    kind: "value";
    value: FlagJsonValue;
} | {
    kind: "variant";
    variant: string;
} | {
    kind: "variants";
    variants: Variant[];
};
/**
 * A targeting rule. Rules on a flag are ordered; first rule whose condition
 * matches wins and its `serve` is returned. A stable `id` is required so
 * exposure events can be attributed to the rule that fired.
 */
export interface FlagRule {
    id: string;
    description?: string;
    condition: Condition;
    serve: FlagServe;
}
/**
 * Result of evaluating a flag against a context.
 * `matched` is false when no rule matched and the default_value was served
 * (or when the flag was globally disabled).
 */
export interface EvaluationResult {
    value: FlagJsonValue;
    matched: boolean;
    ruleId?: string;
    variantKey?: string;
}
export interface FlagsDB {
    upsertFlag(flag: Flag): Promise<void>;
    getFlag(key: string): Promise<Flag | null>;
    listFlags(): Promise<Flag[]>;
    deleteFlag(key: string): Promise<void>;
    getUserOverride(key: string, userId: string): Promise<boolean | null>;
    setUserOverride(key: string, userId: string, enabled: boolean): Promise<void>;
    deleteUserOverride(key: string, userId: string): Promise<void>;
    /** Optional: fetch multiple flags in one query. Falls back to sequential getFlag if not provided. */
    getFlags?(keys: string[]): Promise<Flag[]>;
}
/**
 * A feature flag.
 *
 * v2 added `default_value`, `rules`, and `variants` as optional fields so
 * existing consumers that only set `{ key, enabled, rollout_pct, description }`
 * keep compiling. When `rules` is empty, the legacy `enabled + rollout_pct`
 * path is used (the migration in consumers should wrap legacy flags as a
 * single `percentage` rule, but the service tolerates either shape).
 */
export interface Flag {
    key: string;
    enabled: boolean;
    /** Legacy single-dimension rollout. Kept for back-compat; new code should use rules. */
    rollout_pct: number;
    description: string;
    /** Optional typed value (string, number, or JSON). Null for boolean-only flags. */
    value?: string | null;
    /** Value type for non-boolean flags. */
    value_type?: "boolean" | "string" | "number" | "json";
    /** v2: value served when no rule matches. Defaults to `false` if unset. */
    default_value?: FlagJsonValue;
    /** v2: ordered targeting rules. First match wins. */
    rules?: FlagRule[];
    /** v2: catalog of named variants rules can reference by key. */
    variants?: Variant[];
    created_at: Date;
    updated_at: Date;
}
export interface FlagsConfig {
    /** In-memory cache TTL in ms (default: 0 = no cache). Set to e.g. 30000 for 30s cache. */
    cacheTtlMs?: number;
    /**
     * Optional hook called every time a flag is evaluated with a result.
     * Consumers can wire this into their analytics/engage package to log
     * A/B exposure events. Called on every `evaluate` / `isEnabled` call.
     * Must be cheap — run asynchronously from the caller's perspective.
     */
    onExposure?: (ctx: FlagContext, key: string, result: EvaluationResult) => void;
}
export { crc32, bucket } from "./hash.js";
export { parseSemver, compareSemver, semverGte, semverLt } from "./semver.js";
export { evaluateFlag, resolveAttr } from "./evaluate.js";
export declare class FlagsService {
    private db;
    private cache;
    private cacheTtlMs;
    private onExposure?;
    constructor(db: FlagsDB, cfg?: FlagsConfig);
    private getCachedFlag;
    /** Invalidate the cache for a specific key (called after admin mutations). */
    invalidate(key: string): void;
    /** Clear the entire flag cache. */
    clearCache(): void;
    /**
     * Evaluate a flag against a context and return the full result.
     * Precedence: per-user override > flag rules > flag default_value.
     *
     * This is the primary v2 entry point. `isEnabled`, `getValue`, `check`,
     * and `batchCheck` are all thin shims on top of this.
     */
    evaluate(key: string, ctx: FlagContext): Promise<EvaluationResult>;
    /**
     * Batch-evaluate many flags against a single context.
     * If `keys` is omitted, evaluates every flag the DB knows about —
     * useful for the iOS "refresh all flags on launch" path.
     */
    evaluateAll(ctx: FlagContext, keys?: string[]): Promise<Record<string, EvaluationResult>>;
    private fireExposure;
    /**
     * Back-compat: check if a flag is enabled for a user with only a userId.
     * Implemented as `evaluate(key, { userId })` — callers that need targeting
     * by platform/version should use `evaluate` directly with a full context.
     */
    isEnabled(key: string, userId: string): Promise<boolean>;
    /**
     * Get a flag's typed value for a user. v1 API — reads the legacy
     * `value` / `value_type` columns on the flag row.
     *
     * Returns null if flag is disabled or user is not in rollout. New code
     * should prefer `evaluate(key, ctx).value` which honors v2 rules and variants.
     */
    getValue(key: string, userId: string): Promise<string | number | Record<string, unknown> | null>;
    check(userId: string, key: string): Promise<{
        key: string;
        enabled: boolean;
        value?: string | null;
    }>;
    batchCheck(userId: string, keys: string[]): Promise<{
        flags: Record<string, boolean>;
    }>;
    listFlags(): Promise<{
        flags: Flag[];
    }>;
    createFlag(input: {
        key?: string;
        enabled?: boolean;
        rollout_pct?: number;
        description?: string;
        value?: string;
        value_type?: string;
        default_value?: FlagJsonValue;
        rules?: FlagRule[];
        variants?: Variant[];
    }): Promise<Flag>;
    updateFlag(key: string, input: {
        enabled?: boolean;
        rollout_pct?: number;
        description?: string;
        value?: string;
        value_type?: string;
        default_value?: FlagJsonValue;
        rules?: FlagRule[];
        variants?: Variant[];
    }): Promise<Flag>;
    /** Return the ordered rule list for a flag. Empty list if the flag is still on the legacy rollout path. */
    listRules(key: string): Promise<FlagRule[]>;
    /** Replace the entire rule list for a flag. Rules are ordered — first match wins. */
    upsertRules(key: string, rules: FlagRule[]): Promise<Flag>;
    /** Add (or replace by key) a variant in the flag's variant catalog. */
    addVariant(key: string, variant: Variant): Promise<Flag>;
    /** Remove a variant by key from the flag's variant catalog. */
    removeVariant(key: string, variantKey: string): Promise<Flag>;
    deleteFlag(key: string): Promise<{
        status: string;
    }>;
    setOverride(key: string, userId: string, enabled: boolean): Promise<void>;
    deleteOverride(key: string, userId: string): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map