// ── Service ─────────────────────────────────────────────────────────────────
export class AccountService {
    cfg;
    db;
    appCleanup;
    appExport;
    constructor(cfg, db, opts) {
        this.cfg = cfg;
        this.db = db;
        this.appCleanup = opts?.cleanup;
        this.appExport = opts?.exporter;
    }
    /** DELETE /api/v1/account */
    handleDeleteAccount = async (c) => {
        const userId = c.get("userId");
        const email = await this.db.getUserEmail(userId).catch(() => "");
        // 1. App-specific tables first
        if (this.appCleanup) {
            try {
                await this.appCleanup.deleteAppData(userId);
            }
            catch {
                return c.json({ error: "failed to delete app data" }, 500);
            }
        }
        // 2. All donkeygo-managed tables
        try {
            await this.db.deleteUserData(userId);
        }
        catch {
            return c.json({ error: "failed to delete user data" }, 500);
        }
        // 3. Delete user record last
        try {
            await this.db.deleteUser(userId);
        }
        catch {
            return c.json({ error: "failed to delete user" }, 500);
        }
        // 4. Callback
        if (this.cfg.onDelete && email)
            this.cfg.onDelete(userId, email);
        return c.json({ status: "deleted" });
    };
    /** POST /api/v1/account/anonymize */
    handleAnonymizeAccount = async (c) => {
        const userId = c.get("userId");
        try {
            await this.db.anonymizeUser(userId);
        }
        catch {
            return c.json({ error: "failed to anonymize account" }, 500);
        }
        return c.json({ status: "anonymized" });
    };
    /** GET /api/v1/account/export */
    handleExportData = async (c) => {
        const userId = c.get("userId");
        let exportData;
        try {
            exportData = await this.db.exportUserData(userId);
        }
        catch {
            return c.json({ error: "failed to export data" }, 500);
        }
        if (this.appExport) {
            const appData = await this.appExport.exportAppData(userId).catch(() => null);
            if (appData)
                exportData.app_data = appData;
        }
        c.header("Content-Disposition", "attachment; filename=account-data.json");
        return c.json(exportData);
    };
}
//# sourceMappingURL=index.js.map