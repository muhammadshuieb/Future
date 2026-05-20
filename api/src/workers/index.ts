import { Queue, Worker } from "bullmq";
import { config } from "../config.js";
import { createRedisClient, listenRedisErrors } from "../lib/redis-connection.js";
import { FUTURE_RADIUS_JOB_QUEUE } from "../lib/bullmq-queue-name.js";
import { pool, waitForDbReady } from "../db/pool.js";
import { installLogger, markDbReady, log } from "../services/logger.service.js";

installLogger({ source: "worker" });
import { CoaService } from "../services/coa.service.js";
import { NasHealthService } from "../services/nas-health.service.js";
import { enqueueWahaPaymentReceived } from "../services/task-queue.service.js";
import { listenEvent } from "../events/eventBus.js";
import { Events } from "../events/eventTypes.js";
import {
  ensureBillingTables,
  ensureSubscriberWhatsAppOptOutColumn,
} from "../services/billing-schema-bootstrap.service.js";
import { syncMikrotikSessionsFromNasTable } from "../services/mikrotik-ros-sync.service.js";
import { ensureDynamicSpeedTables } from "../services/dynamic-speed.service.js";
import http from "http";
import {
  bullmqQueueLagSeconds,
  registry as metricsRegistry,
  mysqlPoolConnections,
} from "../services/metrics.service.js";
import { dispatchWorkerJob } from "./dispatch-worker-job.js";
import {
  BACKUP_SCHEDULE_TICK_JOB,
  syncBackupScheduleCronJobsForDefaultTenant,
} from "../services/backup-schedule-jobs.service.js";
import { startDiskMonitor } from "../services/disk-monitor.service.js";

/**
 * Worker /metrics on WORKER_METRICS_PORT (default 9101).
 * Bearer-token auth via METRICS_BEARER_TOKEN matches the api endpoint. BullMQ queue lag
 * and mysql pool counts are sampled here (the worker is the producer/consumer of the
 * `future-radius-jobs` queue, so it owns the most accurate view).
 */
