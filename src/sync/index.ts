import type { PushProvider } from "../push/index.js";
import { ValidationError, ServiceError } from "../errors/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface SyncDB {
  serverTime(): Promise<Date | string>;
  tombstones(userId: string, since: Date | string): Promise<DeletedEntry[]>;
  recordTombstone(userId: string, entityType: string, entityId: string): Promise<void>;
}

export interface EntityHandler {
  changedSince(userId: string, since: Date | string, excludeDeviceId: string): Promise<Record<string, unknown>>;
  batchUpsert(userId: string, deviceId: string, items: BatchItem[]): Promise<{ items: BatchResponseItem[]; errors: BatchError[] }>;
  delete(userId: string, entityType: string, entityId: string): Promise<void>;
}

export interface DeviceTokenStore {
  enabledTokensForUser(userId: string): Promise<DeviceInfo[]>;
}

export interface DeletedEntry {
  entity_type: string;
  entity_id: string;
  deleted_at: Date | string;
}

export interface BatchItem {
  client_id: string;
  entity_type: string;
  entity_id?: string;
  version: number;
  fields: Record<string, unknown>;
}

export interface BatchResponseItem {
  client_id: string;
  server_id: string;
  version: number;
}

export interface BatchError {
  client_id: string;
  error: string;
  is_conflict?: boolean;
  server_version?: number;
}

export interface BatchResponse {
  items: BatchResponseItem[];
  errors: BatchError[];
  synced_at: Date | string;
}

export interface DeviceInfo {
  deviceId: string;
  token: string;
  /** APNs topic override (e.g. for watchOS devices). Passed through to push headers. */
  apnsTopic?: string;
}

export interface DeviceExclude {
  deviceId?: string;
  token?: string;
}

export interface SyncConfig {
  push?: PushProvider;
  deviceTokens?: DeviceTokenStore;
  /** Idempotency TTL in ms (default: 24h). */
  idempotencyTtlMs?: number;
  /** Debounce silent push notifications per user (default: 2500ms, 0 = no debounce). */
  pushDebounceMs?: number;
}

// ── Service ─────────────────────────────────────────────────────────────────

interface IdempEntry {
  resp: BatchResponse;
  expiresAt: number;
}

