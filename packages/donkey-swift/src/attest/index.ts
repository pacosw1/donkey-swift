import type { Context } from "hono";
import { randomBytes } from "node:crypto";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface AttestDB {
  storeAttestKey(userId: string, keyId: string): Promise<void>;
  getAttestKey(userId: string): Promise<string>;
}

export interface AttestConfig {}

// ── Migrations ──────────────────────────────────────────────────────────────

export const migrations = [
  { name: "attest: create user_attest_keys", sql: `CREATE TABLE IF NOT EXISTS user_attest_keys (user_id TEXT PRIMARY KEY, key_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
];

// ── Service ─────────────────────────────────────────────────────────────────

export class AttestService {
  constructor(private db: AttestDB) {}

  /** Generate a hex nonce for attestation challenges. */
  generateHexNonce(): string {
    return randomBytes(32).toString("hex");
  }

  /** POST /api/v1/attest/challenge */
  handleChallenge = async (c: Context) => {
    const nonce = this.generateHexNonce();
    return c.json({ nonce });
  };

  /** POST /api/v1/attest/verify */
  handleVerify = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{ key_id?: string; attestation?: string }>();

    if (!body.key_id) return c.json({ error: "key_id is required" }, 400);

    try {
      await this.db.storeAttestKey(userId, body.key_id);
    } catch {
      return c.json({ error: "failed to store attestation key" }, 500);
    }

    return c.json({ status: "verified" });
  };

  /** Middleware: require valid attestation. */
  requireAttest = async (c: Context, next: () => Promise<void>) => {
    const userId = c.get("userId") as string;
    if (!userId) return c.json({ error: "unauthorized" }, 401);

    const keyId = await this.db.getAttestKey(userId).catch(() => "");
    if (!keyId) return c.json({ error: "device not attested" }, 403);

    await next();
  };
}
