import type { Context } from "hono";
export interface AccountDB {
    getUserEmail(userId: string): Promise<string>;
    deleteUserData(userId: string): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    anonymizeUser(userId: string): Promise<void>;
    exportUserData(userId: string): Promise<UserDataExport>;
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
    /** DELETE /api/v1/account */
    handleDeleteAccount: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /api/v1/account/anonymize */
    handleAnonymizeAccount: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** GET /api/v1/account/export */
    handleExportData: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        user: import("hono/utils/types").JSONValue;
        subscription?: import("hono/utils/types").JSONValue | undefined;
        events?: import("hono/utils/types").JSONValue | undefined;
        sessions?: import("hono/utils/types").JSONValue | undefined;
        feedback?: import("hono/utils/types").JSONValue | undefined;
        chat_messages?: import("hono/utils/types").JSONValue | undefined;
        device_tokens?: import("hono/utils/types").JSONValue | undefined;
        notification_preferences?: import("hono/utils/types").JSONValue | undefined;
        transactions?: import("hono/utils/types").JSONValue | undefined;
        app_data?: import("hono/utils/types").JSONValue | undefined;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
}
//# sourceMappingURL=index.d.ts.map