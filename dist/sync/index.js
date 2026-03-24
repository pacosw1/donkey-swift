// ── Service ─────────────────────────────────────────────────────────────────
const HEADER_DEVICE_ID = "x-device-id";
const HEADER_IDEMPOTENCY_KEY = "x-idempotency-key";
export class SyncService {
    db;
    handler;
    push;
    tokens;
    idempCache = new Map();
    idempTtlMs;
    cleanupInterval;
    constructor(db, handler, cfg) {
        this.db = db;
        this.handler = handler;
        this.push = cfg?.push;
        this.tokens = cfg?.deviceTokens;
        this.idempTtlMs = cfg?.idempotencyTtlMs ?? 24 * 60 * 60 * 1000;
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [k, entry] of this.idempCache) {
                if (now > entry.expiresAt)
                    this.idempCache.delete(k);
            }
        }, 5 * 60 * 1000);
    }
    close() {
        clearInterval(this.cleanupInterval);
    }
    /** GET /api/v1/sync/changes?since={ISO8601} */
    handleSyncChanges = async (c) => {
        const userId = c.get("userId");
        const deviceId = c.req.header(HEADER_DEVICE_ID) ?? "";
        let syncedAt;
        try {
            syncedAt = await this.db.serverTime();
        }
        catch {
            return c.json({ error: "failed to get server time" }, 500);
        }
        const sinceStr = c.req.query("since");
        let since = new Date(0);
        if (sinceStr) {
            const parsed = new Date(sinceStr);
            if (isNaN(parsed.getTime()))
                return c.json({ error: "invalid 'since' format, use ISO8601" }, 400);
            since = parsed;
        }
        let deleted;
        try {
            deleted = await this.db.tombstones(userId, since);
        }
        catch {
            return c.json({ error: "failed to query tombstones" }, 500);
        }
        const result = {
            deleted: deleted ?? [],
            synced_at: syncedAt,
        };
        try {
            const entities = await this.handler.changedSince(userId, since, deviceId);
            for (const [k, v] of Object.entries(entities)) {
                if (k !== "deleted" && k !== "synced_at")
                    result[k] = v;
            }
        }
        catch {
            return c.json({ error: "failed to query changes" }, 500);
        }
        return c.json(result);
    };
    /** POST /api/v1/sync/batch */
    handleSyncBatch = async (c) => {
        const userId = c.get("userId");
        const deviceId = c.req.header(HEADER_DEVICE_ID) ?? "";
        const rawIdempKey = c.req.header(HEADER_IDEMPOTENCY_KEY) ?? "";
        const idempKey = rawIdempKey ? `${userId}:${rawIdempKey}` : "";
        // Check idempotency cache
        if (idempKey) {
            const cached = this.idempCache.get(idempKey);
            if (cached && Date.now() < cached.expiresAt) {
                return c.json(cached.resp);
            }
        }
        const body = await c.req.json();
        if (!body.items?.length)
            return c.json({ error: "items array is required" }, 400);
        if (body.items.length > 500)
            return c.json({ error: "maximum 500 items per batch" }, 400);
        for (const item of body.items) {
            if (!item.client_id)
                return c.json({ error: "items[].client_id is required" }, 400);
            if (!item.entity_type)
                return c.json({ error: "items[].entity_type is required" }, 400);
            if (item.version < 0)
                return c.json({ error: "items[].version must be >= 0" }, 400);
            if (!item.fields)
                item.fields = {};
        }
        let syncedAt;
        try {
            syncedAt = await this.db.serverTime();
        }
        catch {
            return c.json({ error: "failed to get server time" }, 500);
        }
        let items;
        let errors;
        try {
            ({ items, errors } = await this.handler.batchUpsert(userId, deviceId, body.items));
        }
        catch {
            return c.json({ error: "batch upsert failed" }, 500);
        }
        const resp = {
            items: items ?? [],
            errors: errors ?? [],
            synced_at: syncedAt,
        };
        if (idempKey) {
            this.idempCache.set(idempKey, { resp, expiresAt: Date.now() + this.idempTtlMs });
        }
        if (resp.items.length > 0) {
            this.notifyOtherDevices(userId, deviceId);
        }
        return c.json(resp);
    };
    /** DELETE /api/v1/sync/:entity_type/:id */
    handleSyncDelete = async (c) => {
        const userId = c.get("userId");
        const deviceId = c.req.header(HEADER_DEVICE_ID) ?? "";
        const entityType = c.req.param("entity_type");
        const entityId = c.req.param("id");
        if (!entityType || !entityId)
            return c.json({ error: "entity_type and id are required" }, 400);
        try {
            await this.handler.delete(userId, entityType, entityId);
        }
        catch {
            return c.json({ error: "failed to delete entity" }, 500);
        }
        try {
            await this.db.recordTombstone(userId, entityType, entityId);
        }
        catch {
            return c.json({ error: "failed to record tombstone" }, 500);
        }
        this.notifyOtherDevices(userId, deviceId);
        return c.json({ status: "deleted" });
    };
    notifyOtherDevices(userId, excludeDeviceId) {
        if (!this.push || !this.tokens)
            return;
        // Fire and forget
        this.tokens.enabledTokensForUser(userId).then((devices) => {
            const data = { action: "sync" };
            for (const d of devices) {
                if (d.deviceId === excludeDeviceId)
                    continue;
                this.push.sendSilent(d.token, data).catch((err) => {
                    console.log(`[sync] silent push failed for device ${d.deviceId}: ${err}`);
                });
            }
        }).catch((err) => {
            console.log(`[sync] failed to get device tokens for ${userId}: ${err}`);
        });
    }
}
//# sourceMappingURL=index.js.map