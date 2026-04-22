import { pool } from "../db/pool.js";

export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogSource = "api" | "worker" | "http" | "system" | "whatsapp" | "radius" | "db" | "migrations" | "bootstrap" | "backup" | string;

type LogInput = {
  level?: LogLevel;
  source?: LogSource;
  category?: string | null;
  message: string;
  stack?: string | null;
  meta?: Record<string, unknown> | null;
};

let installed = false;
let originalConsoleError: typeof console.error | null = null;
let originalConsoleWarn: typeof console.warn | null = null;

/** Buffer logs emitted before DB is ready so we can flush them afterwards. */
const pending: LogInput[] = [];
const MAX_PENDING = 500;
let dbReady = false;

const DEFAULT_SOURCE = (process.env.LOG_SOURCE || "api").slice(0, 64);

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function safeStringify(value: unknown): string {
  try {
    if (value instanceof Error) {
      return value.stack || value.message;
    }
    if (typeof value === "string") return value;
    return JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      return v;
    });
  } catch {
    return String(value);
  }
}

function extractError(args: unknown[]): { stack: string | null; firstMessage: string } {
  let stack: string | null = null;
  const parts: string[] = [];
  for (const arg of args) {
    if (arg instanceof Error) {
      if (!stack && arg.stack) stack = arg.stack;
      parts.push(arg.stack ? arg.stack.split("\n")[0] : arg.message);
    } else if (typeof arg === "object" && arg !== null && (arg as { stack?: string }).stack) {
      const s = (arg as { stack?: string }).stack;
      if (!stack && s) stack = s;
      parts.push(safeStringify(arg));
    } else {
      parts.push(safeStringify(arg));
    }
  }
  return { stack, firstMessage: parts.join(" ") };
}

async function writeToDb(entry: LogInput): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO server_logs (level, source, category, message, stack, meta)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.level ?? "info",
        truncate(entry.source ?? DEFAULT_SOURCE, 64),
        entry.category ? truncate(entry.category, 96) : null,
        truncate(entry.message ?? "", 8000),
        entry.stack ? truncate(entry.stack, 20000) : null,
        entry.meta ? JSON.stringify(entry.meta) : null,
      ]
    );
  } catch {
    // Intentionally swallow: never let logging errors crash the caller.
  }
}

/**
 * Emit a log entry. Safe to call before DB is ready — entries are buffered
 * until `markDbReady()` is invoked, then flushed asynchronously.
 */
export function logEvent(input: LogInput | string, extra?: Partial<LogInput>): void {
  const entry: LogInput =
    typeof input === "string"
      ? { level: "info", message: input, ...(extra ?? {}) }
      : { ...input, ...(extra ?? {}) };
  if (!entry.message) return;
  if (!entry.source) entry.source = DEFAULT_SOURCE;

  if (!dbReady) {
    if (pending.length >= MAX_PENDING) pending.shift();
    pending.push(entry);
    return;
  }
  void writeToDb(entry);
}

export const log = {
  error: (message: string, meta?: Record<string, unknown>, category?: string) =>
    logEvent({ level: "error", message, meta: meta ?? null, category: category ?? null }),
  warn: (message: string, meta?: Record<string, unknown>, category?: string) =>
    logEvent({ level: "warn", message, meta: meta ?? null, category: category ?? null }),
  info: (message: string, meta?: Record<string, unknown>, category?: string) =>
    logEvent({ level: "info", message, meta: meta ?? null, category: category ?? null }),
};

/**
 * Called after `waitForDbReady()` to flush anything buffered during startup.
 */
export function markDbReady(): void {
  dbReady = true;
  const queued = pending.splice(0, pending.length);
  for (const entry of queued) void writeToDb(entry);
}

/**
 * Install global error handlers + console.error/warn mirror. Safe to call
 * multiple times; it is a no-op after the first invocation.
 */
export function installLogger(options: { source?: LogSource } = {}): void {
  if (installed) return;
  installed = true;
  if (options.source) process.env.LOG_SOURCE = options.source;

  originalConsoleError = console.error.bind(console);
  originalConsoleWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    try {
      const { firstMessage, stack } = extractError(args);
      logEvent({
        level: "error",
        message: truncate(firstMessage, 4000),
        stack,
        category: "console",
      });
    } catch {
      // swallow
    }
    originalConsoleError?.(...args);
  };

  console.warn = (...args: unknown[]) => {
    try {
      const { firstMessage, stack } = extractError(args);
      logEvent({
        level: "warn",
        message: truncate(firstMessage, 4000),
        stack,
        category: "console",
      });
    } catch {
      // swallow
    }
    originalConsoleWarn?.(...args);
  };

  process.on("uncaughtException", (err) => {
    logEvent({
      level: "error",
      message: `uncaughtException: ${err.message}`,
      stack: err.stack ?? null,
      category: "process",
    });
    originalConsoleError?.("[process] uncaughtException", err);
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(safeStringify(reason));
    logEvent({
      level: "error",
      message: `unhandledRejection: ${err.message}`,
      stack: err.stack ?? null,
      category: "process",
    });
    originalConsoleError?.("[process] unhandledRejection", reason);
  });
}

/**
 * Delete log rows older than `retentionDays`, then trim `server_log_alerts`
 * so the alerts table does not grow without bound.
 */
export async function pruneOldLogs(retentionDays = 14): Promise<{ logs: number; alerts: number }> {
  let logs = 0;
  let alerts = 0;
  try {
    const [logResult] = await pool.execute(
      `DELETE FROM server_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [retentionDays]
    );
    logs = (logResult as { affectedRows?: number }).affectedRows ?? 0;
  } catch {
    /* table may not exist yet */
  }
  try {
    const [alertResult] = await pool.execute(
      `DELETE FROM server_log_alerts WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [Math.max(retentionDays, 7)]
    );
    alerts = (alertResult as { affectedRows?: number }).affectedRows ?? 0;
  } catch {
    /* optional table */
  }
  return { logs, alerts };
}
