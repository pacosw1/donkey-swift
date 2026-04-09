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
export declare function crc32(str: string): number;
/**
 * Bucket a user into the range [0, buckets) deterministically from a seed.
 * Used for percentage rollout and variant weight selection.
 *
 * @param seed   Any stable string — typically `${flagKey}:${userId}` or
 *               `${flagKey}:${userId}:variants`.
 * @param buckets Number of discrete buckets (e.g. 10_000 for 0.01% precision,
 *                or the sum of variant weights).
 */
export declare function bucket(seed: string, buckets: number): number;
//# sourceMappingURL=hash.d.ts.map