export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

function getConfiguredLevel(): LogLevel {
  const raw = process.env["LOG_LEVEL"] ?? "info";
  if (raw in LOG_LEVEL_RANK) {
    return raw as LogLevel;
  }
  return "info";
}

function shouldLog(level: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[configuredLevel];
}

function writeLog(
  level: LogLevel,
  message: string,
  context: Record<string, unknown>,
  configuredLevel: LogLevel
): void {
  if (!shouldLog(level, configuredLevel)) {
    return;
  }

  const RESERVED = new Set(["timestamp", "level", "message"]);
  const safeContext = Object.fromEntries(
    Object.entries(context).filter(([key]) => !RESERVED.has(key))
  );
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...safeContext,
  });

  if (level === "error" || level === "warn") {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

export function createLogger(name: string): Logger {
  const configuredLevel = getConfiguredLevel();
  const base: Record<string, unknown> = { logger: name };

  return {
    debug(message: string, context?: Record<string, unknown>): void {
      writeLog("debug", message, { ...base, ...context }, configuredLevel);
    },
    info(message: string, context?: Record<string, unknown>): void {
      writeLog("info", message, { ...base, ...context }, configuredLevel);
    },
    warn(message: string, context?: Record<string, unknown>): void {
      writeLog("warn", message, { ...base, ...context }, configuredLevel);
    },
    error(message: string, context?: Record<string, unknown>): void {
      writeLog("error", message, { ...base, ...context }, configuredLevel);
    },
  };
}

export const rootLogger: Logger = createLogger("root");
