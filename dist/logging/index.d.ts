export type LogLevel = "debug" | "info" | "warn" | "error";
type PrimitiveLogValue = string | number | boolean | null | undefined;
export type LogValue = PrimitiveLogValue | PrimitiveLogValue[] | Record<string, unknown> | Array<Record<string, unknown>>;
export type LogFields = Record<string, LogValue>;
export interface Logger {
    debug(message: string, fields?: LogFields): void;
    info(message: string, fields?: LogFields): void;
    warn(message: string, fields?: LogFields): void;
    error(message: string, fields?: LogFields): void;
    child(fields: LogFields): Logger;
}
export interface LoggerOptions {
    minLevel?: LogLevel;
    baseFields?: LogFields;
    writer?: (line: string, level: LogLevel) => void;
}
export interface ErrorReportRecord {
    source: "server" | "client";
    level?: LogLevel;
    category: string;
    message: string;
    stack?: string | null;
    userId?: string | null;
    path?: string | null;
    method?: string | null;
    requestId?: string | null;
    appVersion?: string | null;
    appBuild?: string | null;
    language?: string | null;
    deviceModel?: string | null;
    osVersion?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: Date | string;
}
export interface ErrorReportDB {
    saveErrorReport(report: ErrorReportRecord): Promise<void>;
}
export interface ClientErrorReportInput {
    level?: LogLevel;
    category: string;
    message: string;
    stack?: string | null;
    app_version?: string | null;
    app_build?: string | null;
    language?: string | null;
    device_model?: string | null;
    os_version?: string | null;
    metadata?: Record<string, unknown> | null;
}
export declare function createLogger(options?: LoggerOptions): Logger;
export declare class ErrorReportingService {
    private readonly db;
    constructor(db: ErrorReportDB);
    report(record: ErrorReportRecord): Promise<void>;
    submitClientReport(report: ClientErrorReportInput, ctx?: {
        userId?: string | null;
        path?: string | null;
        method?: string | null;
        requestId?: string | null;
    }): Promise<void>;
}
export declare function serializeError(error: unknown): Record<string, unknown>;
export {};
//# sourceMappingURL=index.d.ts.map