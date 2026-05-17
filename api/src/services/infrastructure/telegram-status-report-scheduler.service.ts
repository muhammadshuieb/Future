import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import { createRedisClient } from "../../lib/redis-connection.js";
import type { UsageCycleRedisClient } from "../../lib/usage-lock.js";
import { log } from "../logger.service.js";
import { runTelegramStatusReportsDue } from "./infrastructure-telegram-status-report.service.js";
import { runWhatsAppStatusReportsDue } from "./infrastructure-whatsapp-status-report.service.js";

const LOCK_KEY = "fr:infra-status-report-tick";
const LOCK_TTL_SEC = 600;
const WORKER_HEARTBEAT_KEY = "future-radius:worker:heartbeat";

let redis: UsageCycleRedisClient | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTickAt: string | null = null;
let lastTickResult: { telegram: { checked: number; sent: number }; whatsapp: { checked: number; sent: number } } | null =
  null;

function getRedis(): UsageCycleRedisClient {
  if (!redis) {
    redis = createRedisClient("infra-report-scheduler") as UsageCycleRedisClient;
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

export function isInfraReportSchedulerEnabled(): boolean {
  if (process.env.INFRA_STATUS_REPORT_SCHEDULER === "0") return false;
  if (process.env.TELEGRAM_REPORT_SCHEDULER === "0") return false;
  return true;
}

/** @deprecated use isInfraReportSchedulerEnabled */
export const isTelegramReportSchedulerEnabled = isInfraReportSchedulerEnabled;

export function getInfraReportSchedulerTickMs(): number {
  return Math.max(30_000, parseInt(process.env.INFRA_STATUS_REPORT_TICK_MS ?? process.env.TELEGRAM_REPORT_TICK_MS ?? "60000", 10) || 60_000);
}

export function getInfraReportSchedulerStatus(): {
  api_scheduler_enabled: boolean;
  tick_interval_ms: number;
  last_tick_at: string | null;
  last_tick: { telegram: { checked: number; sent: number }; whatsapp: { checked: number; sent: number } } | null;
} {
  return {
    api_scheduler_enabled: isInfraReportSchedulerEnabled(),
    tick_interval_ms: getInfraReportSchedulerTickMs(),
    last_tick_at: lastTickAt,
    last_tick: lastTickResult,
  };
}

/**
 * API-process scheduler for periodic Telegram + WhatsApp infrastructure reports.
 * BullMQ worker may also run the same tick — Redis lock ensures single-flight.
 */
export function startTelegramStatusReportScheduler(pool: Pool): void {
  if (!isInfraReportSchedulerEnabled()) {
    log.info("infra_status_report_scheduler disabled", {}, "whatsapp");
    return;
  }
  if (timer) return;

  const ms = getInfraReportSchedulerTickMs();

  const run = () => {
    void withTickLock(async () => {
      const tg = await runTelegramStatusReportsDue(pool);
      const wa = await runWhatsAppStatusReportsDue(pool);
      lastTickAt = new Date().toISOString();
      lastTickResult = { telegram: tg, whatsapp: wa };
      log.info(
        `infra_status_scheduler_tick telegram=${tg.sent}/${tg.checked} whatsapp=${wa.sent}/${wa.checked}`,
        {},
        "whatsapp"
      );
    });
  };

  log.info(`infra_status_report_scheduler started interval_ms=${ms}`, {}, "whatsapp");
  run();
  timer = setInterval(run, ms);
  if (typeof timer.unref === "function") timer.unref();
}
