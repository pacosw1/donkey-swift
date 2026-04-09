export type LogLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticEventType = "error" | "crash" | "performance" | "lifecycle";
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
export interface DiagnosticBreadcrumb {
    ts?: Date | string;
    level?: LogLevel;
    category: string;
    message: string;
    metadata?: Record<string, unknown> | null;
}
export interface DiagnosticEventRecord {
    source: "server" | "client";
    eventType?: DiagnosticEventType;
    level?: LogLevel;
    category: string;
    message: string;
    stack?: string | null;
    userId?: string | null;
    path?: string | null;
    method?: string | null;
    requestId?: string | null;
    sessionId?: string | null;
    installationId?: string | null;
    appVersion?: string | null;
    appBuild?: string | null;
    language?: string | null;
    deviceModel?: string | null;
    osVersion?: string | null;
    platform?: string | null;
    breadcrumbs?: DiagnosticBreadcrumb[] | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: Date | string;
}
export interface DiagnosticsDB {
    saveDiagnosticEvent(report: DiagnosticEventRecord): Promise<void>;
}
export type ErrorReportRecord = DiagnosticEventRecord;
export type ErrorReportDB = DiagnosticsDB;
export interface ClientDiagnosticBreadcrumbInput {
    ts?: string | null;
    level?: LogLevel;
    category: string;
    message: string;
    metadata?: Record<string, unknown> | null;
}
export interface ClientDiagnosticsEventInput {
    type?: DiagnosticEventType;
    level?: LogLevel;
    category: string;
    message: string;
    stack?: string | null;
    session_id?: string | null;
    installation_id?: string | null;
    app_version?: string | null;
    app_build?: string | null;
    language?: string | null;
    device_model?: string | null;
    os_version?: string | null;
    platform?: string | null;
    breadcrumbs?: ClientDiagnosticBreadcrumbInput[] | null;
    metadata?: Record<string, unknown> | null;
}
export type ClientErrorReportInput = ClientDiagnosticsEventInput;
export declare function createLogger(options?: LoggerOptions): Logger;
export declare class DiagnosticsService {
    private readonly db;
    constructor(db: DiagnosticsDB);
    report(record: DiagnosticEventRecord): Promise<void>;
    submitClientEvent(event: ClientDiagnosticsEventInput, ctx?: {
        userId?: string | null;
        path?: string | null;
        method?: string | null;
        requestId?: string | null;
    }): Promise<void>;
}
export declare class ErrorReportingService {
    private readonly diagnostics;
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