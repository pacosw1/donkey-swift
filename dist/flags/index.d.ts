import type { Context } from "hono";
export interface FlagsDB {
    upsertFlag(flag: Flag): Promise<void>;
    getFlag(key: string): Promise<Flag | null>;
    listFlags(): Promise<Flag[]>;
    deleteFlag(key: string): Promise<void>;
    getUserOverride(key: string, userId: string): Promise<boolean | null>;
    setUserOverride(key: string, userId: string, enabled: boolean): Promise<void>;
    deleteUserOverride(key: string, userId: string): Promise<void>;
    /** Optional: fetch multiple flags in one query. Falls back to sequential getFlag if not provided. */
    getFlags?(keys: string[]): Promise<Flag[]>;
}
export interface Flag {
    key: string;
    enabled: boolean;
    rollout_pct: number;
    description: string;
    /** Optional typed value (string, number, or JSON). Null for boolean-only flags. */
    value?: string | null;
    /** Value type for non-boolean flags. */
    value_type?: "boolean" | "string" | "number" | "json";
    created_at: Date;
    updated_at: Date;
}
export interface FlagsConfig {
    /** In-memory cache TTL in ms (default: 0 = no cache). Set to e.g. 30000 for 30s cache. */
    cacheTtlMs?: number;
}
export declare class FlagsService {
    private db;
    private cache;
    private cacheTtlMs;
    constructor(db: FlagsDB, cfg?: FlagsConfig);
    private getCachedFlag;
    /** Invalidate the cache for a specific key (called after admin mutations). */
    invalidate(key: string): void;
    /** Clear the entire flag cache. */
    clearCache(): void;
    /** Check if a flag is enabled for a user. Priority: override > rollout % > flag default. */
    isEnabled(key: string, userId: string): Promise<boolean>;
    /** Get a flag's typed value for a user. Returns null if flag is disabled or user is not in rollout. */
    getValue(key: string, userId: string): Promise<string | number | Record<string, unknown> | null>;
    /** GET /api/v1/flags/:key */
    handleCheck: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        [x: string]: import("hono/utils/types").JSONValue;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">)>;
    /** POST /api/v1/flags/check */
    handleBatchCheck: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        flags: {
            [x: string]: boolean;
        };
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** GET /admin/api/flags */
    handleAdminList: (c: Context) => Promise<Response & import("hono").TypedResponse<{
        flags: never[] | {
            key: string;
            enabled: boolean;
            rollout_pct: number;
            description: string;
            value?: string | null | undefined;
            value_type?: "boolean" | "string" | "number" | "json" | undefined;
            created_at: string;
            updated_at: string;
        }[];
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">>;
    /** POST /admin/api/flags */
    handleAdminCreate: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        key: string;
        enabled: boolean;
        rollout_pct: number;
        description: string;
        value?: string | null | undefined;
        value_type?: "boolean" | "string" | "number" | "json" | undefined;
        created_at: string;
        updated_at: string;
    }, 201, "json">)>;
    /** PUT /admin/api/flags/:key */
    handleAdminUpdate: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 404, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        key: string;
        enabled: boolean;
        rollout_pct: number;
        description: string;
        value?: string | null | undefined;
        value_type?: "boolean" | "string" | "number" | "json" | undefined;
        created_at: string;
        updated_at: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** DELETE /admin/api/flags/:key */
    handleAdminDelete: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 404, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /admin/api/flags/:key/overrides */
    handleAdminSetOverride: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** DELETE /admin/api/flags/:key/overrides/:user_id */
    handleAdminDeleteOverride: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
}
//# sourceMappingURL=index.d.ts.map