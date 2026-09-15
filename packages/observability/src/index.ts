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

export function createLogger(sink: LogSink, defaults: LogContext = {}) {
  function log(
    level: LogLevel,
    message: string,
    context: LogContext = {},
  ): void {
    sink.write({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...defaults,
      ...context,
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
