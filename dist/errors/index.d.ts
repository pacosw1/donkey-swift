/** Base error for all service errors. */
export declare class ServiceError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Input validation failed (maps to HTTP 400). */
export declare class ValidationError extends ServiceError {
    constructor(message: string);
}
/** Authentication required or failed (maps to HTTP 401). */
export declare class UnauthorizedError extends ServiceError {
    constructor(message?: string);
}
/** Access denied (maps to HTTP 403). */
export declare class ForbiddenError extends ServiceError {
    constructor(message?: string);
}
/** Resource not found (maps to HTTP 404). */
export declare class NotFoundError extends ServiceError {
    constructor(message?: string);
}
/** Feature or service not configured (maps to HTTP 501). */
export declare class NotConfiguredError extends ServiceError {
    constructor(message?: string);
}
/** Rate limit exceeded (maps to HTTP 429). */
export declare class RateLimitError extends ServiceError {
    constructor(message?: string);
}
/** Conflict (maps to HTTP 409). */
export declare class ConflictError extends ServiceError {
    constructor(message?: string);
}
/**
 * Helper to map a ServiceError to an HTTP status code.
 * Useful if you want a generic error handler in your routes.
 */
export declare function errorToStatus(err: ServiceError): number;
//# sourceMappingURL=index.d.ts.map