import type { Context } from "hono";
/** A named health check. */
export interface Check {
    name: string;
    fn: () => Promise<void>;
}
export interface HealthConfig {
    checks?: Check[];
}
export declare class HealthService {
    private cfg;
    constructor(cfg: HealthConfig);
    /** GET /health - always 200. Use as a liveness probe. */
    handleHealth: (c: Context) => Promise<Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">>;
    /** GET /ready - runs all checks, 503 if any fail. Use as a readiness probe. */
    handleReady: (c: Context) => Promise<Response & import("hono").TypedResponse<{
        status: string;
        checks: {
            [x: string]: string;
        };
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">>;
}
/** Creates a health check that runs a query against the database. */
export declare function dbCheck(name: string, queryFn: () => Promise<unknown>): Check;
/** Creates a health check that verifies a URL is reachable (HEAD request with timeout). */
export declare function urlCheck(name: string, url: string, timeoutMs?: number): Check;
/** Creates a health check for S3/storage connectivity using a HEAD bucket operation. */
export declare function storageCheck(name: string, headFn: () => Promise<unknown>): Check;
/** Creates a health check that verifies a push provider can generate a token. */
export declare function pushCheck(name: string, tokenFn: () => Promise<unknown>): Check;
//# sourceMappingURL=index.d.ts.map