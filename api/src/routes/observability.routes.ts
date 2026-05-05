import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { Queue } from "bullmq";
import { createRedisClient } from "../lib/redis-connection.js";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";

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

export default router;
