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

// ── Health Check Factories ─────────────────────────────────────────────────

/** Creates a health check that runs a query against the database. */
export function dbCheck(name: string, queryFn: () => Promise<unknown>): Check {
  return {
    name,
    fn: async () => {
      await queryFn();
    },
  };
}

/** Creates a health check that verifies a URL is reachable (HEAD request with timeout). */
export function urlCheck(name: string, url: string, timeoutMs = 5000): Check {
  return {
    name,
    fn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "HEAD",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Creates a health check for S3/storage connectivity using a HEAD bucket operation. */
export function storageCheck(name: string, headFn: () => Promise<unknown>): Check {
  return {
    name,
    fn: async () => {
      await headFn();
    },
  };
}

/** Creates a health check that verifies a push provider can generate a token. */
export function pushCheck(name: string, tokenFn: () => Promise<unknown>): Check {
  return {
    name,
    fn: async () => {
      await tokenFn();
    },
  };
}
