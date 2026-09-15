import { LOG_LEVELS, type LogLevel } from "@/config/env.schema";

/**
 * Structured server-side logger.
 *
 * Emits one JSON object per line in production (machine-parseable for any log
 * aggregator) and a readable single line in development. There is no
 * transport dependency: Phase 1 does not need one, and stdout is what every
 * host already collects.
 *
 * SAFETY: `redact()` strips well-known secret-bearing keys before anything is
 * written. Never log a raw request body, a session token, or a Clerk secret.
 */

export type LogContext = Record<string, unknown>;

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Keys whose values are replaced with `[redacted]`, matched case-insensitively
 * as a substring so `clerkSecretKey`, `authorization` and `db_password` are
 * all covered.
 */
const REDACTED_KEY_PATTERNS = [
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "credential",
  "signature",
  "databaseurl",
  "database_url",
] as const;

const REDACTED = "[redacted]";
const MAX_DEPTH = 4;

function shouldRedact(key: string): boolean {
  const normalised = key.toLowerCase();
  return REDACTED_KEY_PATTERNS.some((pattern) => normalised.includes(pattern));
}

function redact(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) {
    return "[truncated]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        shouldRedact(key) ? REDACTED : redact(entry, depth + 1),
      ]),
    );
  }

  return value;
}

function resolveLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  return (LOG_LEVELS as readonly string[]).includes(raw ?? "")
    ? (raw as LogLevel)
    : "info";
}

function write(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[resolveLevel()]) {
    return;
  }

  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? { context: redact(context) } : {}),
  };

  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify(entry)
      : `${entry.time} ${level.toUpperCase().padEnd(5)} ${message}${
          context ? ` ${JSON.stringify(redact(context))}` : ""
        }`;

  // Route warn/error to stderr so hosts classify severity correctly.
  if (level === "error" || level === "warn") {
    console.error(line);
    return;
  }

  console.log(line);
}

export type Logger = {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a logger that merges `bindings` into every subsequent entry. */
  child(bindings: LogContext): Logger;
};

function createLogger(bindings: LogContext = {}): Logger {
  const merge = (context?: LogContext): LogContext | undefined => {
    const merged = { ...bindings, ...context };
    return Object.keys(merged).length > 0 ? merged : undefined;
  };

  return {
    debug: (message, context) => write("debug", message, merge(context)),
    info: (message, context) => write("info", message, merge(context)),
    warn: (message, context) => write("warn", message, merge(context)),
    error: (message, context) => write("error", message, merge(context)),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
  };
}

export const logger: Logger = createLogger();

/** Exported for unit tests; not part of the public logging surface. */
export const __testing = { redact, shouldRedact };
