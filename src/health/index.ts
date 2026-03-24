import type { Context } from "hono";

/** A named health check. */
export interface Check {
  name: string;
  fn: () => Promise<void>;
}

export interface HealthConfig {
  checks?: Check[];
}

export class HealthService {
  constructor(private cfg: HealthConfig) {}

  /** GET /health - always 200. Use as a liveness probe. */
  handleHealth = async (c: Context) => {
    return c.json({ status: "ok" });
  };

  /** GET /ready - runs all checks, 503 if any fail. Use as a readiness probe. */
  handleReady = async (c: Context) => {
    const checks: Record<string, string> = {};
    let allOk = true;

    for (const check of this.cfg.checks ?? []) {
      try {
        await check.fn();
        checks[check.name] = "ok";
      } catch (err) {
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
