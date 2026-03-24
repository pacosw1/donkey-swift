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
    check(userId: string, key: string): Promise<{
        key: string;
        enabled: boolean;
        value?: string | null;
    }>;
    batchCheck(userId: string, keys: string[]): Promise<{
        flags: Record<string, boolean>;
    }>;
    listFlags(): Promise<{
        flags: Flag[];
    }>;
    createFlag(input: {
        key?: string;
        enabled?: boolean;
        rollout_pct?: number;
        description?: string;
        value?: string;
        value_type?: string;
    }): Promise<Flag>;
    updateFlag(key: string, input: {
        enabled?: boolean;
        rollout_pct?: number;
        description?: string;
        value?: string;
        value_type?: string;
    }): Promise<Flag>;
    deleteFlag(key: string): Promise<{
        status: string;
    }>;
    setOverride(key: string, userId: string, enabled: boolean): Promise<void>;
    deleteOverride(key: string, userId: string): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map