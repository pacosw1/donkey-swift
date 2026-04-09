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
import type { Condition, EvaluationResult, Flag, FlagContext, FlagRule, FlagServe, Variant } from "./index.js";
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
export declare function resolveAttr(ctx: FlagContext, path: string): string | number | boolean | undefined;
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
export declare function evaluateFlag(flag: Flag, ctx: FlagContext): EvaluationResult;
/** Re-export so tests can import from a single module. */
export type { Condition, Flag, FlagContext, FlagRule, FlagServe, Variant, EvaluationResult };
//# sourceMappingURL=evaluate.d.ts.map