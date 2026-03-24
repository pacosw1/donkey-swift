import type { MiddlewareHandler } from "hono";
export interface AuthConfig {
    /** Validates a session token and returns the user ID. */
    parseToken: (token: string) => Promise<string>;
    /** Cookie name for session token (default: "session"). */
    cookieName?: string;
}
/**
 * Middleware that extracts user ID from Bearer token or session cookie.
 * Sets `userId` in Hono context.
 */
export declare function requireAuth(cfg: AuthConfig): MiddlewareHandler;
export interface AdminConfig {
    adminKey?: string;
    adminEmail?: string;
    parseToken?: (token: string) => Promise<string>;
    getUserEmail?: (userId: string) => Promise<string>;
    /** Cookie name for admin session (default: "admin_session"). */
    adminCookieName?: string;
    /** Cookie name for admin key (default: "admin_key"). */
    adminKeyCookieName?: string;
}
/** Middleware that checks admin API key or admin email JWT. */
export declare function requireAdmin(cfg: AdminConfig): MiddlewareHandler;
/**
 * CORS middleware. Pass "*" for all origins, or comma-separated allowed origins.
 */
export declare function cors(allowedOrigins: string): MiddlewareHandler;
export declare class RateLimiter {
    private rate;
    private windowMs;
    private visitors;
    private cleanupInterval;
    constructor(rate: number, windowMs: number);
    allow(ip: string): boolean;
    destroy(): void;
}
/** Rate limit middleware using the given RateLimiter. */
export declare function rateLimit(rl: RateLimiter): MiddlewareHandler;
/** Logs HTTP requests with duration. skipPaths are excluded from logging. */
export declare function requestLog(...skipPaths: string[]): MiddlewareHandler;
/** Adds X-API-Version and X-Minimum-Version response headers. */
export declare function version(current: string, minimum: string): MiddlewareHandler;
//# sourceMappingURL=index.d.ts.map