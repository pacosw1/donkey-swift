import { ServiceError } from "../errors/index.js";
const LEVEL_ORDER = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
export function createLogger(options = {}) {
    const minLevel = options.minLevel || "info";
    const baseFields = options.baseFields || {};
    const writer = options.writer || defaultWriter;
    const shouldLog = (level) => LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
    const write = (level, message, fields = {}) => {
        if (!shouldLog(level)) {
            return;
        }
        const payload = sanitizeFields({
            ts: new Date().toISOString(),
            level,
            message,
            ...baseFields,
            ...fields,
        });
        writer(JSON.stringify(payload), level);
    };
    return {
        debug: (message, fields) => write("debug", message, fields),
        info: (message, fields) => write("info", message, fields),
        warn: (message, fields) => write("warn", message, fields),
        error: (message, fields) => write("error", message, fields),
        child: (fields) => createLogger({
            minLevel,
            writer,
            baseFields: {
                ...baseFields,
                ...fields,
            },
        }),
    };
}
export class DiagnosticsService {
    db;
    constructor(db) {
        this.db = db;
    }
    async report(record) {
        validateDiagnosticEvent(record);
        try {
            await this.db.saveDiagnosticEvent({
                ...record,
                eventType: record.eventType || "error",
                level: record.level || "error",
                platform: record.platform || null,
                breadcrumbs: normalizeBreadcrumbs(record.breadcrumbs),
                createdAt: record.createdAt || new Date(),
            });
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to persist diagnostic event");
        }
    }
    async submitClientEvent(event, ctx) {
        if (!event.message?.trim()) {
            throw new ServiceError("INVALID", "diagnostic message is required");
        }
        await this.report({
            source: "client",
            eventType: event.type || "error",
            level: event.level || "error",
            category: event.category || "app",
            message: event.message.trim(),
            stack: event.stack || null,
            userId: ctx?.userId || null,
            path: ctx?.path || null,
            method: ctx?.method || null,
            requestId: ctx?.requestId || null,
            sessionId: event.session_id || null,
            installationId: event.installation_id || null,
            appVersion: event.app_version || null,
            appBuild: event.app_build || null,
            language: event.language || null,
            deviceModel: event.device_model || null,
            osVersion: event.os_version || null,
            platform: event.platform || null,
            breadcrumbs: normalizeClientBreadcrumbs(event.breadcrumbs),
            metadata: event.metadata || null,
        });
    }
}
export class ErrorReportingService {
    diagnostics;
    constructor(db) {
        this.diagnostics = new DiagnosticsService(db);
    }
    async report(record) {
        await this.diagnostics.report({
            ...record,
            eventType: record.eventType || "error",
        });
    }
    async submitClientReport(report, ctx) {
        await this.diagnostics.submitClientEvent({
            ...report,
            type: report.type || "error",
        }, ctx);
    }
}
export function serializeError(error) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    return { message: String(error) };
}
function validateDiagnosticEvent(record) {
    if (!record.category?.trim()) {
        throw new ServiceError("INVALID", "diagnostic category is required");
    }
    if (!record.message?.trim()) {
        throw new ServiceError("INVALID", "diagnostic message is required");
    }
}
function normalizeClientBreadcrumbs(breadcrumbs) {
    if (!breadcrumbs?.length) {
        return null;
    }
    return breadcrumbs
        .filter((breadcrumb) => breadcrumb.category?.trim() && breadcrumb.message?.trim())
        .map((breadcrumb) => ({
        ts: breadcrumb.ts || new Date().toISOString(),
        level: breadcrumb.level || "info",
        category: breadcrumb.category.trim(),
        message: breadcrumb.message.trim(),
        metadata: breadcrumb.metadata || null,
    }));
}
function normalizeBreadcrumbs(breadcrumbs) {
    if (!breadcrumbs?.length) {
        return null;
    }
    return breadcrumbs
        .filter((breadcrumb) => breadcrumb.category?.trim() && breadcrumb.message?.trim())
        .map((breadcrumb) => ({
        ts: breadcrumb.ts || new Date().toISOString(),
        level: breadcrumb.level || "info",
        category: breadcrumb.category.trim(),
        message: breadcrumb.message.trim(),
        metadata: breadcrumb.metadata || null,
    }));
}
function defaultWriter(line, level) {
    switch (level) {
        case "error":
            console.error(line);
            break;
        case "warn":
            console.warn(line);
            break;
        default:
            console.log(line);
            break;
    }
}
function sanitizeFields(fields) {
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, sanitizeValue(value)]));
}
function sanitizeValue(value) {
    if (value instanceof Error) {
        return serializeError(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)]));
    }
    return value;
}
//# sourceMappingURL=index.js.map