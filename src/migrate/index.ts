/** A single SQL migration statement. */
export interface Migration {
  name: string;
  sql: string;
}

/** Interface for any SQL executor (Drizzle, pg Pool, etc.). */
export interface SqlExecutor {
  execute(sql: string): Promise<void>;
}

/** Executes migrations in order. Migrations should be idempotent (IF NOT EXISTS). */
export class MigrationRunner {
  private migrations: Migration[] = [];

  constructor(private db: SqlExecutor) {}

  /** Append migrations to the runner. */
  add(...migrations: Migration[]): void {
    this.migrations.push(...migrations);
  }

  /** Execute all migrations in order. */
  async run(): Promise<void> {
    for (const m of this.migrations) {
      try {
        await this.db.execute(m.sql);
      } catch (err) {
        const preview = m.sql.length > 200 ? m.sql.slice(0, 200) : m.sql;
        throw new Error(
          `migration "${m.name}" failed: ${err}\nSQL: ${preview}`
        );
      }
    }
    console.log(`[migrate] ${this.migrations.length} migrations complete`);
  }
}
