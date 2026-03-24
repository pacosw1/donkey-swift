import type { Context } from "hono";
import type { PushProvider } from "../push/index.js";

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

const HEADER_DEVICE_ID = "x-device-id";
const HEADER_DEVICE_TOKEN = "x-device-token";
const HEADER_IDEMPOTENCY_KEY = "x-idempotency-key";

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
  private pendingPush = new Map<string, { timer: ReturnType<typeof setTimeout>; excludeDeviceId: string }>();
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

  /** GET /api/v1/sync/changes?since={ISO8601} */
  handleSyncChanges = async (c: Context) => {
    const userId = c.get("userId") as string;
    const deviceId = c.req.header(HEADER_DEVICE_ID) || c.req.header(HEADER_DEVICE_TOKEN) || "";

    let syncedAt: Date | string;
    try {
      syncedAt = await this.db.serverTime();
    } catch {
      return c.json({ error: "failed to get server time" }, 500);
    }

    const sinceStr = c.req.query("since");
    let since = new Date(0);
    if (sinceStr) {
      const parsed = new Date(sinceStr);
      if (isNaN(parsed.getTime())) return c.json({ error: "invalid 'since' format, use ISO8601" }, 400);
      since = parsed;
    }

    let deleted: DeletedEntry[];
    try {
      deleted = await this.db.tombstones(userId, since);
    } catch {
      return c.json({ error: "failed to query tombstones" }, 500);
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
      return c.json({ error: "failed to query changes" }, 500);
    }

    return c.json(result);
  };

  /** POST /api/v1/sync/batch */
  handleSyncBatch = async (c: Context) => {
    const userId = c.get("userId") as string;
    const deviceId = c.req.header(HEADER_DEVICE_ID) || c.req.header(HEADER_DEVICE_TOKEN) || "";
    const rawIdempKey = c.req.header(HEADER_IDEMPOTENCY_KEY) ?? "";
    const idempKey = rawIdempKey ? `${userId}:${rawIdempKey}` : "";

    // Check idempotency cache
    if (idempKey) {
      const cached = this.idempCache.get(idempKey);
      if (cached && Date.now() < cached.expiresAt) {
        return c.json(cached.resp);
      }
    }

    const body = await c.req.json<{ items?: BatchItem[] }>();
    if (!body.items?.length) return c.json({ error: "items array is required" }, 400);
    if (body.items.length > 500) return c.json({ error: "maximum 500 items per batch" }, 400);

    for (const item of body.items) {
      if (!item.client_id) return c.json({ error: "items[].client_id is required" }, 400);
      if (!item.entity_type) return c.json({ error: "items[].entity_type is required" }, 400);
      if (item.version < 0) return c.json({ error: "items[].version must be >= 0" }, 400);
      if (!item.fields) item.fields = {};
    }

    let syncedAt: Date | string;
    try {
      syncedAt = await this.db.serverTime();
    } catch {
      return c.json({ error: "failed to get server time" }, 500);
    }

    let items: BatchResponseItem[];
    let errors: BatchError[];
    try {
      ({ items, errors } = await this.handler.batchUpsert(userId, deviceId, body.items));
    } catch {
      return c.json({ error: "batch upsert failed" }, 500);
    }

    const resp: BatchResponse = {
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
  handleSyncDelete = async (c: Context) => {
    const userId = c.get("userId") as string;
    const deviceId = c.req.header(HEADER_DEVICE_ID) || c.req.header(HEADER_DEVICE_TOKEN) || "";
    const entityType = c.req.param("entity_type");
    const entityId = c.req.param("id");

    if (!entityType || !entityId) return c.json({ error: "entity_type and id are required" }, 400);

    try {
      await this.handler.delete(userId, entityType, entityId);
    } catch {
      return c.json({ error: "failed to delete entity" }, 500);
    }

    try {
      await this.db.recordTombstone(userId, entityType, entityId);
    } catch {
      return c.json({ error: "failed to record tombstone" }, 500);
    }

    this.notifyOtherDevices(userId, deviceId);
    return c.json({ status: "deleted" });
  };

  /** Notify other devices of a sync event. Debounced per user. */
  notifyOtherDevices(userId: string, excludeDeviceId: string = ""): void {
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
    if (existing) clearTimeout(existing.timer);

    console.log(`[sync] debounced push queued for ${userId} (${this.pushDebounceMs}ms)`);

    const timer = setTimeout(() => {
      this.pendingPush.delete(userId);
      this.fireNotify(userId, excludeDeviceId);
    }, this.pushDebounceMs);

    this.pendingPush.set(userId, { timer, excludeDeviceId });
  }

  private fireNotify(userId: string, excludeDeviceId: string): void {
    this.tokens!.enabledTokensForUser(userId).then((devices) => {
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
        this.push!.sendSilent(d.token, data).then(() => {
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
