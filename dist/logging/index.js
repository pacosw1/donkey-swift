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
export class ErrorReportingService {
    db;
    constructor(db) {
        this.db = db;
    }
    async report(record) {
        validateErrorReport(record);
        try {
            await this.db.saveErrorReport({
                ...record,
                level: record.level || "error",
                createdAt: record.createdAt || new Date(),
            });
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to persist error report");
        }
    }
    async submitClientReport(report, ctx) {
        if (!report.message?.trim()) {
            throw new ServiceError("INVALID", "error message is required");
        }
        await this.report({
            source: "client",
            level: report.level || "error",
            category: report.category || "app",
            message: report.message.trim(),
            stack: report.stack || null,
            userId: ctx?.userId || null,
            path: ctx?.path || null,
            method: ctx?.method || null,
            requestId: ctx?.requestId || null,
            appVersion: report.app_version || null,
            appBuild: report.app_build || null,
            language: report.language || null,
            deviceModel: report.device_model || null,
            osVersion: report.os_version || null,
            metadata: report.metadata || null,
        });
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
function validateErrorReport(record) {
    if (!record.category?.trim()) {
        throw new ServiceError("INVALID", "error category is required");
    }
    if (!record.message?.trim()) {
        throw new ServiceError("INVALID", "error message is required");
    }
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