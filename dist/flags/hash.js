/**
 * CRC32 hash used by the flags package for deterministic rollout bucketing.
 *
 * Extracted into its own module so both the legacy `isEnabled` path and the
 * v2 `evaluateFlag` engine can share the same implementation — two rollout
 * code paths computing different hashes for the same user would cause
 * flag flapping during the v1 → v2 migration.
 *
 * Pure function, no dependencies. Browser-safe.
 */
export function crc32(str) {
    let crc = 0xffffffff;
    for (let i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i);
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
/**
 * Bucket a user into the range [0, buckets) deterministically from a seed.
 * Used for percentage rollout and variant weight selection.
 *
 * @param seed   Any stable string — typically `${flagKey}:${userId}` or
 *               `${flagKey}:${userId}:variants`.
 * @param buckets Number of discrete buckets (e.g. 10_000 for 0.01% precision,
 *                or the sum of variant weights).
 */
export function bucket(seed, buckets) {
    if (buckets <= 0)
        return 0;
    return crc32(seed) % buckets;
}
//# sourceMappingURL=hash.js.map