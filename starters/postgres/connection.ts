/**
 * Database connection setup with pooling configuration.
 *
 * Usage:
 *   import { createDatabase, closeDatabase } from "./connection.js";
 *   const { db, sql } = createDatabase(process.env.DATABASE_URL!);
 *   // ...use db with PostgresDB...
 *   process.on("SIGTERM", () => closeDatabase(sql));
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import type { DrizzleDB } from "./index.js";

export interface ConnectionConfig {
  /** PostgreSQL connection string (e.g. postgres://user:pass@host:5432/dbname). */
  connectionString: string;
  /** Maximum number of connections in the pool (default: 10). */
  maxConnections?: number;
  /** Idle connection timeout in seconds (default: 20). */
  idleTimeoutSec?: number;
  /** Connection acquisition timeout in seconds (default: 30). */
  connectTimeoutSec?: number;
  /** Statement timeout in seconds (default: 30). Prevents long-running queries. */
  statementTimeoutSec?: number;
  /** Enable SSL (default: true in production). */
  ssl?: boolean | "require" | "prefer";
}

export interface DatabaseConnection {
  /** Drizzle ORM instance — pass this to PostgresDB constructor. */
  db: DrizzleDB;
  /** Raw postgres.js client — needed for shutdown. */
  sql: postgres.Sql;
}

/**
 * Creates a pooled database connection with production-ready defaults.
 *
 * Example:
 * ```ts
 * const { db, sql } = createDatabase({
 *   connectionString: process.env.DATABASE_URL!,
 *   maxConnections: 20,
 * });
 * const pgdb = new PostgresDB(db);
 * ```
 */
export function createDatabase(cfg: ConnectionConfig): DatabaseConnection {
  const sql = postgres(cfg.connectionString, {
    max: cfg.maxConnections ?? 10,
    idle_timeout: cfg.idleTimeoutSec ?? 20,
    connect_timeout: cfg.connectTimeoutSec ?? 30,
    max_lifetime: 60 * 30, // 30 min max connection lifetime
    ssl: cfg.ssl ?? (cfg.connectionString.includes("sslmode=require") ? "require" : undefined),
    prepare: true, // use prepared statements for performance
    connection: {
      statement_timeout: String((cfg.statementTimeoutSec ?? 30) * 1000),
    },
    onnotice: () => {}, // suppress NOTICE messages
  });

  const db = drizzle(sql, { schema });

  return { db, sql };
}

/**
 * Gracefully close the database connection pool.
 * Call this on SIGTERM/SIGINT for clean shutdown.
 */
export async function closeDatabase(sql: postgres.Sql): Promise<void> {
  await sql.end({ timeout: 5 });
}

/**
 * Creates a `withTransaction` function compatible with AccountDB.
 * Wraps operations in a Drizzle transaction for atomic execution.
 *
 * Example:
 * ```ts
 * const pgdb = new PostgresDB(db);
 * const accountDB = {
 *   ...pgdb,
 *   withTransaction: createTransactionWrapper(db),
 * };
 * ```
 */
export function createTransactionWrapper(db: DrizzleDB) {
  return async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return db.transaction(async () => {
      return fn();
    });
  };
}
