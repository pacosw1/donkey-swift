import { ServiceError } from "../errors/index.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

type PrimitiveLogValue = string | number | boolean | null | undefined;
export type LogValue =
  | PrimitiveLogValue
  | PrimitiveLogValue[]
  | Record<string, unknown>
  | Array<Record<string, unknown>>;

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

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.minLevel || "info";
  const baseFields = options.baseFields || {};
  const writer = options.writer || defaultWriter;

  const shouldLog = (level: LogLevel) => LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];

  const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
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
    child: (fields) =>
      createLogger({
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
  constructor(private readonly db: ErrorReportDB) {}

  async report(record: ErrorReportRecord): Promise<void> {
    validateErrorReport(record);

    try {
      await this.db.saveErrorReport({
        ...record,
        level: record.level || "error",
        createdAt: record.createdAt || new Date(),
      });
    } catch {
      throw new ServiceError("INTERNAL", "failed to persist error report");
    }
  }

  async submitClientReport(
    report: ClientErrorReportInput,
    ctx?: {
      userId?: string | null;
      path?: string | null;
      method?: string | null;
      requestId?: string | null;
    },
  ): Promise<void> {
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

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

function validateErrorReport(record: ErrorReportRecord): void {
  if (!record.category?.trim()) {
    throw new ServiceError("INVALID", "error category is required");
  }
  if (!record.message?.trim()) {
    throw new ServiceError("INVALID", "error message is required");
  }
}

function defaultWriter(line: string, level: LogLevel): void {
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

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, sanitizeValue(value)]),
  );
}

function sanitizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)]),
    );
  }

  return value;
}
