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
/**
 * Parse a version string into a [major, minor, patch] tuple.
 * Returns null if the string cannot be parsed at all.
 */
export function parseSemver(input) {
    if (typeof input !== "string" || input.length === 0)
        return null;
    // strip leading "v" only (not "-"), then split off pre-release / build metadata
    const stripped = input.replace(/^v/i, "");
    // must start with a digit — rejects "-1.0.0", "nope", "", "+build"
    if (!/^\d/.test(stripped))
        return null;
    const cleaned = stripped.split(/[-+]/)[0] ?? "";
    const parts = cleaned.split(".");
    if (parts.length === 0)
        return null;
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        const raw = parts[i];
        if (raw === undefined)
            break;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0)
            return null;
        out[i] = Math.floor(n);
    }
    return out;
}
/**
 * Compare two semver tuples. Returns -1 / 0 / 1.
 */
export function compareSemver(a, b) {
    for (let i = 0; i < 3; i++) {
        const ai = a[i] ?? 0;
        const bi = b[i] ?? 0;
        if (ai < bi)
            return -1;
        if (ai > bi)
            return 1;
    }
    return 0;
}
/** True iff `version >= target`. Both unparseable → false. */
export function semverGte(version, target) {
    const v = parseSemver(version);
    const t = parseSemver(target);
    if (!v || !t)
        return false;
    return compareSemver(v, t) >= 0;
}
/** True iff `version < target`. Both unparseable → false. */
export function semverLt(version, target) {
    const v = parseSemver(version);
    const t = parseSemver(target);
    if (!v || !t)
        return false;
    return compareSemver(v, t) < 0;
}
//# sourceMappingURL=semver.js.map