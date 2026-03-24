import { getClientIp } from "../httputil/index.js";
/**
 * Middleware that extracts user ID from Bearer token or session cookie.
 * Sets `userId` in Hono context.
 */
export function requireAuth(cfg) {
    return async (c, next) => {
        let token;
        // 1. Authorization: Bearer <token>
        const auth = c.req.header("authorization");
        if (auth?.startsWith("Bearer ")) {
            token = auth.slice(7);
        }
        // 2. Fallback to cookie
        if (!token) {
            const cookie = getCookie(c, "session");
            if (cookie)
                token = cookie;
        }
        if (!token) {
            return c.json({ error: "missing session token" }, 401);
        }
        try {
            const userId = await cfg.parseToken(token);
            c.set("userId", userId);
            await next();
        }
        catch {
            return c.json({ error: "invalid or expired session" }, 401);
        }
    };
}
/** Middleware that checks admin API key or admin email JWT. */
export function requireAdmin(cfg) {
    return async (c, next) => {
        let authenticated = false;
        // Check admin API key
        if (cfg.adminKey) {
            const sources = [
                c.req.header("x-admin-key"),
                c.req.query("key"),
                c.req.query("admin_key"),
                getCookie(c, "admin_key"),
            ];
            if (sources.some((s) => s === cfg.adminKey)) {
                authenticated = true;
            }
        }
        // Check admin session cookie
        if (!authenticated && cfg.parseToken && cfg.getUserEmail) {
            const cookie = getCookie(c, "admin_session");
            if (cookie) {
                try {
                    const userId = await cfg.parseToken(cookie);
                    const email = await cfg.getUserEmail(userId);
                    if (email === cfg.adminEmail) {
                        authenticated = true;
                    }
                }
                catch {
                    // invalid token, fall through
                }
            }
        }
        if (!authenticated) {
            return c.json({ error: "admin authentication required" }, 401);
        }
        await next();
    };
}
// ── CORS Middleware ──────────────────────────────────────────────────────────
/**
 * CORS middleware. Pass "*" for all origins, or comma-separated allowed origins.
 */
export function cors(allowedOrigins) {
    return async (c, next) => {
        const origin = c.req.header("origin") ?? "";
        if (allowedOrigins === "*") {
            c.header("Access-Control-Allow-Origin", "*");
        }
        else {
            for (const o of allowedOrigins.split(",")) {
                if (o.trim() === origin) {
                    c.header("Access-Control-Allow-Origin", origin);
                    break;
                }
            }
        }
        c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key, X-Device-Token, X-Device-ID, X-Idempotency-Key, X-Timezone");
        c.header("Access-Control-Allow-Credentials", "true");
        c.header("Access-Control-Max-Age", "86400");
        if (c.req.method === "OPTIONS") {
            return c.body(null, 204);
        }
        await next();
    };
}
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
            for (const [ip, v] of this.visitors) {
                if (now > v.resetAt)
                    this.visitors.delete(ip);
            }
        }, 60_000);
    }
    allow(ip) {
        const now = Date.now();
        const v = this.visitors.get(ip);
        if (!v || now > v.resetAt) {
            this.visitors.set(ip, { count: 1, resetAt: now + this.windowMs });
            return true;
        }
        v.count++;
        return v.count <= this.rate;
    }
    destroy() {
        clearInterval(this.cleanupInterval);
    }
}
/** Rate limit middleware using the given RateLimiter. */
export function rateLimit(rl) {
    return async (c, next) => {
        const ip = getClientIp(c.req.raw);
        if (!rl.allow(ip)) {
            console.log(`[ratelimit] blocked ${ip}`);
            return c.json({ error: "rate limit exceeded" }, 429);
        }
        await next();
    };
}
// ── Request Log Middleware ───────────────────────────────────────────────────
/** Logs HTTP requests with duration. skipPaths are excluded from logging. */
export function requestLog(...skipPaths) {
    const skip = new Set(skipPaths);
    return async (c, next) => {
        const start = Date.now();
        await next();
        const path = new URL(c.req.url).pathname;
        if (skip.has(path))
            return;
        const duration = Date.now() - start;
        console.log(`[http] ${c.req.method} ${path} ${c.res.status} ${duration}ms ${getClientIp(c.req.raw)}`);
    };
}
// ── Version Middleware ───────────────────────────────────────────────────────
/** Adds X-API-Version and X-Minimum-Version response headers. */
export function version(current, minimum) {
    return async (c, next) => {
        c.header("X-API-Version", current);
        c.header("X-Minimum-Version", minimum);
        await next();
    };
}
// ── Helpers ─────────────────────────────────────────────────────────────────
function getCookie(c, name) {
    const cookieHeader = c.req.header("cookie");
    if (!cookieHeader)
        return undefined;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match?.[1];
}
//# sourceMappingURL=index.js.map