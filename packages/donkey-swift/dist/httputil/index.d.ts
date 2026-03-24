/** JSON response with the given status code. */
export declare function jsonResponse(status: number, data: unknown): Response;
/** JSON error response: { "error": message }. */
export declare function errorResponse(status: number, message: string): Response;
/** Decode JSON request body into type T. */
export declare function decodeJson<T>(request: Request): Promise<T>;
/** Extract client IP from X-Forwarded-For, X-Real-IP, or connection. */
export declare function getClientIp(request: Request): string;
//# sourceMappingURL=index.d.ts.map