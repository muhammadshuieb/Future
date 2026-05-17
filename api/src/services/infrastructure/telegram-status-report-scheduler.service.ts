import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import { createRedisClient } from "../../lib/redis-connection.js";
import type { UsageCycleRedisClient } from "../../lib/usage-lock.js";
import { log } from "../logger.service.js";
import { runTelegramStatusReportsDue } from "./infrastructure-telegram-status-report.service.js";

const LOCK_KEY = "fr:telegram-status-report-tick";
const LOCK_TTL_SEC = 120;
const WORKER_HEARTBEAT_KEY = "future-radius:worker:heartbeat";

let redis: UsageCycleRedisClient | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function getRedis(): UsageCycleRedisClient {
  if (!redis) {
    redis = createRedisClient("telegram-report-scheduler") as UsageCycleRedisClient;
  }
  return redis;
}

async function withTickLock(fn: () => Promise<void>): Promise<void> {
  const token = randomUUID();
  const ok = await getRedis().set(LOCK_KEY, token, "EX", LOCK_TTL_SEC, "NX");
  if (ok !== "OK") return;
  try {
    await fn();
  } finally {
    const cur = await getRedis().get(LOCK_KEY);
    if (cur === token) {
      await getRedis().del(LOCK_KEY);
    }
  }
}

/** Age of worker heartbeat in ms, or null if missing/unparseable. */
export async function getWorkerHeartbeatAgeMs(): Promise<number | null> {
  try {
    const raw = await getRedis().get(WORKER_HEARTBEAT_KEY);
    if (!raw) return null;
    const ts = new Date(raw).getTime();
    if (!Number.isFinite(ts)) return null;
    return Date.now() - ts;
  } catch {
    return null;
  }
}

export function isTelegramReportSchedulerEnabled(): boolean {
  return process.env.TELEGRAM_REPORT_SCHEDULER !== "0";
}

/**
 * Runs inside the API process so periodic Telegram reports work without a separate worker.
 * BullMQ worker may also run the same tick — Redis lock ensures single-flight.
 */
export function startTelegramStatusReportScheduler(pool: Pool): void {
  if (!isTelegramReportSchedulerEnabled()) {
    log.info("telegram_status_report_scheduler disabled (TELEGRAM_REPORT_SCHEDULER=0)", {}, "telegram");
    return;
  }
  if (timer) return;

  const ms = Math.max(
    30_000,
    parseInt(process.env.TELEGRAM_REPORT_TICK_MS ?? "60000", 10) || 60_000
  );

  const run = () => {
    void withTickLock(async () => {
      const { checked, sent } = await runTelegramStatusReportsDue(pool);
      if (sent > 0) {
        log.info(`telegram_scheduler sent=${sent} checked=${checked}`, {}, "telegram");
      }
    });
  };

  log.info(`telegram_status_report_scheduler started interval_ms=${ms}`, {}, "telegram");
  run();
  timer = setInterval(run, ms);
  if (typeof timer.unref === "function") timer.unref();
}
