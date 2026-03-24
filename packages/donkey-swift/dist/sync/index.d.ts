import type { Context } from "hono";
import type { PushProvider } from "../push/index.js";
export interface SyncDB {
    serverTime(): Promise<Date>;
    tombstones(userId: string, since: Date): Promise<DeletedEntry[]>;
    recordTombstone(userId: string, entityType: string, entityId: string): Promise<void>;
}
export interface EntityHandler {
    changedSince(userId: string, since: Date, excludeDeviceId: string): Promise<Record<string, unknown>>;
    batchUpsert(userId: string, deviceId: string, items: BatchItem[]): Promise<{
        items: BatchResponseItem[];
        errors: BatchError[];
    }>;
    delete(userId: string, entityType: string, entityId: string): Promise<void>;
}
export interface DeviceTokenStore {
    enabledTokensForUser(userId: string): Promise<DeviceInfo[]>;
}
export interface DeletedEntry {
    entity_type: string;
    entity_id: string;
    deleted_at: Date;
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
    synced_at: Date;
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
}
export declare class SyncService {
    private db;
    private handler;
    private push?;
    private tokens?;
    private idempCache;
    private idempTtlMs;
    private cleanupInterval;
    constructor(db: SyncDB, handler: EntityHandler, cfg?: SyncConfig);
    close(): void;
    /** GET /api/v1/sync/changes?since={ISO8601} */
    handleSyncChanges: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        [x: string]: import("hono/utils/types").JSONValue;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /api/v1/sync/batch */
    handleSyncBatch: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        items: {
            client_id: string;
            server_id: string;
            version: number;
        }[];
        errors: {
            client_id: string;
            error: string;
            is_conflict?: boolean | undefined;
            server_version?: number | undefined;
        }[];
        synced_at: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">)>;
    /** DELETE /api/v1/sync/:entity_type/:id */
    handleSyncDelete: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    private notifyOtherDevices;
}
//# sourceMappingURL=index.d.ts.map