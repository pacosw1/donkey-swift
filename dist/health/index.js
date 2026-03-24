export class HealthService {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    /** Run health check (liveness). Always returns ok. */
    health() {
        return { status: "ok" };
    }
    /** Run readiness checks. Returns check results and overall status. */
    async ready() {
        const checks = {};
        let allOk = true;
        for (const check of this.cfg.checks ?? []) {
            try {
                await check.fn();
                checks[check.name] = "ok";
            }
            catch (err) {
                checks[check.name] = String(err);
                allOk = false;
            }
        }
        return { status: allOk ? "ready" : "not_ready", checks };
    }
}
// ── Health Check Factories ─────────────────────────────────────────────────
/** Creates a health check that runs a query against the database. */
export function dbCheck(name, queryFn) {
    return { name, fn: async () => { await queryFn(); } };
}
/** Creates a health check that verifies a URL is reachable (HEAD request with timeout). */
export function urlCheck(name, url, timeoutMs = 5000) {
    return {
        name,
        fn: async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(url, { method: "HEAD", signal: controller.signal });
                if (!res.ok)
                    throw new Error(`HTTP ${res.status}`);
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
/** Creates a health check for S3/storage connectivity. */
export function storageCheck(name, headFn) {
    return { name, fn: async () => { await headFn(); } };
}
/** Creates a health check that verifies a push provider can generate a token. */
export function pushCheck(name, tokenFn) {
    return { name, fn: async () => { await tokenFn(); } };
}
//# sourceMappingURL=index.js.map