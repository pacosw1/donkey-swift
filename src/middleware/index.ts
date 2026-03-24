import { randomUUID, timingSafeEqual } from "node:crypto";

// ── Rate Limiter ────────────────────────────────────────────────────────────

interface Visitor {
  count: number;
  resetAt: number;
}

/**
 * In-memory rate limiter using a sliding window per key.
 * Framework-agnostic — use in any middleware or route handler.
 *
 * Example:
 *   const rl = new RateLimiter(10, 60_000); // 10 requests per minute
 *   if (!rl.allow(clientIp)) throw new RateLimitError();
 */
export class RateLimiter {
  private visitors = new Map<string, Visitor>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private rate: number,
    private windowMs: number
  ) {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, v] of this.visitors) {
        if (now > v.resetAt) this.visitors.delete(key);
      }
    }, 60_000);
  }

  /** Check if a request from this key should be allowed. */
  allow(key: string): boolean {
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
  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

// ── Token Extraction ────────────────────────────────────────────────────────

/**
 * Extract a Bearer token from an Authorization header value.
 * Returns undefined if the header is missing or not a Bearer token.
 */
export function extractBearerToken(authorizationHeader?: string): string | undefined {
  if (!authorizationHeader?.startsWith("Bearer ")) return undefined;
  return authorizationHeader.slice(7);
}

// ── Timing-Safe Comparison ──────────────────────────────────────────────────

/**
 * Constant-time string comparison. Use for API keys, tokens, secrets.
 * Prevents timing attacks.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ── Request ID ──────────────────────────────────────────────────────────────

/**
 * Generate or pass through a request ID.
 * Uses the provided ID (e.g. from X-Request-ID header) or generates a UUID.
 */
export function resolveRequestId(existing?: string): string {
  return existing || randomUUID();
}
