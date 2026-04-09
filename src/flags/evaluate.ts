/**
 * Pure flag evaluation engine.
 *
 * `evaluateFlag(flag, ctx)` is the heart of the v2 targeting engine.
 * It takes a flag definition and a user context and returns the value to
 * serve, which rule fired, and (for weighted splits) which variant bucket
 * the user landed in.
 *
 * This module is deliberately I/O-free:
 *   - no DB calls
 *   - no network
 *   - no global state
 *   - no randomness (bucketing is deterministic via CRC32)
 *
 * That means it can be unit-tested exhaustively with plain data, and
 * consumers can reuse it in client-side contexts (e.g. a future DonkeyFlags
 * Swift/TS SDK that evaluates rules locally from a cached snapshot).
 */

import { crc32 } from "./hash.js";
import { semverGte, semverLt } from "./semver.js";
import type {
  Condition,
  EvaluationResult,
  Flag,
  FlagContext,
  FlagJsonValue,
  FlagRule,
  FlagServe,
  Variant,
} from "./index.js";

/**
 * Resolve a dotted-path attribute from a FlagContext.
 *
 * Supported paths (closed set — typos return `undefined` instead of
 * reflecting on arbitrary object keys):
 *
 *   user.id            → ctx.userId
 *   user.email         → ctx.email
 *   user.isPro         → ctx.isPro
 *   user.createdAt     → ctx.userCreatedAt
 *   app.version        → ctx.appVersion
 *   app.build          → ctx.appBuild
 *   app.platform       → ctx.platform
 *   app.locale         → ctx.locale
 *   app.country        → ctx.country
 *   device.model       → ctx.deviceModel
 *   device.osVersion   → ctx.osVersion
 *   custom.<any>       → ctx.custom?.<any>
 */
export function resolveAttr(
  ctx: FlagContext,
  path: string,
): string | number | boolean | undefined {
  if (!path) return undefined;
  if (path.startsWith("custom.")) {
    const key = path.slice("custom.".length);
    return ctx.custom?.[key];
  }
  switch (path) {
    case "user.id":         return ctx.userId;
    case "user.email":      return ctx.email;
    case "user.isPro":      return ctx.isPro;
    case "user.createdAt":  return ctx.userCreatedAt instanceof Date ? ctx.userCreatedAt.toISOString() : ctx.userCreatedAt;
    case "app.version":     return ctx.appVersion;
    case "app.build":       return ctx.appBuild;
    case "app.platform":    return ctx.platform;
    case "app.locale":      return ctx.locale;
    case "app.country":     return ctx.country;
    case "device.model":    return ctx.deviceModel;
    case "device.osVersion":return ctx.osVersion;
    default:                return undefined;
  }
}

/**
 * Deterministic bucket in [0, buckets) from a seed. Exposed for tests.
 */
function bucketOf(seed: string, buckets: number): number {
  if (buckets <= 0) return 0;
  return crc32(seed) % buckets;
}

/**
 * Recursive condition evaluator. Pure, no side effects.
 * Missing attribute → leaf conditions return `false` (they do not throw).
 */
function evalCondition(cond: Condition, ctx: FlagContext, flagKey: string): boolean {
  switch (cond.op) {
    case "and":
      return cond.children.every((c) => evalCondition(c, ctx, flagKey));
    case "or":
      return cond.children.some((c) => evalCondition(c, ctx, flagKey));
    case "not":
      return !evalCondition(cond.child, ctx, flagKey);

    case "eq": {
      const v = resolveAttr(ctx, cond.attr);
      return v !== undefined && v === cond.value;
    }
    case "neq": {
      const v = resolveAttr(ctx, cond.attr);
      return v !== undefined && v !== cond.value;
    }

    case "in": {
      const v = resolveAttr(ctx, cond.attr);
      if (v === undefined) return false;
      return cond.values.some((x) => x === v);
    }
    case "nin": {
      const v = resolveAttr(ctx, cond.attr);
      if (v === undefined) return false;
      return !cond.values.some((x) => x === v);
    }

    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const v = resolveAttr(ctx, cond.attr);
      if (typeof v !== "number") return false;
      switch (cond.op) {
        case "gt":  return v > cond.value;
        case "gte": return v >= cond.value;
        case "lt":  return v < cond.value;
        case "lte": return v <= cond.value;
      }
    }

    case "matches": {
      const v = resolveAttr(ctx, cond.attr);
      if (typeof v !== "string") return false;
      try {
        return new RegExp(cond.pattern).test(v);
      } catch {
        return false; // invalid regex → no match, never throw
      }
    }

    case "semver_gte": {
      const v = resolveAttr(ctx, cond.attr);
      return typeof v === "string" && semverGte(v, cond.value);
    }
    case "semver_lt": {
      const v = resolveAttr(ctx, cond.attr);
      return typeof v === "string" && semverLt(v, cond.value);
    }

    case "percentage": {
      if (cond.pct <= 0) return false;
      if (cond.pct >= 100) return true;
      // 10_000 buckets = 0.01% precision. Seed defaults to flagKey so
      // multiple percentage rules on the same flag bucket the same user
      // the same way unless explicitly given different seeds.
      const seed = `${cond.seed ?? flagKey}:${ctx.userId}`;
      const b = bucketOf(seed, 10_000);
      return b < Math.floor(cond.pct * 100);
    }
  }
}

