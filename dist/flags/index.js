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
    cache = new Map();
    cacheTtlMs;
    constructor(db, cfg) {
        this.db = db;
        this.cacheTtlMs = cfg?.cacheTtlMs ?? 0;
    }
    async getCachedFlag(key) {
        if (this.cacheTtlMs > 0) {
            const cached = this.cache.get(key);
            if (cached && Date.now() < cached.expiresAt)
                return cached.flag;
        }
        const flag = await this.db.getFlag(key).catch(() => null);
        if (this.cacheTtlMs > 0) {
            this.cache.set(key, { flag, expiresAt: Date.now() + this.cacheTtlMs });
        }
        return flag;
    }
    /** Invalidate the cache for a specific key (called after admin mutations). */
    invalidate(key) {
        this.cache.delete(key);
    }
    /** Clear the entire flag cache. */
    clearCache() {
        this.cache.clear();
    }
    /** Check if a flag is enabled for a user. Priority: override > rollout % > flag default. */
    async isEnabled(key, userId) {
        // 1. User override
        const override = await this.db.getUserOverride(key, userId).catch(() => null);
        if (override !== null)
            return override;
        // 2. Flag default
        const flag = await this.getCachedFlag(key);
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
    /** Get a flag's typed value for a user. Returns null if flag is disabled or user is not in rollout. */
    async getValue(key, userId) {
        const enabled = await this.isEnabled(key, userId);
        if (!enabled)
            return null;
        const flag = await this.getCachedFlag(key);
        if (!flag?.value)
            return null;
        switch (flag.value_type) {
            case "number": return Number(flag.value);
            case "json":
                try {
                    return JSON.parse(flag.value);
                }
                catch {
                    return null;
                }
            default: return flag.value;
        }
    }
    /** GET /api/v1/flags/:key */
    handleCheck = async (c) => {
        const userId = c.get("userId");
        const key = c.req.param("key");
        if (!key)
            return c.json({ error: "flag key is required" }, 400);
        const enabled = await this.isEnabled(key, userId);
        const flag = await this.getCachedFlag(key);
        const result = { key, enabled };
        if (flag?.value && enabled)
            result.value = flag.value;
        return c.json(result);
    };
    /** POST /api/v1/flags/check */
    handleBatchCheck = async (c) => {
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.keys?.length)
            return c.json({ error: "keys array is required" }, 400);
        if (body.keys.length > 100)
            return c.json({ error: "maximum 100 keys per batch" }, 400);
        // Warm cache with bulk fetch if supported
        if (this.db.getFlags && this.cacheTtlMs > 0) {
            const uncached = body.keys.filter((k) => {
                const entry = this.cache.get(k);
                return !entry || Date.now() >= entry.expiresAt;
            });
            if (uncached.length > 0) {
                const flags = await this.db.getFlags(uncached).catch(() => []);
                const now = Date.now();
                for (const flag of flags) {
                    this.cache.set(flag.key, { flag, expiresAt: now + this.cacheTtlMs });
                }
                // Cache misses as null
                for (const key of uncached) {
                    if (!this.cache.has(key) || Date.now() >= this.cache.get(key).expiresAt) {
                        this.cache.set(key, { flag: null, expiresAt: now + this.cacheTtlMs });
                    }
                }
            }
        }
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
        if (body.rollout_pct !== undefined && (body.rollout_pct < 0 || body.rollout_pct > 100)) {
            return c.json({ error: "rollout_pct must be 0-100" }, 400);
        }
        const flag = {
            key: body.key,
            enabled: body.enabled ?? true,
            rollout_pct: body.rollout_pct ?? 100,
            description: body.description ?? "",
            value: body.value ?? null,
            value_type: body.value_type ?? "boolean",
            created_at: new Date(),
            updated_at: new Date(),
        };
        try {
            await this.db.upsertFlag(flag);
        }
        catch {
            return c.json({ error: "failed to create flag" }, 500);
        }
        this.invalidate(flag.key);
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
        if (body.rollout_pct !== undefined && (body.rollout_pct < 0 || body.rollout_pct > 100)) {
            return c.json({ error: "rollout_pct must be 0-100" }, 400);
        }
        if (body.enabled !== undefined)
            existing.enabled = body.enabled;
        if (body.rollout_pct !== undefined)
            existing.rollout_pct = body.rollout_pct;
        if (body.description !== undefined)
            existing.description = body.description;
        if (body.value !== undefined)
            existing.value = body.value;
        if (body.value_type !== undefined)
            existing.value_type = body.value_type;
        existing.updated_at = new Date();
        try {
            await this.db.upsertFlag(existing);
        }
        catch {
            return c.json({ error: "failed to update flag" }, 500);
        }
        this.invalidate(key);
        return c.json(existing);
    };
    /** DELETE /admin/api/flags/:key */
    handleAdminDelete = async (c) => {
        const key = c.req.param("key");
        if (!key)
            return c.json({ error: "flag key is required" }, 400);
        const existing = await this.db.getFlag(key);
        if (!existing)
            return c.json({ error: "flag not found" }, 404);
        try {
            await this.db.deleteFlag(key);
        }
        catch {
            return c.json({ error: "failed to delete flag" }, 500);
        }
        this.invalidate(key);
        return c.json({ status: "deleted" });
    };
    /** POST /admin/api/flags/:key/overrides */
    handleAdminSetOverride = async (c) => {
        const key = c.req.param("key");
        if (!key)
            return c.json({ error: "flag key is required" }, 400);
        const body = await c.req.json();
        if (!body.user_id)
            return c.json({ error: "user_id is required" }, 400);
        if (body.enabled === undefined)
            return c.json({ error: "enabled is required" }, 400);
        try {
            await this.db.setUserOverride(key, body.user_id, body.enabled);
        }
        catch {
            return c.json({ error: "failed to set override" }, 500);
        }
        return c.json({ status: "override set" });
    };
    /** DELETE /admin/api/flags/:key/overrides/:user_id */
    handleAdminDeleteOverride = async (c) => {
        const key = c.req.param("key");
        const userId = c.req.param("user_id");
        if (!key || !userId)
            return c.json({ error: "key and user_id are required" }, 400);
        try {
            await this.db.deleteUserOverride(key, userId);
        }
        catch {
            return c.json({ error: "failed to delete override" }, 500);
        }
        return c.json({ status: "override deleted" });
    };
}
//# sourceMappingURL=index.js.map