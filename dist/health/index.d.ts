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
    /** Run health check (liveness). Always returns ok. */
    health(): {
        status: string;
    };
    /** Run readiness checks. Returns check results and overall status. */
    ready(): Promise<{
        status: string;
        checks: Record<string, string>;
    }>;
}
/** Creates a health check that runs a query against the database. */
export declare function dbCheck(name: string, queryFn: () => Promise<unknown>): Check;
/** Creates a health check that verifies a URL is reachable (HEAD request with timeout). */
export declare function urlCheck(name: string, url: string, timeoutMs?: number): Check;
/** Creates a health check for S3/storage connectivity. */
export declare function storageCheck(name: string, headFn: () => Promise<unknown>): Check;
/** Creates a health check that verifies a push provider can generate a token. */
export declare function pushCheck(name: string, tokenFn: () => Promise<unknown>): Check;
//# sourceMappingURL=index.d.ts.map