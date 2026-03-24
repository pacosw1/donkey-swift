import { randomBytes } from "node:crypto";
// ── Service ─────────────────────────────────────────────────────────────────
export class AttestService {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Generate a hex nonce for attestation challenges. */
    generateHexNonce() {
        return randomBytes(32).toString("hex");
    }
    /** POST /api/v1/attest/challenge */
    handleChallenge = async (c) => {
        const nonce = this.generateHexNonce();
        return c.json({ nonce });
    };
    /** POST /api/v1/attest/verify */
    handleVerify = async (c) => {
        if (!this.db)
            return c.json({ error: "attestation not configured" }, 501);
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.key_id)
            return c.json({ error: "key_id is required" }, 400);
        try {
            await this.db.storeAttestKey(userId, body.key_id);
        }
        catch {
            return c.json({ error: "failed to store attestation key" }, 500);
        }
        return c.json({ status: "verified" });
    };
    /** Middleware: require valid attestation. */
    requireAttest = async (c, next) => {
        if (!this.db)
            return c.json({ error: "attestation not configured" }, 501);
        const userId = c.get("userId");
        if (!userId)
            return c.json({ error: "unauthorized" }, 401);
        const keyId = await this.db.getAttestKey(userId).catch(() => "");
        if (!keyId)
            return c.json({ error: "device not attested" }, 403);
        await next();
    };
}
//# sourceMappingURL=index.js.map