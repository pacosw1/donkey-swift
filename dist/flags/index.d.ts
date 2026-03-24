import type { Context } from "hono";
export interface FlagsDB {
    upsertFlag(flag: Flag): Promise<void>;
    getFlag(key: string): Promise<Flag | null>;
    listFlags(): Promise<Flag[]>;
    deleteFlag(key: string): Promise<void>;
    getUserOverride(key: string, userId: string): Promise<boolean | null>;
    setUserOverride(key: string, userId: string, enabled: boolean): Promise<void>;
    deleteUserOverride(key: string, userId: string): Promise<void>;
}
export interface Flag {
    key: string;
    enabled: boolean;
    rollout_pct: number;
    description: string;
    created_at: Date;
    updated_at: Date;
}
export declare class FlagsService {
    private db;
    constructor(db: FlagsDB);
    /** Check if a flag is enabled for a user. Priority: override > rollout % > flag default. */
    isEnabled(key: string, userId: string): Promise<boolean>;
    /** GET /api/v1/flags/:key */
    handleCheck: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        key: string;
        enabled: boolean;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
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
        created_at: string;
        updated_at: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** DELETE /admin/api/flags/:key */
    handleAdminDelete: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
}
//# sourceMappingURL=index.d.ts.map