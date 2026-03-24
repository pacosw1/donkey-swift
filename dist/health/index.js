export class HealthService {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    /** GET /health - always 200. Use as a liveness probe. */
    handleHealth = async (c) => {
        return c.json({ status: "ok" });
    };
    /** GET /ready - runs all checks, 503 if any fail. Use as a readiness probe. */
    handleReady = async (c) => {
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
        if (!allOk) {
            return c.json({ status: "not_ready", checks }, 503);
        }
        return c.json({ status: "ready", checks });
    };
}
//# sourceMappingURL=index.js.map