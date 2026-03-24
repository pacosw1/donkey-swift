// ── CRC32 for deterministic rollout ─────────────────────────────────────────
function crc32(str) {
    let crc = 0xffffffff;
    for (let i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i);
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
// ── Service ─────────────────────────────────────────────────────────────────
export class FlagsService {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Check if a flag is enabled for a user. Priority: override > rollout % > flag default. */
    async isEnabled(key, userId) {
        // 1. User override
        const override = await this.db.getUserOverride(key, userId).catch(() => null);
        if (override !== null)
            return override;
        // 2. Flag default
        const flag = await this.db.getFlag(key).catch(() => null);
        if (!flag || !flag.enabled)
            return false;
        // 3. Rollout percentage
        if (flag.rollout_pct >= 100)
            return true;
        if (flag.rollout_pct <= 0)
            return false;
        const hash = crc32(`${key}:${userId}`);
        return (hash % 100) < flag.rollout_pct;
    }
    /** GET /api/v1/flags/:key */
    handleCheck = async (c) => {
        const userId = c.get("userId");
        const key = c.req.param("key");
        if (!key)
            return c.json({ error: "flag key is required" }, 400);
        const enabled = await this.isEnabled(key, userId);
        return c.json({ key, enabled });
    };
    /** POST /api/v1/flags/check */
    handleBatchCheck = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.keys?.length)
            return c.json({ error: "keys array is required" }, 400);
        const result = {};
        for (const key of body.keys) {
            result[key] = await this.isEnabled(key, userId);
        }
        return c.json({ flags: result });
    };
    /** GET /admin/api/flags */
    handleAdminList = async (c) => {
        const flags = await this.db.listFlags().catch(() => []);
        return c.json({ flags });
    };
    /** POST /admin/api/flags */
    handleAdminCreate = async (c) => {
        const body = await c.req.json();
        if (!body.key)
            return c.json({ error: "key is required" }, 400);
        const flag = {
            key: body.key,
            enabled: body.enabled ?? true,
            rollout_pct: body.rollout_pct ?? 100,
            description: body.description ?? "",
            created_at: new Date(),
            updated_at: new Date(),
        };
        try {
            await this.db.upsertFlag(flag);
        }
        catch {
            return c.json({ error: "failed to create flag" }, 500);
        }
        return c.json(flag, 201);
    };
    /** PUT /admin/api/flags/:key */
    handleAdminUpdate = async (c) => {
        const key = c.req.param("key");
        if (!key)
            return c.json({ error: "flag key is required" }, 400);
        const existing = await this.db.getFlag(key);
        if (!existing)
            return c.json({ error: "flag not found" }, 404);
        const body = await c.req.json();
        if (body.enabled !== undefined)
            existing.enabled = body.enabled;
        if (body.rollout_pct !== undefined)
            existing.rollout_pct = body.rollout_pct;
        if (body.description !== undefined)
            existing.description = body.description;
        existing.updated_at = new Date();
        try {
            await this.db.upsertFlag(existing);
        }
        catch {
            return c.json({ error: "failed to update flag" }, 500);
        }
        return c.json(existing);
    };
    /** DELETE /admin/api/flags/:key */
    handleAdminDelete = async (c) => {
        const key = c.req.param("key");
        if (!key)
            return c.json({ error: "flag key is required" }, 400);
        try {
            await this.db.deleteFlag(key);
        }
        catch {
            return c.json({ error: "failed to delete flag" }, 500);
        }
        return c.json({ status: "deleted" });
    };
}
//# sourceMappingURL=index.js.map