// ── Service Errors ──────────────────────────────────────────────────────────
//
// Services throw these instead of returning HTTP responses.
// Your route handler catches them and maps to your framework's response format.
//
// Example (Hono):
//   try { const result = await auth.verifyAndLogin(token); return c.json(result); }
//   catch (e) {
//     if (e instanceof ValidationError) return c.json({ error: e.message }, 400);
//     if (e instanceof UnauthorizedError) return c.json({ error: e.message }, 401);
//     if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
//     return c.json({ error: "internal error" }, 500);
//   }
//
// Example (Express):
//   try { const result = await auth.verifyAndLogin(token); res.json(result); }
//   catch (e) {
//     if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
//     ...
//   }
/** Base error for all service errors. */
export class ServiceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ServiceError";
    }
}
/** Input validation failed (maps to HTTP 400). */
export class ValidationError extends ServiceError {
    constructor(message) {
        super("VALIDATION_ERROR", message);
        this.name = "ValidationError";
    }
}
/** Authentication required or failed (maps to HTTP 401). */
export class UnauthorizedError extends ServiceError {
    constructor(message = "unauthorized") {
        super("UNAUTHORIZED", message);
        this.name = "UnauthorizedError";
    }
}
/** Access denied (maps to HTTP 403). */
export class ForbiddenError extends ServiceError {
    constructor(message = "forbidden") {
        super("FORBIDDEN", message);
        this.name = "ForbiddenError";
    }
}
/** Resource not found (maps to HTTP 404). */
export class NotFoundError extends ServiceError {
    constructor(message = "not found") {
        super("NOT_FOUND", message);
        this.name = "NotFoundError";
    }
}
/** Feature or service not configured (maps to HTTP 501). */
export class NotConfiguredError extends ServiceError {
    constructor(message = "not configured") {
        super("NOT_CONFIGURED", message);
        this.name = "NotConfiguredError";
    }
}
/** Rate limit exceeded (maps to HTTP 429). */
export class RateLimitError extends ServiceError {
    constructor(message = "rate limit exceeded") {
        super("RATE_LIMIT", message);
        this.name = "RateLimitError";
    }
}
/** Conflict (maps to HTTP 409). */
export class ConflictError extends ServiceError {
    constructor(message = "conflict") {
        super("CONFLICT", message);
        this.name = "ConflictError";
    }
}
/**
 * Helper to map a ServiceError to an HTTP status code.
 * Useful if you want a generic error handler in your routes.
 */
export function errorToStatus(err) {
    switch (err.code) {
        case "VALIDATION_ERROR": return 400;
        case "UNAUTHORIZED": return 401;
        case "FORBIDDEN": return 403;
        case "NOT_FOUND": return 404;
        case "CONFLICT": return 409;
        case "RATE_LIMIT": return 429;
        case "NOT_CONFIGURED": return 501;
        default: return 500;
    }
}
//# sourceMappingURL=index.js.map