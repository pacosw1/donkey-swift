import { ServiceError } from "../errors/index.js";
// ── Service ─────────────────────────────────────────────────────────────────
export class AccountService {
    cfg;
    db;
    appCleanup;
    appExport;
    identityRevoker;
    constructor(cfg, db, opts) {
        this.cfg = cfg;
        this.db = db;
        this.appCleanup = opts?.cleanup;
        this.appExport = opts?.exporter;
        this.identityRevoker = opts?.revoker;
    }
    /** Delete a user account and all associated data. */
    async deleteAccount(userId) {
        const email = await this.db.getUserEmail(userId).catch(() => "");
        let identityRevocation;
        if (this.identityRevoker) {
            try {
                identityRevocation = await this.identityRevoker.revokeIdentity(userId);
            }
            catch {
                throw new ServiceError("INTERNAL", "failed to revoke account identity");
            }
        }
        const deleteAll = async () => {
            // 1. App-specific tables first
            if (this.appCleanup) {
                await this.appCleanup.deleteAppData(userId);
            }
            // 2. All donkeygo-managed tables
            await this.db.deleteUserData(userId);
            // 3. Delete user record last
            await this.db.deleteUser(userId);
        };
        try {
            if (this.db.withTransaction) {
                await this.db.withTransaction(deleteAll);
            }
            else {
                await deleteAll();
            }
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to delete account");
        }
        // Callback (outside transaction — fire and forget)
        if (this.cfg.onDelete && email)
            this.cfg.onDelete(userId, email);
        return { status: "deleted", identityRevocation };
    }
    /** Anonymize a user account (remove PII but keep the record). */
    async anonymizeAccount(userId) {
        try {
            await this.db.anonymizeUser(userId);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to anonymize account");
        }
        return { status: "anonymized" };
    }
    /** Export all user data. */
    async exportData(userId) {
        let exportData;
        try {
            exportData = await this.db.exportUserData(userId);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to export data");
        }
        if (this.appExport) {
            const appData = await this.appExport.exportAppData(userId).catch(() => null);
            if (appData)
                exportData.app_data = appData;
        }
        return exportData;
    }
}
//# sourceMappingURL=index.js.map