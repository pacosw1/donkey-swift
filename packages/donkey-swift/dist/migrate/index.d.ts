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
export declare class MigrationRunner {
    private db;
    private migrations;
    constructor(db: SqlExecutor);
    /** Append migrations to the runner. */
    add(...migrations: Migration[]): void;
    /** Execute all migrations in order. */
    run(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map