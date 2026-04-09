import { ServiceError } from "../errors/index.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticEventType = "error" | "crash" | "performance" | "lifecycle";

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

export class DiagnosticsService {
  constructor(private readonly db: DiagnosticsDB) {}

  async report(record: DiagnosticEventRecord): Promise<void> {
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
    } catch {
      throw new ServiceError("INTERNAL", "failed to persist diagnostic event");
    }
  }

  async submitClientEvent(
    event: ClientDiagnosticsEventInput,
    ctx?: {
      userId?: string | null;
      path?: string | null;
      method?: string | null;
      requestId?: string | null;
    },
  ): Promise<void> {
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
  private readonly diagnostics: DiagnosticsService;

  constructor(db: ErrorReportDB) {
    this.diagnostics = new DiagnosticsService(db);
  }

  async report(record: ErrorReportRecord): Promise<void> {
    await this.diagnostics.report({
      ...record,
      eventType: record.eventType || "error",
    });
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
    await this.diagnostics.submitClientEvent(
      {
        ...report,
        type: report.type || "error",
      },
      ctx,
    );
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

function validateDiagnosticEvent(record: DiagnosticEventRecord): void {
  if (!record.category?.trim()) {
    throw new ServiceError("INVALID", "diagnostic category is required");
  }
  if (!record.message?.trim()) {
    throw new ServiceError("INVALID", "diagnostic message is required");
  }
}

function normalizeClientBreadcrumbs(
  breadcrumbs: ClientDiagnosticBreadcrumbInput[] | null | undefined,
): DiagnosticBreadcrumb[] | null {
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

function normalizeBreadcrumbs(
  breadcrumbs: DiagnosticBreadcrumb[] | null | undefined,
): DiagnosticBreadcrumb[] | null {
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
