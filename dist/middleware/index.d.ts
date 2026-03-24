/**
 * In-memory rate limiter using a sliding window per key.
 * Framework-agnostic — use in any middleware or route handler.
 *
 * Example:
 *   const rl = new RateLimiter(10, 60_000); // 10 requests per minute
 *   if (!rl.allow(clientIp)) throw new RateLimitError();
 */
export declare class RateLimiter {
    private rate;
    private windowMs;
    private visitors;
    private cleanupInterval;
    constructor(rate: number, windowMs: number);
    /** Check if a request from this key should be allowed. */
    allow(key: string): boolean;
    /** Clean up the interval timer. Call on shutdown. */
    destroy(): void;
}
/**
 * Extract a Bearer token from an Authorization header value.
 * Returns undefined if the header is missing or not a Bearer token.
 */
export declare function extractBearerToken(authorizationHeader?: string): string | undefined;
/**
 * Constant-time string comparison. Use for API keys, tokens, secrets.
 * Prevents timing attacks.
 */
export declare function safeEqual(a: string, b: string): boolean;
/**
 * Generate or pass through a request ID.
 * Uses the provided ID (e.g. from X-Request-ID header) or generates a UUID.
 */
export declare function resolveRequestId(existing?: string): string;
//# sourceMappingURL=index.d.ts.map