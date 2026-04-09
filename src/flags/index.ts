import { ValidationError, NotFoundError, ServiceError } from "../errors/index.js";
import { evaluateFlag as evaluateFlagPure } from "./evaluate.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

/**
 * Any JSON-serializable value a flag can return. Used for flag default values,
 * rule serve values, and variant values.
 */
export type FlagJsonValue =
  | string
  | number
  | boolean
  | null
  | FlagJsonValue[]
  | { [key: string]: FlagJsonValue };

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
  // app identification
  appVersion?: string;      // semver, e.g. "1.4.2"
  appBuild?: string;
  platform?: "ios" | "android" | "web";
  deviceModel?: string;     // e.g. "iPhone15,3"
  osVersion?: string;
  locale?: string;          // e.g. "en-US"
  country?: string;         // e.g. "US"
  // user attributes
  email?: string;
  isPro?: boolean;
  userCreatedAt?: Date | string;
  // app-specific escape hatch
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
export type Condition =
  | { op: "and"; children: Condition[] }
  | { op: "or"; children: Condition[] }
  | { op: "not"; child: Condition }
  | { op: "eq" | "neq"; attr: string; value: string | number | boolean }
  | { op: "in" | "nin"; attr: string; values: Array<string | number> }
  | { op: "gt" | "gte" | "lt" | "lte"; attr: string; value: number }
  | { op: "matches"; attr: string; pattern: string }
  | { op: "semver_gte" | "semver_lt"; attr: string; value: string }
  | { op: "percentage"; pct: number; seed?: string };

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
export type FlagServe =
  | { kind: "value"; value: FlagJsonValue }
  | { kind: "variant"; variant: string }
  | { kind: "variants"; variants: Variant[] };

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

// Re-export from sibling modules so consumers can import everything from "donkey-swift/flags"
export { crc32, bucket } from "./hash.js";
export { parseSemver, compareSemver, semverGte, semverLt } from "./semver.js";
export { evaluateFlag, resolveAttr } from "./evaluate.js";

// ── Validation helpers (module-private) ─────────────────────────────────────

function validateRules(rules: FlagRule[]): void {
  const seenIds = new Set<string>();
  for (const rule of rules) {
    if (!rule.id) throw new ValidationError("rule.id is required");
    if (seenIds.has(rule.id)) throw new ValidationError(`duplicate rule id: ${rule.id}`);
    seenIds.add(rule.id);
    if (!rule.condition) throw new ValidationError(`rule ${rule.id}: condition is required`);
    if (!rule.serve) throw new ValidationError(`rule ${rule.id}: serve is required`);
    validateCondition(rule.condition, rule.id);
    validateServe(rule.serve, rule.id);
  }
}

function validateCondition(cond: Condition, ruleId: string, depth = 0): void {
  if (depth > 8) throw new ValidationError(`rule ${ruleId}: condition tree too deep (max 8 levels)`);
  switch (cond.op) {
    case "and":
    case "or":
      if (!Array.isArray(cond.children) || cond.children.length === 0) {
        throw new ValidationError(`rule ${ruleId}: ${cond.op} needs at least one child`);
      }
      cond.children.forEach((c) => validateCondition(c, ruleId, depth + 1));
      return;
    case "not":
      validateCondition(cond.child, ruleId, depth + 1);
      return;
    case "in":
    case "nin":
      if (!Array.isArray(cond.values) || cond.values.length === 0) {
        throw new ValidationError(`rule ${ruleId}: ${cond.op} needs a non-empty values array`);
      }
      return;
    case "percentage":
      if (typeof cond.pct !== "number" || cond.pct < 0 || cond.pct > 100) {
        throw new ValidationError(`rule ${ruleId}: percentage.pct must be 0-100`);
      }
      return;
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "matches":
    case "semver_gte":
    case "semver_lt":
      if (!cond.attr) throw new ValidationError(`rule ${ruleId}: ${cond.op} needs an attr`);
      return;
  }
}

function validateServe(serve: FlagServe, ruleId: string): void {
  if (serve.kind === "variant" && !serve.variant) {
    throw new ValidationError(`rule ${ruleId}: serve.variant is required`);
  }
  if (serve.kind === "variants") {
    if (!Array.isArray(serve.variants) || serve.variants.length === 0) {
      throw new ValidationError(`rule ${ruleId}: serve.variants must be a non-empty array`);
    }
    validateVariants(serve.variants);
  }
}

