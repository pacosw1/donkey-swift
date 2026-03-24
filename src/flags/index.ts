import { ValidationError, NotFoundError, ServiceError } from "../errors/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

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

// ── CRC32 for deterministic rollout ─────────────────────────────────────────

function crc32(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  flag: Flag | null;
  expiresAt: number;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class FlagsService {
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs: number;

  constructor(private db: FlagsDB, cfg?: FlagsConfig) {
    this.cacheTtlMs = cfg?.cacheTtlMs ?? 0;
  }

  private async getCachedFlag(key: string): Promise<Flag | null> {
    if (this.cacheTtlMs > 0) {
      const cached = this.cache.get(key);
      if (cached && Date.now() < cached.expiresAt) return cached.flag;
    }
    const flag = await this.db.getFlag(key).catch(() => null);
    if (this.cacheTtlMs > 0) {
      this.cache.set(key, { flag, expiresAt: Date.now() + this.cacheTtlMs });
    }
    return flag;
  }

  /** Invalidate the cache for a specific key (called after admin mutations). */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /** Clear the entire flag cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Check if a flag is enabled for a user. Priority: override > rollout % > flag default. */
  async isEnabled(key: string, userId: string): Promise<boolean> {
    // 1. User override
    const override = await this.db.getUserOverride(key, userId).catch(() => null);
    if (override !== null) return override;

    // 2. Flag default
    const flag = await this.getCachedFlag(key);
    if (!flag || !flag.enabled) return false;

    // 3. Rollout percentage
    if (flag.rollout_pct >= 100) return true;
    if (flag.rollout_pct <= 0) return false;

    const hash = crc32(`${key}:${userId}`);
    return (hash % 100) < flag.rollout_pct;
  }

  /** Get a flag's typed value for a user. Returns null if flag is disabled or user is not in rollout. */
  async getValue(key: string, userId: string): Promise<string | number | Record<string, unknown> | null> {
    const enabled = await this.isEnabled(key, userId);
    if (!enabled) return null;

    const flag = await this.getCachedFlag(key);
    if (!flag?.value) return null;

    switch (flag.value_type) {
      case "number": return Number(flag.value);
      case "json":
        try { return JSON.parse(flag.value); }
        catch { return null; }
      default: return flag.value;
    }
  }

  async check(userId: string, key: string): Promise<{ key: string; enabled: boolean; value?: string | null }> {
    if (!key) throw new ValidationError("flag key is required");

    const enabled = await this.isEnabled(key, userId);
    const flag = await this.getCachedFlag(key);
    const result: { key: string; enabled: boolean; value?: string | null } = { key, enabled };
    if (flag?.value && enabled) result.value = flag.value;
    return result;
  }

  async batchCheck(userId: string, keys: string[]): Promise<{ flags: Record<string, boolean> }> {
    if (!keys?.length) throw new ValidationError("keys array is required");
    if (keys.length > 100) throw new ValidationError("maximum 100 keys per batch");

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
          if (!this.cache.has(key) || Date.now() >= this.cache.get(key)!.expiresAt) {
            this.cache.set(key, { flag: null, expiresAt: now + this.cacheTtlMs });
          }
        }
      }
    }

    const result: Record<string, boolean> = {};
    for (const key of keys) {
      result[key] = await this.isEnabled(key, userId);
    }
    return { flags: result };
  }

  async listFlags(): Promise<{ flags: Flag[] }> {
    const flags = await this.db.listFlags().catch(() => []);
    return { flags };
  }

  async createFlag(input: {
    key?: string;
    enabled?: boolean;
    rollout_pct?: number;
    description?: string;
    value?: string;
    value_type?: string;
  }): Promise<Flag> {
    if (!input.key) throw new ValidationError("key is required");
    if (input.rollout_pct !== undefined && (input.rollout_pct < 0 || input.rollout_pct > 100)) {
      throw new ValidationError("rollout_pct must be 0-100");
    }

    const flag: Flag = {
      key: input.key,
      enabled: input.enabled ?? true,
      rollout_pct: input.rollout_pct ?? 100,
      description: input.description ?? "",
      value: input.value ?? null,
      value_type: (input.value_type as Flag["value_type"]) ?? "boolean",
      created_at: new Date(),
      updated_at: new Date(),
    };

    try {
      await this.db.upsertFlag(flag);
    } catch {
      throw new ServiceError("INTERNAL", "failed to create flag");
    }
    this.invalidate(flag.key);
    return flag;
  }

  async updateFlag(key: string, input: {
    enabled?: boolean;
    rollout_pct?: number;
    description?: string;
    value?: string;
    value_type?: string;
  }): Promise<Flag> {
    if (!key) throw new ValidationError("flag key is required");

    const existing = await this.db.getFlag(key);
    if (!existing) throw new NotFoundError("flag not found");

    if (input.rollout_pct !== undefined && (input.rollout_pct < 0 || input.rollout_pct > 100)) {
      throw new ValidationError("rollout_pct must be 0-100");
    }

    if (input.enabled !== undefined) existing.enabled = input.enabled;
    if (input.rollout_pct !== undefined) existing.rollout_pct = input.rollout_pct;
    if (input.description !== undefined) existing.description = input.description;
    if (input.value !== undefined) existing.value = input.value;
    if (input.value_type !== undefined) existing.value_type = input.value_type as Flag["value_type"];
    existing.updated_at = new Date();

    try {
      await this.db.upsertFlag(existing);
    } catch {
      throw new ServiceError("INTERNAL", "failed to update flag");
    }
    this.invalidate(key);
    return existing;
  }

  async deleteFlag(key: string): Promise<{ status: string }> {
    if (!key) throw new ValidationError("flag key is required");

    const existing = await this.db.getFlag(key);
    if (!existing) throw new NotFoundError("flag not found");

    try {
      await this.db.deleteFlag(key);
    } catch {
      throw new ServiceError("INTERNAL", "failed to delete flag");
    }
    this.invalidate(key);
    return { status: "deleted" };
  }

  async setOverride(key: string, userId: string, enabled: boolean): Promise<void> {
    if (!key) throw new ValidationError("flag key is required");
    if (!userId) throw new ValidationError("user_id is required");
    if (enabled === undefined) throw new ValidationError("enabled is required");

    try {
      await this.db.setUserOverride(key, userId, enabled);
    } catch {
      throw new ServiceError("INTERNAL", "failed to set override");
    }
  }

  async deleteOverride(key: string, userId: string): Promise<void> {
    if (!key || !userId) throw new ValidationError("key and user_id are required");

    try {
      await this.db.deleteUserOverride(key, userId);
    } catch {
      throw new ServiceError("INTERNAL", "failed to delete override");
    }
  }
}
