/**
 * Minimal semver parser + comparator for flag targeting rules.
 *
 * Supports the shapes the flag engine actually needs:
 *   "1"            → [1, 0, 0]
 *   "1.4"          → [1, 4, 0]
 *   "1.4.2"        → [1, 4, 2]
 *   "1.4.2-beta.3" → [1, 4, 2]   (pre-release tags ignored for comparison)
 *   "v1.4.2"       → [1, 4, 2]   (leading "v" tolerated)
 *
 * Deliberately does NOT implement full semver pre-release ordering — targeting
 * rules like "appVersion semver_gte 1.4.0" should match on the numeric triple.
 * If a consumer needs richer semver they can depend on the `semver` npm package
 * in their own code.
 */
export type SemverTuple = [number, number, number];
/**
 * Parse a version string into a [major, minor, patch] tuple.
 * Returns null if the string cannot be parsed at all.
 */
export declare function parseSemver(input: string): SemverTuple | null;
/**
 * Compare two semver tuples. Returns -1 / 0 / 1.
 */
export declare function compareSemver(a: SemverTuple, b: SemverTuple): -1 | 0 | 1;
/** True iff `version >= target`. Both unparseable → false. */
export declare function semverGte(version: string, target: string): boolean;
/** True iff `version < target`. Both unparseable → false. */
export declare function semverLt(version: string, target: string): boolean;
//# sourceMappingURL=semver.d.ts.map