function validateVariants(variants: Variant[]): void {
  const seen = new Set<string>();
  for (const v of variants) {
    if (!v.key) throw new ValidationError("variant.key is required");
    if (seen.has(v.key)) throw new ValidationError(`duplicate variant key: ${v.key}`);
    seen.add(v.key);
    if (typeof v.weight !== "number" || v.weight < 0) {
      throw new ValidationError(`variant ${v.key}: weight must be a non-negative number`);
    }
  }
}

// ── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  flag: Flag | null;
  expiresAt: number;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class FlagsService {
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs: number;
  private onExposure?: FlagsConfig["onExposure"];

  constructor(private db: FlagsDB, cfg?: FlagsConfig) {
    this.cacheTtlMs = cfg?.cacheTtlMs ?? 0;
    this.onExposure = cfg?.onExposure;
  }

  private async getCachedFlag(key: string): Promise<Flag | null> {
    if (this.cacheTtlMs > 0) {
      const cached = this.cache.get(key);
      if (cached && Date.now() < cached.expiresAt) return cached.flag;
    }
    const flag = await this.db.getFlag(key).catch(() => null);
    if (this.cacheTtlMs > 0) {
      this.cache.set(key, { flag, expiresAt: Date.now() + this.cacheTtlMs });
    }
    return flag;
  }

  /** Invalidate the cache for a specific key (called after admin mutations). */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /** Clear the entire flag cache. */
  clearCache(): void {
    this.cache.clear();
  }

  // ── v2 evaluation ──────────────────────────────────────────────────────

  /**
   * Evaluate a flag against a context and return the full result.
   * Precedence: per-user override > flag rules > flag default_value.
   *
   * This is the primary v2 entry point. `isEnabled`, `getValue`, `check`,
   * and `batchCheck` are all thin shims on top of this.
   */
  async evaluate(key: string, ctx: FlagContext): Promise<EvaluationResult> {
    if (!key) throw new ValidationError("flag key is required");
    if (!ctx?.userId) throw new ValidationError("context.userId is required");

    // 1. Per-user override (admin hotfix path) — always wins.
    const override = await this.db.getUserOverride(key, ctx.userId).catch(() => null);
    if (override !== null) {
      const result: EvaluationResult = { value: override, matched: true, ruleId: "user-override" };
      this.fireExposure(ctx, key, result);
      return result;
    }

    // 2. Load the flag and delegate to the pure evaluator.
    const flag = await this.getCachedFlag(key);
    if (!flag) {
      const result: EvaluationResult = { value: false, matched: false };
      this.fireExposure(ctx, key, result);
      return result;
    }

    const result = evaluateFlagPure(flag, ctx);
    this.fireExposure(ctx, key, result);
    return result;
  }

  /**
   * Batch-evaluate many flags against a single context.
   * If `keys` is omitted, evaluates every flag the DB knows about —
   * useful for the iOS "refresh all flags on launch" path.
   */
  async evaluateAll(
    ctx: FlagContext,
    keys?: string[],
  ): Promise<Record<string, EvaluationResult>> {
    if (!ctx?.userId) throw new ValidationError("context.userId is required");

    let targetKeys: string[];
    if (keys?.length) {
      if (keys.length > 200) throw new ValidationError("maximum 200 keys per batch");
      targetKeys = keys;
    } else {
      const flags = await this.db.listFlags().catch(() => []);
      targetKeys = flags.map((f) => f.key);
    }

    // Warm cache with bulk fetch where supported.
    if (this.db.getFlags && this.cacheTtlMs > 0) {
      const uncached = targetKeys.filter((k) => {
        const entry = this.cache.get(k);
        return !entry || Date.now() >= entry.expiresAt;
      });
      if (uncached.length > 0) {
        const flags = await this.db.getFlags(uncached).catch(() => []);
        const now = Date.now();
        for (const flag of flags) {
          this.cache.set(flag.key, { flag, expiresAt: now + this.cacheTtlMs });
        }
        for (const k of uncached) {
          if (!this.cache.has(k)) {
            this.cache.set(k, { flag: null, expiresAt: now + this.cacheTtlMs });
          }
        }
      }
    }

    const out: Record<string, EvaluationResult> = {};
    for (const k of targetKeys) {
      out[k] = await this.evaluate(k, ctx);
    }
    return out;
  }

  private fireExposure(ctx: FlagContext, key: string, result: EvaluationResult): void {
    if (!this.onExposure) return;
    try {
      this.onExposure(ctx, key, result);
    } catch {
      // Exposure hooks must never break flag evaluation — swallow and continue.
    }
  }

  // ── v1 compat shims ────────────────────────────────────────────────────

  /**
   * Back-compat: check if a flag is enabled for a user with only a userId.
   * Implemented as `evaluate(key, { userId })` — callers that need targeting
   * by platform/version should use `evaluate` directly with a full context.
   */
  async isEnabled(key: string, userId: string): Promise<boolean> {
    const result = await this.evaluate(key, { userId });
    return result.value === true;
  }

  /**
   * Get a flag's typed value for a user. v1 API — reads the legacy
   * `value` / `value_type` columns on the flag row.
   *
   * Returns null if flag is disabled or user is not in rollout. New code
   * should prefer `evaluate(key, ctx).value` which honors v2 rules and variants.
   */
  async getValue(key: string, userId: string): Promise<string | number | Record<string, unknown> | null> {
    const enabled = await this.isEnabled(key, userId);
    if (!enabled) return null;

    const flag = await this.getCachedFlag(key);
    if (!flag?.value) return null;

    switch (flag.value_type) {
      case "number": return Number(flag.value);
      case "json":
        try { return JSON.parse(flag.value); }
        catch { return null; }
      default: return flag.value;
    }
  }

  async check(userId: string, key: string): Promise<{ key: string; enabled: boolean; value?: string | null }> {
    if (!key) throw new ValidationError("flag key is required");

    const enabled = await this.isEnabled(key, userId);
    const flag = await this.getCachedFlag(key);
    const result: { key: string; enabled: boolean; value?: string | null } = { key, enabled };
    if (flag?.value && enabled) result.value = flag.value;
    return result;
  }

  async batchCheck(userId: string, keys: string[]): Promise<{ flags: Record<string, boolean> }> {
    if (!keys?.length) throw new ValidationError("keys array is required");
    if (keys.length > 100) throw new ValidationError("maximum 100 keys per batch");

    const all = await this.evaluateAll({ userId }, keys);
    const result: Record<string, boolean> = {};
    for (const key of keys) {
      result[key] = all[key]?.value === true;
    }
    return { flags: result };
  }

  async listFlags(): Promise<{ flags: Flag[] }> {
    const flags = await this.db.listFlags().catch(() => []);
    return { flags };
  }

  async createFlag(input: {
    key?: string;
    enabled?: boolean;
    rollout_pct?: number;
    description?: string;
    value?: string;
    value_type?: string;
    default_value?: FlagJsonValue;
    rules?: FlagRule[];
    variants?: Variant[];
  }): Promise<Flag> {
    if (!input.key) throw new ValidationError("key is required");
    if (input.rollout_pct !== undefined && (input.rollout_pct < 0 || input.rollout_pct > 100)) {
      throw new ValidationError("rollout_pct must be 0-100");
    }
    if (input.rules) validateRules(input.rules);
    if (input.variants) validateVariants(input.variants);

    const flag: Flag = {
      key: input.key,
      enabled: input.enabled ?? true,
      rollout_pct: input.rollout_pct ?? 100,
      description: input.description ?? "",
      value: input.value ?? null,
      value_type: (input.value_type as Flag["value_type"]) ?? "boolean",
      default_value: input.default_value ?? false,
      rules: input.rules ?? [],
      variants: input.variants,
      created_at: new Date(),
      updated_at: new Date(),
    };

    try {
      await this.db.upsertFlag(flag);
    } catch {
      throw new ServiceError("INTERNAL", "failed to create flag");
    }
    this.invalidate(flag.key);
    return flag;
  }

  async updateFlag(key: string, input: {
    enabled?: boolean;
    rollout_pct?: number;
    description?: string;
    value?: string;
    value_type?: string;
    default_value?: FlagJsonValue;
    rules?: FlagRule[];
    variants?: Variant[];
  }): Promise<Flag> {
    if (!key) throw new ValidationError("flag key is required");

    const existing = await this.db.getFlag(key);
    if (!existing) throw new NotFoundError("flag not found");

    if (input.rollout_pct !== undefined && (input.rollout_pct < 0 || input.rollout_pct > 100)) {
      throw new ValidationError("rollout_pct must be 0-100");
    }
    if (input.rules) validateRules(input.rules);
    if (input.variants) validateVariants(input.variants);

    if (input.enabled !== undefined) existing.enabled = input.enabled;
    if (input.rollout_pct !== undefined) existing.rollout_pct = input.rollout_pct;
    if (input.description !== undefined) existing.description = input.description;
    if (input.value !== undefined) existing.value = input.value;
    if (input.value_type !== undefined) existing.value_type = input.value_type as Flag["value_type"];
    if (input.default_value !== undefined) existing.default_value = input.default_value;
    if (input.rules !== undefined) existing.rules = input.rules;
    if (input.variants !== undefined) existing.variants = input.variants;
    existing.updated_at = new Date();

    try {
      await this.db.upsertFlag(existing);
    } catch {
      throw new ServiceError("INTERNAL", "failed to update flag");
    }
    this.invalidate(key);
    return existing;
  }

  // ── v2 rule + variant management ───────────────────────────────────────

  /** Return the ordered rule list for a flag. Empty list if the flag is still on the legacy rollout path. */
  async listRules(key: string): Promise<FlagRule[]> {
    if (!key) throw new ValidationError("flag key is required");
    const flag = await this.db.getFlag(key);
    if (!flag) throw new NotFoundError("flag not found");
    return flag.rules ?? [];
  }

  /** Replace the entire rule list for a flag. Rules are ordered — first match wins. */
  async upsertRules(key: string, rules: FlagRule[]): Promise<Flag> {
    if (!key) throw new ValidationError("flag key is required");
    if (!Array.isArray(rules)) throw new ValidationError("rules must be an array");
    validateRules(rules);

    const existing = await this.db.getFlag(key);
    if (!existing) throw new NotFoundError("flag not found");

    existing.rules = rules;
    existing.updated_at = new Date();

    try {
      await this.db.upsertFlag(existing);
    } catch {
      throw new ServiceError("INTERNAL", "failed to upsert rules");
    }
    this.invalidate(key);
    return existing;
  }

  /** Add (or replace by key) a variant in the flag's variant catalog. */
  async addVariant(key: string, variant: Variant): Promise<Flag> {
    if (!key) throw new ValidationError("flag key is required");
    validateVariants([variant]);

    const existing = await this.db.getFlag(key);
    if (!existing) throw new NotFoundError("flag not found");

    const variants = existing.variants ?? [];
    const idx = variants.findIndex((v) => v.key === variant.key);
    if (idx >= 0) variants[idx] = variant;
    else variants.push(variant);
    existing.variants = variants;
    existing.updated_at = new Date();

    try {
      await this.db.upsertFlag(existing);
    } catch {
      throw new ServiceError("INTERNAL", "failed to add variant");
    }
    this.invalidate(key);
    return existing;
  }

  /** Remove a variant by key from the flag's variant catalog. */
  async removeVariant(key: string, variantKey: string): Promise<Flag> {
    if (!key) throw new ValidationError("flag key is required");
    if (!variantKey) throw new ValidationError("variantKey is required");

    const existing = await this.db.getFlag(key);
    if (!existing) throw new NotFoundError("flag not found");

    existing.variants = (existing.variants ?? []).filter((v) => v.key !== variantKey);
    existing.updated_at = new Date();

    try {
      await this.db.upsertFlag(existing);
    } catch {
      throw new ServiceError("INTERNAL", "failed to remove variant");
    }
    this.invalidate(key);
    return existing;
  }

  async deleteFlag(key: string): Promise<{ status: string }> {
    if (!key) throw new ValidationError("flag key is required");

    const existing = await this.db.getFlag(key);
    if (!existing) throw new NotFoundError("flag not found");

    try {
      await this.db.deleteFlag(key);
    } catch {
      throw new ServiceError("INTERNAL", "failed to delete flag");
    }
    this.invalidate(key);
    return { status: "deleted" };
  }

  async setOverride(key: string, userId: string, enabled: boolean): Promise<void> {
    if (!key) throw new ValidationError("flag key is required");
    if (!userId) throw new ValidationError("user_id is required");
    if (enabled === undefined) throw new ValidationError("enabled is required");

    try {
      await this.db.setUserOverride(key, userId, enabled);
    } catch {
      throw new ServiceError("INTERNAL", "failed to set override");
    }
  }

  async deleteOverride(key: string, userId: string): Promise<void> {
    if (!key || !userId) throw new ValidationError("key and user_id are required");

    try {
      await this.db.deleteUserOverride(key, userId);
    } catch {
      throw new ServiceError("INTERNAL", "failed to delete override");
    }
  }
}