/**
 * Pick a value to serve from a rule's `serve` clause.
 * For `variants`, deterministically bucket the user into one of the variants
 * based on cumulative weight. Returns `{value, variantKey?}`.
 */
function pickServe(
  serve: FlagServe,
  flag: Flag,
  ctx: FlagContext,
): { value: FlagJsonValue; variantKey?: string } {
  switch (serve.kind) {
    case "value":
      return { value: serve.value };

    case "variant": {
      const v = (flag.variants ?? []).find((x) => x.key === serve.variant);
      if (!v) {
        // Referenced variant missing — fall back to default_value.
        return { value: flag.default_value ?? null };
      }
      return { value: v.value, variantKey: v.key };
    }

    case "variants": {
      const picked = pickWeightedVariant(serve.variants, flag.key, ctx.userId);
      if (!picked) return { value: flag.default_value ?? null };
      return { value: picked.value, variantKey: picked.key };
    }
  }
}

/**
 * Deterministic weighted variant picker.
 * Buckets into `sum(weights)` slots keyed on `${flagKey}:${userId}:variants`
 * and walks the cumulative weights to find the bucket's variant.
 * Same user → same variant as long as the weight distribution doesn't change.
 */
function pickWeightedVariant(
  variants: Variant[],
  flagKey: string,
  userId: string,
): Variant | null {
  if (variants.length === 0) return null;
  const total = variants.reduce((sum, v) => sum + Math.max(0, v.weight), 0);
  if (total <= 0) return variants[0] ?? null;
  const b = bucketOf(`${flagKey}:${userId}:variants`, total);
  let running = 0;
  for (const v of variants) {
    running += Math.max(0, v.weight);
    if (b < running) return v;
  }
  return variants[variants.length - 1] ?? null;
}

/**
 * Evaluate a flag against a context.
 *
 * Precedence (highest → lowest):
 *   1. Global kill switch (`flag.enabled === false` → default_value)
 *   2. Ordered rules (first matching rule's serve wins)
 *   3. Default value
 *
 * Note: user overrides (the per-user kill switch in `FlagsDB`) are handled
 * one level up in `FlagsService.evaluate`, not here — this function is pure
 * and does not know about the override table.
 */
export function evaluateFlag(flag: Flag, ctx: FlagContext): EvaluationResult {
  const defaultValue: FlagJsonValue = flag.default_value ?? false;

  if (!flag.enabled) {
    return { value: defaultValue, matched: false };
  }

  const rules = flag.rules ?? [];
  for (const rule of rules) {
    if (!evalCondition(rule.condition, ctx, flag.key)) continue;
    const picked = pickServe(rule.serve, flag, ctx);
    return {
      value: picked.value,
      matched: true,
      ruleId: rule.id,
      ...(picked.variantKey !== undefined && { variantKey: picked.variantKey }),
    };
  }

  // No rules matched. If there are no v2 rules at all, fall back to the
  // legacy rollout_pct path so consumers that haven't migrated still work.
  if (rules.length === 0 && flag.rollout_pct > 0) {
    if (flag.rollout_pct >= 100) {
      return { value: true, matched: true, ruleId: "legacy-rollout" };
    }
    const b = bucketOf(`${flag.key}:${ctx.userId}`, 100);
    if (b < flag.rollout_pct) {
      return { value: true, matched: true, ruleId: "legacy-rollout" };
    }
  }

  return { value: defaultValue, matched: false };
}

/** Re-export so tests can import from a single module. */
export type { Condition, Flag, FlagContext, FlagRule, FlagServe, Variant, EvaluationResult };
