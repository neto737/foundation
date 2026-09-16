export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  route?: string;
  status?: number;
  tenantId?: string;
  userId?: string;
  durationMs?: number;
  [key: string]: boolean | number | string | undefined;
}

export interface LogSink {
  write(entry: Readonly<Record<string, unknown>>): void;
}

const SENSITIVE_CONTEXT_KEYS = [
  "authorization",
  "card",
  "cookie",
  "password",
  "secret",
  "token",
];

export function createLogger(sink: LogSink, defaults: LogContext = {}) {
  function log(
    level: LogLevel,
    message: string,
    context: LogContext = {},
  ): void {
    sink.write({
      ...sanitizeContext(defaults),
      ...sanitizeContext(context),
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  }
  return {
    debug: (message: string, context?: LogContext) =>
      log("debug", message, context ?? {}),
    error: (message: string, context?: LogContext) =>
      log("error", message, context ?? {}),
    info: (message: string, context?: LogContext) =>
      log("info", message, context ?? {}),
    warn: (message: string, context?: LogContext) =>
      log("warn", message, context ?? {}),
  };
}

function sanitizeContext(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      isSensitiveContextKey(key) ? "[REDACTED]" : value,
    ]),
  );
}

function isSensitiveContextKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return SENSITIVE_CONTEXT_KEYS.some((sensitiveKey) =>
    normalizedKey.includes(sensitiveKey),
  );
}
