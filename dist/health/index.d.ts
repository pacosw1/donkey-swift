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
//# sourceMappingURL=index.d.ts.map