/** Executes migrations in order. Migrations should be idempotent (IF NOT EXISTS). */
export class MigrationRunner {
    db;
    migrations = [];
    constructor(db) {
        this.db = db;
    }
    /** Append migrations to the runner. */
    add(...migrations) {
        this.migrations.push(...migrations);
    }
    /** Execute all migrations in order. */
    async run() {
        for (const m of this.migrations) {
            try {
                await this.db.execute(m.sql);
            }
            catch (err) {
                const preview = m.sql.length > 200 ? m.sql.slice(0, 200) : m.sql;
                throw new Error(`migration "${m.name}" failed: ${err}\nSQL: ${preview}`);
            }
        }
        console.log(`[migrate] ${this.migrations.length} migrations complete`);
    }
}
//# sourceMappingURL=index.js.map