export class SyncService {
  private push?: PushProvider;
  private tokens?: DeviceTokenStore;
  private idempCache = new Map<string, IdempEntry>();
  private idempTtlMs: number;
  private pushDebounceMs: number;
  private pendingPush = new Map<string, { timer: ReturnType<typeof setTimeout>; exclude: DeviceExclude }>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private db: SyncDB,
    private handler: EntityHandler,
    cfg?: SyncConfig
  ) {
    this.push = cfg?.push;
    this.tokens = cfg?.deviceTokens;
    this.idempTtlMs = cfg?.idempotencyTtlMs ?? 24 * 60 * 60 * 1000;
    this.pushDebounceMs = cfg?.pushDebounceMs ?? 2500;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [k, entry] of this.idempCache) {
        if (now > entry.expiresAt) this.idempCache.delete(k);
      }
    }, 5 * 60 * 1000);
  }

  close(): void {
    clearInterval(this.cleanupInterval);
    for (const { timer } of this.pendingPush.values()) clearTimeout(timer);
    this.pendingPush.clear();
  }

  async getChanges(userId: string, opts?: { since?: string; deviceId?: string; deviceToken?: string }): Promise<Record<string, unknown>> {
    const deviceId = opts?.deviceId ?? "";

    let syncedAt: Date | string;
    try {
      syncedAt = await this.db.serverTime();
    } catch {
      throw new ServiceError("INTERNAL", "failed to get server time");
    }

    let since = new Date(0);
    if (opts?.since) {
      const parsed = new Date(opts.since);
      if (isNaN(parsed.getTime())) throw new ValidationError("invalid 'since' format, use ISO8601");
      since = parsed;
    }

    let deleted: DeletedEntry[];
    try {
      deleted = await this.db.tombstones(userId, since);
    } catch {
      throw new ServiceError("INTERNAL", "failed to query tombstones");
    }

    const result: Record<string, unknown> = {
      deleted: deleted ?? [],
      synced_at: syncedAt,
    };

    try {
      const entities = await this.handler.changedSince(userId, since, deviceId);
      for (const [k, v] of Object.entries(entities)) {
        if (k !== "deleted" && k !== "synced_at") result[k] = v;
      }
    } catch {
      throw new ServiceError("INTERNAL", "failed to query changes");
    }

    return result;
  }

  async syncBatch(userId: string, items: BatchItem[], opts?: { deviceId?: string; deviceToken?: string; idempotencyKey?: string }): Promise<BatchResponse> {
    const deviceId = opts?.deviceId ?? "";
    const deviceToken = opts?.deviceToken ?? "";
    const rawIdempKey = opts?.idempotencyKey ?? "";
    const idempKey = rawIdempKey ? `${userId}:${rawIdempKey}` : "";

    // Check idempotency cache
    if (idempKey) {
      const cached = this.idempCache.get(idempKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.resp;
      }
    }

    if (!items?.length) throw new ValidationError("items array is required");
    if (items.length > 500) throw new ValidationError("maximum 500 items per batch");

    for (const item of items) {
      if (!item.client_id) throw new ValidationError("items[].client_id is required");
      if (!item.entity_type) throw new ValidationError("items[].entity_type is required");
      if (item.version < 0) throw new ValidationError("items[].version must be >= 0");
      if (!item.fields) item.fields = {};
    }

    let syncedAt: Date | string;
    try {
      syncedAt = await this.db.serverTime();
    } catch {
      throw new ServiceError("INTERNAL", "failed to get server time");
    }

    let batchItems: BatchResponseItem[];
    let errors: BatchError[];
    try {
      ({ items: batchItems, errors } = await this.handler.batchUpsert(userId, deviceId, items));
    } catch {
      throw new ServiceError("INTERNAL", "batch upsert failed");
    }

    const resp: BatchResponse = {
      items: batchItems ?? [],
      errors: errors ?? [],
      synced_at: syncedAt,
    };

    if (idempKey) {
      this.idempCache.set(idempKey, { resp, expiresAt: Date.now() + this.idempTtlMs });
    }

    if (resp.items.length > 0) {
      this.notifyOtherDevices(userId, { deviceId: deviceId || undefined, token: deviceToken || undefined });
    }

    return resp;
  }

  async deleteEntity(userId: string, entityType: string, entityId: string, opts?: string | { deviceId?: string; deviceToken?: string }): Promise<{ status: string }> {
    if (!entityType || !entityId) throw new ValidationError("entity_type and id are required");

    // Backward compat: accept a plain string (treated as deviceId) or the new object shape
    const exclude: DeviceExclude = typeof opts === "string"
      ? { deviceId: opts || undefined }
      : { deviceId: opts?.deviceId || undefined, token: opts?.deviceToken || undefined };

    try {
      await this.handler.delete(userId, entityType, entityId);
    } catch {
      throw new ServiceError("INTERNAL", "failed to delete entity");
    }

    try {
      await this.db.recordTombstone(userId, entityType, entityId);
    } catch {
      throw new ServiceError("INTERNAL", "failed to record tombstone");
    }

    this.notifyOtherDevices(userId, exclude);
    return { status: "deleted" };
  }

  /** Notify other devices of a sync event. Debounced per user. */
  notifyOtherDevices(userId: string, exclude?: DeviceExclude): void {
    if (!this.push || !this.tokens) {
      console.log(`[sync] notifyOtherDevices skipped — no push/tokens configured`);
      return;
    }

    const ex: DeviceExclude = exclude ?? {};

    // No debounce — fire immediately
    if (this.pushDebounceMs <= 0) {
      this.fireNotify(userId, ex);
      return;
    }

    // Debounce: reset timer on each call, only fire after quiet period
    const existing = this.pendingPush.get(userId);
    if (existing) clearTimeout(existing.timer);

    console.log(`[sync] debounced push queued for ${userId} (${this.pushDebounceMs}ms)`);

    const timer = setTimeout(() => {
      this.pendingPush.delete(userId);
      this.fireNotify(userId, ex);
    }, this.pushDebounceMs);

    this.pendingPush.set(userId, { timer, exclude: ex });
  }

  private fireNotify(userId: string, exclude: DeviceExclude): void {
    this.tokens!.enabledTokensForUser(userId).then((devices) => {
      console.log(`[sync] firing silent push for ${userId}: ${devices.length} devices, exclude=${JSON.stringify(exclude)}`);
      const data = { action: "sync" };
      let sent = 0;
      for (const d of devices) {
        // Exclude by deviceId and/or token — each field checked independently
        if (exclude) {
          const skip = (exclude.deviceId && d.deviceId === exclude.deviceId) ||
                       (exclude.token && d.token === exclude.token);
          if (skip) {
            console.log(`[sync] skip device ...${d.token.slice(-8)} (requester)`);
            continue;
          }
        }
        const short = `...${d.token.slice(-8)}`;
        const sendFn = (d.apnsTopic && this.push!.sendRich)
          ? this.push!.sendRich(d.token, { aps: { "content-available": 1 }, ...data }, { pushType: "background", priority: "5", topic: d.apnsTopic })
          : this.push!.sendSilent(d.token, data);
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
