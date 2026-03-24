export interface AccountDB {
    getUserEmail(userId: string): Promise<string>;
    deleteUserData(userId: string): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    anonymizeUser(userId: string): Promise<void>;
    exportUserData(userId: string): Promise<UserDataExport>;
    /**
     * Execute a callback inside a database transaction.
     * If the callback throws, the transaction must be rolled back.
     * Optional — if not provided, deletion steps run without a transaction wrapper.
     */
    withTransaction?<T>(fn: () => Promise<T>): Promise<T>;
}
export interface AppCleanup {
    deleteAppData(userId: string): Promise<void>;
}
export interface AppExporter {
    exportAppData(userId: string): Promise<unknown>;
}
export interface UserDataExport {
    user: unknown;
    subscription?: unknown;
    events?: unknown;
    sessions?: unknown;
    feedback?: unknown;
    chat_messages?: unknown;
    device_tokens?: unknown;
    notification_preferences?: unknown;
    transactions?: unknown;
    app_data?: unknown;
}
export interface AccountConfig {
    onDelete?: (userId: string, email: string) => void;
}
export declare class AccountService {
    private cfg;
    private db;
    private appCleanup?;
    private appExport?;
    constructor(cfg: AccountConfig, db: AccountDB, opts?: {
        cleanup?: AppCleanup;
        exporter?: AppExporter;
    });
    /** Delete a user account and all associated data. */
    deleteAccount(userId: string): Promise<{
        status: string;
    }>;
    /** Anonymize a user account (remove PII but keep the record). */
    anonymizeAccount(userId: string): Promise<{
        status: string;
    }>;
    /** Export all user data. */
    exportData(userId: string): Promise<UserDataExport>;
}
//# sourceMappingURL=index.d.ts.map