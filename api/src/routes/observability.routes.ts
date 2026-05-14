import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { Queue } from "bullmq";
import { createRedisClient } from "../lib/redis-connection.js";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import {
  promQuery,
  promScalar,
  fetchActiveAlerts,
  fetchTargetsUp,
} from "../services/prometheus-client.service.js";
import {
  REMEDIATION_CATALOG,
  SYMPTOM_CATALOG,
  type RemediationEntry,
} from "../services/remediation.service.js";
import { getDiskSnapshot } from "../services/disk-monitor.service.js";
import {
  radiusOpenSessions,
  radiusActiveSubscribers,
  mysqlPoolConnections,
  bullmqQueueLagSeconds,
} from "../services/metrics.service.js";

const router = Router();
router.use(requireAuth);

const redis = createRedisClient("api-observability");
const jobQueue = new Queue("radius-manager", { connection: redis });
const workerHeartbeatKey = "future-radius:worker:heartbeat";

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

router.get("/summary", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const pingStarted = Date.now();
  const [counts, repeatables, failedJobs, waitingJobs, workerHeartbeat] = await Promise.all([
    withTimeout(
      jobQueue.getJobCounts("waiting", "active", "failed", "completed", "delayed"),
      1200,
      { waiting: 0, active: 0, failed: 0, completed: 0, delayed: 0, paused: 0 }
    ),
    withTimeout(jobQueue.getRepeatableJobs(), 1200, []),
    withTimeout(jobQueue.getFailed(0, 9), 1200, []),
    withTimeout(jobQueue.getWaiting(0, 0), 1200, []),
    withTimeout(redis.get(workerHeartbeatKey), 800, null),
  ]);
  const redisLatencyMs = Date.now() - pingStarted;

  const queueLagSeconds = waitingJobs[0]?.timestamp
    ? Math.max(0, Math.floor((Date.now() - waitingJobs[0].timestamp) / 1000))
    : 0;

  let backupLatest: RowDataPacket | null = null;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT status, started_at, finished_at, local_path, remote_path, error_message
       FROM backup_runs
       WHERE tenant_id = ?
       ORDER BY started_at DESC
       LIMIT 1`,
      [tenantId]
    );
    backupLatest = rows[0] ?? null;
  } catch {
    backupLatest = null;
  }

  let waStatus: {
    connected: boolean;
    reminder_days: number;
    message_interval_seconds: number;
  } | null = null;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT enabled, reminder_days, message_interval_seconds, last_check_ok
       FROM whatsapp_settings
       WHERE tenant_id = ?
       LIMIT 1`,
      [tenantId]
    );
    if (rows[0]) {
      waStatus = {
        connected: Boolean(Number(rows[0].enabled ?? 0) && Number(rows[0].last_check_ok ?? 0)),
        reminder_days: Number(rows[0].reminder_days ?? 5),
        message_interval_seconds: Number(rows[0].message_interval_seconds ?? 30),
      };
    }
  } catch {
    waStatus = null;
  }

  let failedWhatsappLast24h = 0;
  let retriedWhatsappLast24h = 0;
  try {
    const [retryRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS failed_24h,
         SUM(CASE WHEN retry_of IS NOT NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS retried_24h
       FROM whatsapp_message_logs
       WHERE tenant_id = ?`,
      [tenantId]
    );
    failedWhatsappLast24h = Number(retryRows[0]?.failed_24h ?? 0);
    retriedWhatsappLast24h = Number(retryRows[0]?.retried_24h ?? 0);
  } catch {
    failedWhatsappLast24h = 0;
    retriedWhatsappLast24h = 0;
  }

  res.json({
    system: {
      uptime_seconds: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      redis_latency_ms: redisLatencyMs,
      worker: {
        status:
          workerHeartbeat && Date.now() - new Date(workerHeartbeat).getTime() < 90_000
            ? "online"
            : "offline",
        last_heartbeat_at: workerHeartbeat ?? null,
      },
    },
    whatsapp: waStatus
      ? {
          connected: waStatus.connected,
          reminder_days: waStatus.reminder_days,
          message_interval_seconds: waStatus.message_interval_seconds,
          failed_24h: failedWhatsappLast24h,
          retried_24h: retriedWhatsappLast24h,
        }
      : null,
    jobs: {
      counts,
      queue_lag_seconds: queueLagSeconds,
      repeatables: repeatables.map((job) => ({
        name: job.name,
        next: job.next ? new Date(job.next).toISOString() : null,
      })),
      last_failed: failedJobs.map((job) => ({
        id: job.id,
        name: job.name,
        failed_reason: job.failedReason,
        attempts_made: job.attemptsMade,
        timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      })),
    },
    backup: backupLatest,
  });
});

/**
 * /system-health
 *
 * One-stop aggregate the panel's "System Health" page consumes. Combines:
 *  - in-process gauges so the page works even if Prometheus is down,
 *  - Prometheus instant queries for derived rates (e.g. auth-failure rate),
 *  - Alertmanager active alerts joined with the static remediation catalog.
 *
 * Designed to never throw: every external call is wrapped in withTimeout/safe
 * fetchers and the response always has a stable shape so the frontend can
 * render placeholders without conditional checks at every step.
 */
router.get("/system-health", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  const tenantId = req.auth!.tenantId;

  // 1) Live in-process gauges (always available, no network hops)
  // We read prom-client gauge values rather than re-querying the DB, because the
  // dedicated samplers (CachedGaugeSampler in metrics.routes + worker sampleRadiusGauges)
  // have already populated them with TTL-respecting values.
  // Some gauges live exclusively in the worker process (queue lag) or are populated
  // only on each /metrics scrape (mysql pool). We therefore query Prometheus for
  // the labelled values and fall back to in-process gauges so the page still works
  // before Prometheus has any history.
  const [
    poolTotalProm,
    poolUsedProm,
    poolFreeProm,
    poolQueuedProm,
    queueLagProm,
  ] = await Promise.all([
    promScalar(`futureradius_mysql_pool_connections{state="total"}`),
    promScalar(`futureradius_mysql_pool_connections{state="used"}`),
    promScalar(`futureradius_mysql_pool_connections{state="free"}`),
    promScalar(`futureradius_mysql_pool_connections{state="queued"}`),
    promScalar(`max(futureradius_bullmq_queue_lag_seconds)`),
  ]);

  const liveSnapshot = {
    open_sessions: await readGaugeValue(radiusOpenSessions),
    active_subscribers: await readGaugeValue(radiusActiveSubscribers),
    mysql_pool: {
      total: poolTotalProm ?? (await readGaugeValue(mysqlPoolConnections, { state: "total" })),
      used: poolUsedProm ?? (await readGaugeValue(mysqlPoolConnections, { state: "used" })),
      free: poolFreeProm ?? (await readGaugeValue(mysqlPoolConnections, { state: "free" })),
      queued: poolQueuedProm ?? (await readGaugeValue(mysqlPoolConnections, { state: "queued" })),
    },
    queue_lag_seconds:
      queueLagProm ?? (await readGaugeValue(bullmqQueueLagSeconds, { queue: "radius-manager" })),
    process: {
      uptime_seconds: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
    },
    disk: getDiskSnapshot(),
  };

  // 2) Derived Prometheus rates over the last 5 minutes — only present when
  //    Prometheus has been scraping us (returns null otherwise so the UI hides
  //    those cards).
  const [
    authFailRate,
    syntheticFailRate,
    coaTimeoutRate,
    workerCycleP95,
    httpRequestsRate,
    targetsUp,
  ] = await Promise.all([
    promScalar(`sum(rate(futureradius_auth_failed_total[5m]))`),
    promScalar(`sum(rate(futureradius_synth_check_total{result!="ok"}[5m]))`),
    promScalar(`sum(rate(futureradius_coa_disconnect_total{result="timeout"}[5m]))`),
    promScalar(`histogram_quantile(0.95, sum(rate(futureradius_worker_cycle_duration_seconds_bucket[5m])) by (le))`),
    promScalar(`sum(rate(futureradius_http_requests_total[1m]))`),
    fetchTargetsUp(),
  ]);

  // CoA breakdown per NAS for the last 5 min — feeds the "which MikroTik is failing" table.
  const coaByNasRows = await promQuery(`sum by (nas, result) (increase(futureradius_coa_disconnect_total[5m]))`);
  const coaByNas: Record<string, { ok: number; fail: number; timeout: number; encode_error: number }> = {};
  for (const row of coaByNasRows) {
    const nas = row.metric.nas || "unknown";
    const result = row.metric.result || "unknown";
    coaByNas[nas] = coaByNas[nas] ?? { ok: 0, fail: 0, timeout: 0, encode_error: 0 };
    const value = Number(row.value[1]) || 0;
    if (result in coaByNas[nas]) {
      (coaByNas[nas] as Record<string, number>)[result] = value;
    }
  }

  // 3) Active alerts joined with remediation catalog. We deduplicate by alertname
  //    so the same alert firing on multiple labels collapses into one card with
  //    a list of affected instances; this matches operator expectations.
  const alerts = await fetchActiveAlerts();
  type AlertOut = {
    alertname: string;
    severity: string;
    summary: string;
    description: string;
    instances: { labels: Record<string, string>; startsAt: string }[];
    remediation: RemediationEntry | null;
  };
  const alertsMap = new Map<string, AlertOut>();
  for (const a of alerts) {
    const name = a.labels.alertname || "unknown";
    const severity = (a.labels.severity || "info") as string;
    const summary = a.annotations.summary || a.annotations.description || "";
    const description = a.annotations.description || "";
    const entry = alertsMap.get(name) ?? {
      alertname: name,
      severity,
      summary,
      description,
      instances: [],
      remediation: REMEDIATION_CATALOG[name] ?? null,
    };
    entry.instances.push({ labels: a.labels, startsAt: a.startsAt });
    alertsMap.set(name, entry);
  }

  // 4) Symptom-based hints when no formal alert is firing yet but a metric crosses
  //    a threshold. This gives the operator early signal in the alert grace period.
  const symptoms: RemediationEntry[] = [];
  const memUsage = process.memoryUsage();
  const memPct = memUsage.rss / 1024 / 1024;
  if (memPct > 768) symptoms.push(SYMPTOM_CATALOG.highMemoryUsage);
  if (liveSnapshot.disk && liveSnapshot.disk.pct >= 85) symptoms.push(SYMPTOM_CATALOG.diskNearFull);

  res.json({
    tenant_id: tenantId,
    generated_at: new Date().toISOString(),
    live: liveSnapshot,
    rates: {
      auth_fail_per_sec: authFailRate,
      synthetic_fail_per_sec: syntheticFailRate,
      coa_timeout_per_sec: coaTimeoutRate,
      worker_cycle_p95_seconds: workerCycleP95,
      http_requests_per_sec: httpRequestsRate,
    },
    targets_up: targetsUp,
    coa_by_nas: coaByNas,
    alerts: Array.from(alertsMap.values()),
    symptoms,
    grafana_url: process.env.GRAFANA_PUBLIC_URL || null,
    prometheus_configured: process.env.PROMETHEUS_URL != null || true,
  });
});

/** Read a single labelled value from a prom-client Gauge without going through
 *  the textual exposition format. Returns null when the label combination has
 *  not been recorded yet (avoids "0" false negatives).
 *
 *  prom-client's `Gauge<T>` has a parametric label type, so we accept `unknown`
 *  here and use a runtime structural check; the alternative would be importing
 *  the internal MetricValue type which is not part of the public type surface
 *  in version 15.x.
 */
async function readGaugeValue(
  gauge: { get: () => unknown },
  labels?: Record<string, string>
): Promise<number | null> {
  try {
    const snapshotRaw = await Promise.resolve(gauge.get() as Promise<unknown> | unknown);
    const snapshot = snapshotRaw as { values?: { value: number; labels?: Record<string, string | number> }[] };
    const values = snapshot.values ?? [];
    if (!labels) {
      const first = values[0];
      return first ? Number(first.value) : null;
    }
    const found = values.find((v) => {
      const vl = v.labels ?? {};
      return Object.entries(labels).every(([k, val]) => String(vl[k] ?? "") === val);
    });
    return found ? Number(found.value) : null;
  } catch {
    return null;
  }
}

export default router;
