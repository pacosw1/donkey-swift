import { eq, sql } from "drizzle-orm";
import type { AuthDB, User } from "../auth/index.js";
import type { DrizzleDB } from "./index.js";
import { users } from "./schema.js";

/** Mixin: adds AuthDB methods to PostgresDB. */
export function withAuthDB(db: DrizzleDB): AuthDB {
  return {
    async upsertUserByAppleSub(
      id: string,
      appleSub: string,
      email: string,
      name: string
    ): Promise<User> {
      const [user] = await db
        .insert(users)
        .values({
          id,
          appleSub,
          email,
          name,
          createdAt: new Date(),
          lastLoginAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.appleSub,
          set: {
            email: sql`COALESCE(NULLIF(${email}, ''), ${users.email})`,
            name: sql`COALESCE(NULLIF(${name}, ''), ${users.name})`,
            lastLoginAt: new Date(),
          },
        })
        .returning();

      return mapUser(user);
    },

    async userById(id: string): Promise<User> {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!user) throw new Error(`user not found: ${id}`);
      return mapUser(user);
    },
  };
}

function mapUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    apple_sub: row.appleSub,
    email: row.email,
    name: row.name,
    created_at: row.createdAt,
    last_login_at: row.lastLoginAt,
  };
}
