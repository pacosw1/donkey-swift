import { ValidationError, NotFoundError, ServiceError } from "../errors/index.js";
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
    async check(userId, key) {
        if (!key)
            throw new ValidationError("flag key is required");
        const enabled = await this.isEnabled(key, userId);
        const flag = await this.getCachedFlag(key);
        const result = { key, enabled };
        if (flag?.value && enabled)
            result.value = flag.value;
        return result;
    }
    async batchCheck(userId, keys) {
        if (!keys?.length)
            throw new ValidationError("keys array is required");
        if (keys.length > 100)
            throw new ValidationError("maximum 100 keys per batch");
        // Warm cache with bulk fetch if supported
        if (this.db.getFlags && this.cacheTtlMs > 0) {
            const uncached = keys.filter((k) => {
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
        for (const key of keys) {
            result[key] = await this.isEnabled(key, userId);
        }
        return { flags: result };
    }
    async listFlags() {
        const flags = await this.db.listFlags().catch(() => []);
        return { flags };
    }
    async createFlag(input) {
        if (!input.key)
            throw new ValidationError("key is required");
        if (input.rollout_pct !== undefined && (input.rollout_pct < 0 || input.rollout_pct > 100)) {
            throw new ValidationError("rollout_pct must be 0-100");
        }
        const flag = {
            key: input.key,
            enabled: input.enabled ?? true,
            rollout_pct: input.rollout_pct ?? 100,
            description: input.description ?? "",
            value: input.value ?? null,
            value_type: input.value_type ?? "boolean",
            created_at: new Date(),
            updated_at: new Date(),
        };
        try {
            await this.db.upsertFlag(flag);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to create flag");
        }
        this.invalidate(flag.key);
        return flag;
    }
    async updateFlag(key, input) {
        if (!key)
            throw new ValidationError("flag key is required");
        const existing = await this.db.getFlag(key);
        if (!existing)
            throw new NotFoundError("flag not found");
        if (input.rollout_pct !== undefined && (input.rollout_pct < 0 || input.rollout_pct > 100)) {
            throw new ValidationError("rollout_pct must be 0-100");
        }
        if (input.enabled !== undefined)
            existing.enabled = input.enabled;
        if (input.rollout_pct !== undefined)
            existing.rollout_pct = input.rollout_pct;
        if (input.description !== undefined)
            existing.description = input.description;
        if (input.value !== undefined)
            existing.value = input.value;
        if (input.value_type !== undefined)
            existing.value_type = input.value_type;
        existing.updated_at = new Date();
        try {
            await this.db.upsertFlag(existing);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to update flag");
        }
        this.invalidate(key);
        return existing;
    }
    async deleteFlag(key) {
        if (!key)
            throw new ValidationError("flag key is required");
        const existing = await this.db.getFlag(key);
        if (!existing)
            throw new NotFoundError("flag not found");
        try {
            await this.db.deleteFlag(key);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to delete flag");
        }
        this.invalidate(key);
        return { status: "deleted" };
    }
    async setOverride(key, userId, enabled) {
        if (!key)
            throw new ValidationError("flag key is required");
        if (!userId)
            throw new ValidationError("user_id is required");
        if (enabled === undefined)
            throw new ValidationError("enabled is required");
        try {
            await this.db.setUserOverride(key, userId, enabled);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to set override");
        }
    }
    async deleteOverride(key, userId) {
        if (!key || !userId)
            throw new ValidationError("key and user_id are required");
        try {
            await this.db.deleteUserOverride(key, userId);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to delete override");
        }
    }
}
//# sourceMappingURL=index.js.map