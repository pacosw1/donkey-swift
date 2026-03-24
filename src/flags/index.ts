import type { Context } from "hono";

// ── Types & Interfaces ──────────────────────────────────────────────────────

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

// ── Service ─────────────────────────────────────────────────────────────────

export class FlagsService {
  constructor(private db: FlagsDB) {}

  /** Check if a flag is enabled for a user. Priority: override > rollout % > flag default. */
  async isEnabled(key: string, userId: string): Promise<boolean> {
    // 1. User override
    const override = await this.db.getUserOverride(key, userId).catch(() => null);
    if (override !== null) return override;

    // 2. Flag default
    const flag = await this.db.getFlag(key).catch(() => null);
    if (!flag || !flag.enabled) return false;

    // 3. Rollout percentage
    if (flag.rollout_pct >= 100) return true;
    if (flag.rollout_pct <= 0) return false;

    const hash = crc32(`${key}:${userId}`);
    return (hash % 100) < flag.rollout_pct;
  }

  /** GET /api/v1/flags/:key */
  handleCheck = async (c: Context) => {
    const userId = c.get("userId") as string;
    const key = c.req.param("key");
    if (!key) return c.json({ error: "flag key is required" }, 400);

    const enabled = await this.isEnabled(key, userId);
    return c.json({ key, enabled });
  };

  /** POST /api/v1/flags/check */
  handleBatchCheck = async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{ keys?: string[] }>();
    if (!body.keys?.length) return c.json({ error: "keys array is required" }, 400);

    const result: Record<string, boolean> = {};
    for (const key of body.keys) {
      result[key] = await this.isEnabled(key, userId);
    }
    return c.json({ flags: result });
  };

  /** GET /admin/api/flags */
  handleAdminList = async (c: Context) => {
    const flags = await this.db.listFlags().catch(() => []);
    return c.json({ flags });
  };

  /** POST /admin/api/flags */
  handleAdminCreate = async (c: Context) => {
    const body = await c.req.json<{
      key?: string;
      enabled?: boolean;
      rollout_pct?: number;
      description?: string;
    }>();
    if (!body.key) return c.json({ error: "key is required" }, 400);

    const flag: Flag = {
      key: body.key,
      enabled: body.enabled ?? true,
      rollout_pct: body.rollout_pct ?? 100,
      description: body.description ?? "",
      created_at: new Date(),
      updated_at: new Date(),
    };

    try {
      await this.db.upsertFlag(flag);
    } catch {
      return c.json({ error: "failed to create flag" }, 500);
    }
    return c.json(flag, 201);
  };

  /** PUT /admin/api/flags/:key */
  handleAdminUpdate = async (c: Context) => {
    const key = c.req.param("key");
    if (!key) return c.json({ error: "flag key is required" }, 400);

    const existing = await this.db.getFlag(key);
    if (!existing) return c.json({ error: "flag not found" }, 404);

    const body = await c.req.json<{
      enabled?: boolean;
      rollout_pct?: number;
      description?: string;
    }>();

    if (body.enabled !== undefined) existing.enabled = body.enabled;
    if (body.rollout_pct !== undefined) existing.rollout_pct = body.rollout_pct;
    if (body.description !== undefined) existing.description = body.description;
    existing.updated_at = new Date();

    try {
      await this.db.upsertFlag(existing);
    } catch {
      return c.json({ error: "failed to update flag" }, 500);
    }
    return c.json(existing);
  };

  /** DELETE /admin/api/flags/:key */
  handleAdminDelete = async (c: Context) => {
    const key = c.req.param("key");
    if (!key) return c.json({ error: "flag key is required" }, 400);

    try {
      await this.db.deleteFlag(key);
    } catch {
      return c.json({ error: "failed to delete flag" }, 500);
    }
    return c.json({ status: "deleted" });
  };
}
