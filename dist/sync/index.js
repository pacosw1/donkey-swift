import { ValidationError, ServiceError } from "../errors/index.js";
export class SyncService {
    db;
    handler;
    push;
    tokens;
    idempCache = new Map();
    idempTtlMs;
    pushDebounceMs;
    pendingPush = new Map();
    cleanupInterval;
    constructor(db, handler, cfg) {
        this.db = db;
        this.handler = handler;
        this.push = cfg?.push;
        this.tokens = cfg?.deviceTokens;
        this.idempTtlMs = cfg?.idempotencyTtlMs ?? 24 * 60 * 60 * 1000;
        this.pushDebounceMs = cfg?.pushDebounceMs ?? 2500;
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
        for (const { timer } of this.pendingPush.values())
            clearTimeout(timer);
        this.pendingPush.clear();
    }
    async getChanges(userId, opts) {
        const deviceId = opts?.deviceId ?? "";
        let syncedAt;
        try {
            syncedAt = await this.db.serverTime();
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to get server time");
        }
        let since = new Date(0);
        if (opts?.since) {
            const parsed = new Date(opts.since);
            if (isNaN(parsed.getTime()))
                throw new ValidationError("invalid 'since' format, use ISO8601");
            since = parsed;
        }
        let deleted;
        try {
            deleted = await this.db.tombstones(userId, since);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to query tombstones");
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
            throw new ServiceError("INTERNAL", "failed to query changes");
        }
        return result;
    }
    async syncBatch(userId, items, opts) {
        const deviceId = opts?.deviceId ?? "";
        const rawIdempKey = opts?.idempotencyKey ?? "";
        const idempKey = rawIdempKey ? `${userId}:${rawIdempKey}` : "";
        // Check idempotency cache
        if (idempKey) {
            const cached = this.idempCache.get(idempKey);
            if (cached && Date.now() < cached.expiresAt) {
                return cached.resp;
            }
        }
        if (!items?.length)
            throw new ValidationError("items array is required");
        if (items.length > 500)
            throw new ValidationError("maximum 500 items per batch");
        for (const item of items) {
            if (!item.client_id)
                throw new ValidationError("items[].client_id is required");
            if (!item.entity_type)
                throw new ValidationError("items[].entity_type is required");
            if (item.version < 0)
                throw new ValidationError("items[].version must be >= 0");
            if (!item.fields)
                item.fields = {};
        }
        let syncedAt;
        try {
            syncedAt = await this.db.serverTime();
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to get server time");
        }
        let batchItems;
        let errors;
        try {
            ({ items: batchItems, errors } = await this.handler.batchUpsert(userId, deviceId, items));
        }
        catch {
            throw new ServiceError("INTERNAL", "batch upsert failed");
        }
        const resp = {
            items: batchItems ?? [],
            errors: errors ?? [],
            synced_at: syncedAt,
        };
        if (idempKey) {
            this.idempCache.set(idempKey, { resp, expiresAt: Date.now() + this.idempTtlMs });
        }
        if (resp.items.length > 0) {
            this.notifyOtherDevices(userId, deviceId);
        }
        return resp;
    }
    async deleteEntity(userId, entityType, entityId, deviceId) {
        if (!entityType || !entityId)
            throw new ValidationError("entity_type and id are required");
        try {
            await this.handler.delete(userId, entityType, entityId);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to delete entity");
        }
        try {
            await this.db.recordTombstone(userId, entityType, entityId);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to record tombstone");
        }
        this.notifyOtherDevices(userId, deviceId ?? "");
        return { status: "deleted" };
    }
    /** Notify other devices of a sync event. Debounced per user. */
    notifyOtherDevices(userId, excludeDeviceId = "") {
        if (!this.push || !this.tokens) {
            console.log(`[sync] notifyOtherDevices skipped — no push/tokens configured`);
            return;
        }
        // No debounce — fire immediately
        if (this.pushDebounceMs <= 0) {
            this.fireNotify(userId, excludeDeviceId);
            return;
        }
        // Debounce: reset timer on each call, only fire after quiet period
        const existing = this.pendingPush.get(userId);
        if (existing)
            clearTimeout(existing.timer);
        console.log(`[sync] debounced push queued for ${userId} (${this.pushDebounceMs}ms)`);
        const timer = setTimeout(() => {
            this.pendingPush.delete(userId);
            this.fireNotify(userId, excludeDeviceId);
        }, this.pushDebounceMs);
        this.pendingPush.set(userId, { timer, excludeDeviceId });
    }
    fireNotify(userId, excludeDeviceId) {
        this.tokens.enabledTokensForUser(userId).then((devices) => {
            console.log(`[sync] firing silent push for ${userId}: ${devices.length} devices, exclude=${excludeDeviceId || "none"}`);
            const data = { action: "sync" };
            let sent = 0;
            for (const d of devices) {
                // Exclude by deviceId OR by token (iOS sends token as X-Device-Token)
                if (excludeDeviceId && (d.deviceId === excludeDeviceId || d.token === excludeDeviceId)) {
                    console.log(`[sync] skip device ...${d.token.slice(-8)} (requester)`);
                    continue;
                }
                const short = `...${d.token.slice(-8)}`;
                const sendFn = (d.apnsTopic && this.push.sendRich)
                    ? this.push.sendRich(d.token, { aps: { "content-available": 1 }, ...data }, { pushType: "background", priority: "5", topic: d.apnsTopic })
                    : this.push.sendSilent(d.token, data);
                sendFn.then(() => {
                    console.log(`[sync] push sent OK to ${short}`);
                }).catch((err) => {
                    console.log(`[sync] push FAILED for ${short}: ${err}`);
                });
                sent++;
            }
            console.log(`[sync] ${sent} pushes dispatched`);
        }).catch((err) => {
            console.log(`[sync] failed to get device tokens for ${userId}: ${err}`);
        });
    }
}
//# sourceMappingURL=index.js.map