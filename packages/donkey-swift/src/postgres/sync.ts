import { eq, and, gt, sql } from "drizzle-orm";
import type { SyncDB, DeletedEntry } from "../sync/index.js";
import type { DrizzleDB } from "./index.js";
import { tombstones } from "./schema.js";

/** Mixin: adds SyncDB methods to PostgresDB. */
export function withSyncDB(db: DrizzleDB): SyncDB {
  return {
    async serverTime(): Promise<Date> {
      const [row] = await db.execute<{ now: Date }>(sql`SELECT NOW() AS now`);
      return row.now;
    },

    async tombstones(userId: string, since: Date): Promise<DeletedEntry[]> {
      const rows = await db
        .select()
        .from(tombstones)
        .where(and(eq(tombstones.userId, userId), gt(tombstones.deletedAt, since)))
        .orderBy(sql`${tombstones.deletedAt} ASC`);

      return rows.map((r) => ({
        entity_type: r.entityType,
        entity_id: r.entityId,
        deleted_at: r.deletedAt,
      }));
    },

    async recordTombstone(userId: string, entityType: string, entityId: string): Promise<void> {
      await db.execute(sql`
        INSERT INTO tombstones (entity_type, entity_id, user_id, deleted_at)
        VALUES (${entityType}, ${entityId}, ${userId}, NOW())
        ON CONFLICT (entity_type, entity_id, user_id)
        DO UPDATE SET deleted_at = NOW()
      `);
    },
  };
}