function startWorkerMetricsServer(): void {
  const port = Number(process.env.WORKER_METRICS_PORT) || 9101;
  const expectedToken = (process.env.METRICS_BEARER_TOKEN || "").trim();
  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith("/metrics")) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    if (expectedToken) {
      const header = String(req.headers["authorization"] ?? "");
      const match = header.match(/^Bearer\s+(.+)$/i);
      if (!match || match[1].trim() !== expectedToken) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="metrics"');
        res.statusCode = 401;
        res.end("unauthorized");
        return;
      }
    }
    try {
      await sampleWorkerGauges();
    } catch {
      /* keep serving even if sampling fails */
    }
    try {
      res.setHeader("Content-Type", metricsRegistry.contentType);
      res.end(await metricsRegistry.metrics());
    } catch (e) {
      res.statusCode = 500;
      res.end(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  server.on("error", (e) => {
    console.warn(`[worker-metrics] http server error on port ${port}: ${e.message}`);
  });
  server.listen(port, () => {
    console.info(`[worker-metrics] /metrics listening on 0.0.0.0:${port}`);
  });
}

let lastWorkerSampleAt = 0;
const WORKER_GAUGE_TTL_MS = Math.max(5_000, Number(process.env.METRICS_GAUGE_TTL_MS) || 30_000);

async function sampleWorkerGauges(): Promise<void> {
  const now = Date.now();
  if (now - lastWorkerSampleAt < WORKER_GAUGE_TTL_MS) return;
  lastWorkerSampleAt = now;
  try {
    const waiting = await jobQueue.getWaiting(0, 0).catch(() => []);
    const oldest = waiting?.[0];
    const lagMs = oldest?.timestamp ? Math.max(0, Date.now() - Number(oldest.timestamp)) : 0;
    bullmqQueueLagSeconds.set({ queue: FUTURE_RADIUS_JOB_QUEUE }, lagMs / 1000);
  } catch {
    /* queue lag is best-effort */
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internal = pool as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const innerPool: any = internal?.pool ?? internal;
  const total = Array.isArray(innerPool?._allConnections) ? innerPool._allConnections.length : NaN;
  const free = Array.isArray(innerPool?._freeConnections) ? innerPool._freeConnections.length : NaN;
  const queued = Array.isArray(innerPool?._connectionQueue) ? innerPool._connectionQueue.length : NaN;
  if (Number.isFinite(total)) mysqlPoolConnections.set({ state: "total" }, total);
  if (Number.isFinite(free)) mysqlPoolConnections.set({ state: "free" }, free);
  if (Number.isFinite(total) && Number.isFinite(free)) {
    mysqlPoolConnections.set({ state: "used" }, total - free);
  }
  if (Number.isFinite(queued)) mysqlPoolConnections.set({ state: "queued" }, queued);
}

const connection = createRedisClient("worker-bullmq");
const publisher = connection.duplicate();
listenRedisErrors(publisher, "worker-bullmq-publisher");
const workerHeartbeatKey = "future-radius:worker:heartbeat";

const coa = new CoaService(pool);
const nasHealth = new NasHealthService(pool, coa, (ev) => {
  publisher.publish(config.eventsChannel, JSON.stringify(ev)).catch(() => {});
});

export const jobQueue = new Queue(FUTURE_RADIUS_JOB_QUEUE, { connection });

async function bootstrapRepeatables() {
  const everyMin = 60_000;
  const updateUsageEvery = Math.max(
    60_000,
    parseInt(process.env.UPDATE_USAGE_EVERY_MS ?? "60000", 10) || 60_000
  );
  const everyDay = 86_400_000;
  const timezone = config.appTimezone;
  const replaceRepeatablesByName = async (name: string) => {
    try {
      const jobs = await jobQueue.getRepeatableJobs();
      for (const job of jobs) {
        if (job.name === name && job.key) {
          await jobQueue.removeRepeatableByKey(job.key);
        }
      }
    } catch (e) {
      console.warn("replace repeatable jobs", name, e);
    }
  };
  if (false) {
    // Keep update-usage in PROJECT_MODE: it now runs lightweight expiry/quota enforcement
    // without heavy user_usage_live rebuild.
    await replaceRepeatablesByName("whatsapp-usage-alerts");
  }
  const add = async (name: string, every: number) => {
    try {
      await jobQueue.add(name, {}, { repeat: { every }, jobId: name });
    } catch (e) {
      console.warn("repeat job", name, e);
    }
  };
  const addCron = async (name: string, pattern: string) => {
    try {
      await jobQueue.add(name, {}, { repeat: { pattern, tz: timezone }, jobId: name });
    } catch (e) {
      console.warn("repeat cron job", name, e);
    }
  };
  await add("update-usage", updateUsageEvery);
  await replaceRepeatablesByName("synth-radius-probe");
  await add("nas-health", everyMin);
  await replaceRepeatablesByName("apply-dynamic-speeds");
  await add("apply-dynamic-speeds", everyMin);
  await add("speed-profile-apply-cycle", everyMin);
  await add("speed-profile-revert-cycle", everyMin);
  await add("speed-profile-reconcile-cycle", 10 * everyMin);
  await add("generate-invoices", everyDay);
  await replaceRepeatablesByName("daily-backup");
  await replaceRepeatablesByName("backup-scheduler");
  await replaceRepeatablesByName(BACKUP_SCHEDULE_TICK_JOB);
  const backupTickMs = Math.max(
    60_000,
    parseInt(process.env.BACKUP_SCHEDULE_TICK_MS ?? "180000", 10) || 180_000
  );
  await add(BACKUP_SCHEDULE_TICK_JOB, backupTickMs);
  await syncBackupScheduleCronJobsForDefaultTenant();
  await add("whatsapp-health-check", everyMin);
  await add("prune-server-logs", everyMin * 60);
  await add("ops-critical-alerts", everyMin * 2);
  if (!false) {
    await add("whatsapp-usage-alerts", everyMin * 30);
  }
  await replaceRepeatablesByName("whatsapp-expiry-reminders");
  await replaceRepeatablesByName("whatsapp-payment-due-reminders");
  await addCron("whatsapp-expiry-reminders", "0 12 * * *");
  await addCron("whatsapp-payment-due-reminders", "10 12 * * *");
  // Monthly radpostauth retention sweep — runs on the 1st of each month at 03:00.
  // Honors `radpostauth_retention_enabled` / `radpostauth_retention_months` settings.
  await replaceRepeatablesByName("prune-radpostauth");
  await addCron("prune-radpostauth", "0 3 1 * *");
  const infraMs = Math.max(
    60_000,
    parseInt(process.env.INFRASTRUCTURE_MONITOR_MS ?? "180000", 10) || 180_000
  );
  await add("infrastructure-monitor-cycle", infraMs);
  await replaceRepeatablesByName("telegram-status-report-tick");
  await add("telegram-status-report-tick", everyMin);
}

async function main() {
  await waitForDbReady();
  try {
    await ensureBillingTables();
    await ensureSubscriberWhatsAppOptOutColumn();
  } catch (error) {
    console.error("[worker] billing schema ensure failed", error);
  }
  try {
    await ensureDynamicSpeedTables(pool);
  } catch (error) {
    console.error("[worker] dynamic speed schema ensure failed", error);
  }
  markDbReady();
  startDiskMonitor();
  log.info("worker boot", {}, "bootstrap");

  const mikrotikSyncMs = Math.max(0, parseInt(process.env.MIKROTIK_API_SYNC_MS ?? "0", 10) || 0);
  if (mikrotikSyncMs >= 60_000) {
    const tick = () => {
      syncMikrotikSessionsFromNasTable(pool).catch((err) => {
        log.warn(`mikrotik_sync_tick_failed ${String((err as Error)?.message ?? err)}`, {}, "mikrotik-sync");
      });
    };
    tick();
    setInterval(tick, mikrotikSyncMs).unref();
  }

  await bootstrapRepeatables();

  try {
    const { runServerLogRetentionOnBoot } = await import("../services/logger.service.js");
    await runServerLogRetentionOnBoot(config.defaultTenantId);
  } catch (error) {
    console.error("[worker] server_logs retention bootstrap failed", error);
  }

  await connection.set(workerHeartbeatKey, new Date().toISOString());
  setInterval(() => {
    connection.set(workerHeartbeatKey, new Date().toISOString()).catch(() => {});
  }, 30_000).unref();

  const backupScheduleResyncMs = Math.max(
    5 * 60_000,
    parseInt(process.env.BACKUP_SCHEDULE_RESYNC_MS ?? "1800000", 10) || 1_800_000
  );
  setInterval(() => {
    syncBackupScheduleCronJobsForDefaultTenant().catch((err) => {
      console.warn("[backup-schedule] periodic resync failed", err);
    });
  }, backupScheduleResyncMs).unref();

  await listenEvent(Events.PAYMENT_RECEIVED, async (payload) => {
    await enqueueWahaPaymentReceived({
      tenantId: payload.tenantId,
      subscriberId: payload.subscriberId,
      invoiceNo: payload.invoiceNo,
      amount: payload.amount,
      currency: payload.currency,
      paidAt: payload.paidAt,
    });
  });
  const worker = new Worker(
    FUTURE_RADIUS_JOB_QUEUE,
    async (job) => {
      await dispatchWorkerJob({ pool, coa, nasHealth }, job);
    },
    { connection, concurrency: 1, lockDuration: 1_800_000, stalledInterval: 300_000 }
  );

  worker.on("failed", (job, err) => {
    log.error(`job_failed ${job?.name ?? "unknown"}: ${err?.message ?? "unknown"}`, {
      jobId: job?.id,
      name: job?.name,
      attemptsMade: job?.attemptsMade,
    }, "worker");
    console.error("job failed", job?.name, err);
  });

  startWorkerMetricsServer();
  console.log("Worker started (BullMQ)");
}

main().catch((e) => {
  console.error("worker bootstrap failed", e);
  process.exit(1);
});
