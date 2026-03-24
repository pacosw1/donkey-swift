import { randomUUID, timingSafeEqual } from "node:crypto";
/**
 * In-memory rate limiter using a sliding window per key.
 * Framework-agnostic — use in any middleware or route handler.
 *
 * Example:
 *   const rl = new RateLimiter(10, 60_000); // 10 requests per minute
 *   if (!rl.allow(clientIp)) throw new RateLimitError();
 */
export class RateLimiter {
    rate;
    windowMs;
    visitors = new Map();
    cleanupInterval;
    constructor(rate, windowMs) {
        this.rate = rate;
        this.windowMs = windowMs;
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [key, v] of this.visitors) {
                if (now > v.resetAt)
                    this.visitors.delete(key);
            }
        }, 60_000);
    }
    /** Check if a request from this key should be allowed. */
    allow(key) {
        const now = Date.now();
        const v = this.visitors.get(key);
        if (!v || now > v.resetAt) {
            this.visitors.set(key, { count: 1, resetAt: now + this.windowMs });
            return true;
        }
        v.count++;
        return v.count <= this.rate;
    }
    /** Clean up the interval timer. Call on shutdown. */
    destroy() {
        clearInterval(this.cleanupInterval);
    }
}
// ── Token Extraction ────────────────────────────────────────────────────────
/**
 * Extract a Bearer token from an Authorization header value.
 * Returns undefined if the header is missing or not a Bearer token.
 */
export function extractBearerToken(authorizationHeader) {
    if (!authorizationHeader?.startsWith("Bearer "))
        return undefined;
    return authorizationHeader.slice(7);
}
// ── Timing-Safe Comparison ──────────────────────────────────────────────────
/**
 * Constant-time string comparison. Use for API keys, tokens, secrets.
 * Prevents timing attacks.
 */
export function safeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
// ── Request ID ──────────────────────────────────────────────────────────────
/**
 * Generate or pass through a request ID.
 * Uses the provided ID (e.g. from X-Request-ID header) or generates a UUID.
 */
export function resolveRequestId(existing) {
    return existing || randomUUID();
}
//# sourceMappingURL=index.js.map