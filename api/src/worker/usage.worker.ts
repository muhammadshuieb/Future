import { Redis } from "ioredis";
import { config } from "../config.js";
import { createRedisClient } from "../lib/redis-connection.js";
import { pool, waitForDbReady } from "../lib/db.js";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { AccountingService } from "../services/accounting.service.js";
import { RadiusService } from "../services/radius.service.js";
import { CoaService, type DisconnectAllReport } from "../services/coa.service.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { emitEvent } from "../events/eventBus.js";
import { Events } from "../events/eventTypes.js";
import { withUsageCycleLock } from "../lib/usage-lock.js";
import { log } from "../services/logger.service.js";
import { closeDisconnectedRadacctSessions } from "../services/session-disconnect.service.js";
import { runPrepaidCardLifecycleCycle } from "../services/prepaid-card-lifecycle.service.js";
import {
  radiusActiveSubscribers,
  radiusOpenSessions,
  workerCycleDurationSeconds,
  expiredUsersTotal,
  quotaExceededTotal,
  workerStaleSessionsClosedTotal,
} from "../services/metrics.service.js";
import { reconcileSubscriberSessions } from "../services/session-engine.service.js";

/** Sample live gauges so the worker's /metrics endpoint reports the same truth as the api's. */
async function sampleRadiusGauges(): Promise<void> {
  try {
    if (await hasTable(pool, "radacct")) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM radacct WHERE acctstoptime IS NULL`
      );
      radiusOpenSessions.set(Number(rows[0]?.c ?? 0));
    }
    if (await hasTable(pool, "subscribers")) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM subscribers WHERE status = 'active'`
      );
      radiusActiveSubscribers.set(Number(rows[0]?.c ?? 0));
    }
  } catch (e) {
    console.warn("[usage-worker] gauge sample failed:", e instanceof Error ? e.message : e);
  }
}

let redisLock: Redis | null = null;
let usageRefreshCycleCounter = 0;
const PROJECT_EXPIRED_RADIUS_BATCH = Math.max(
  100,
  Math.min(5000, parseInt(process.env.PROJECT_EXPIRED_RADIUS_BATCH ?? "1000", 10) || 1000)
);
function getRedisLock(): Redis {
  if (!redisLock) {
    redisLock = createRedisClient("usage-cycle-lock");
  }
  return redisLock;
}

async function tableHasIndex(table: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS found
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function closeOpenRadacctSessions(username: string): Promise<void> {
  if (!(await hasTable(pool, "radacct"))) return;
  // Fallback cleanup when NAS/CoA does not emit Accounting-Stop.
  await pool.execute(
    `UPDATE radacct
     SET acctstoptime = NOW(),
         acctsessiontime = GREATEST(0, TIMESTAMPDIFF(SECOND, acctstarttime, NOW())),
         acctterminatecause = CASE
           WHEN COALESCE(acctterminatecause, '') = '' THEN 'Admin-Reset'
           ELSE acctterminatecause
         END
     WHERE username = ?
       AND acctstoptime IS NULL`,
    [username]
  );
}

/**
 * Close radacct rows that have been "open" (no Stop) but whose last accounting heartbeat
 * (acctupdatetime, falling back to acctstarttime) is older than STALE_SESSION_MINUTES.
 *
 * This complements per-user policy closure: it catches dead sessions left behind when a
 * MikroTik reboots/loses power and never sends Acct-Stop. Without this pass the session
 * would keep counting against Simultaneous-Use forever.
 *
 * The freeradius `futureradius_check_simultaneous_use` policy already filters by the same
 * 15-minute window so the user can re-login immediately; this UPDATE just keeps the table
 * tidy and accounting reports accurate.
 */
async function closeTimedOutSessions(): Promise<number> {
  if (!(await hasTable(pool, "radacct"))) return 0;
  const minutes = Math.max(5, Math.min(24 * 60, Number(process.env.STALE_SESSION_MINUTES) || 15));
  const hasUpdate = await hasColumn(pool, "radacct", "acctupdatetime");
  const heartbeat = hasUpdate ? "COALESCE(acctupdatetime, acctstarttime)" : "acctstarttime";
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE radacct
     SET acctstoptime = NOW(),
         acctsessiontime = GREATEST(0, TIMESTAMPDIFF(SECOND, acctstarttime, NOW())),
         acctterminatecause = CASE
           WHEN COALESCE(acctterminatecause, '') = '' THEN 'NAS-Reboot'
           ELSE acctterminatecause
         END
     WHERE radacctid IN (
       SELECT radacctid FROM (
         SELECT radacctid
         FROM radacct
         WHERE acctstoptime IS NULL
           AND ${heartbeat} < DATE_SUB(NOW(), INTERVAL ${minutes} MINUTE)
         ORDER BY radacctid
         LIMIT ${PROJECT_EXPIRED_RADIUS_BATCH}
       ) stale
     )`
  );
  const closed = Number(result?.affectedRows ?? 0);
  if (closed > 0) {
    workerStaleSessionsClosedTotal.inc(closed);
    console.info(`[usage-worker] timed-out sessions closed: ${closed} (idle > ${minutes}m)`);
  }
  return closed;
}

async function closeStaleOpenRadacctSessionsByPolicy(tenantId: string): Promise<number> {
  if (!(await hasTable(pool, "radacct"))) return 0;
  if (!(await hasTable(pool, "subscribers"))) return 0;
  const radacctIndexHint = (await tableHasIndex("radacct", "idx_fr_radacct_username_stop"))
    ? " FORCE INDEX (idx_fr_radacct_username_stop)"
    : (await tableHasIndex("radacct", "username"))
      ? " FORCE INDEX (username)"
      : "";
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE radacct r
     SET r.acctstoptime = NOW(),
         r.acctsessiontime = GREATEST(0, TIMESTAMPDIFF(SECOND, r.acctstarttime, NOW())),
         r.acctterminatecause = CASE
           WHEN COALESCE(r.acctterminatecause, '') = '' THEN 'Admin-Reset'
           ELSE r.acctterminatecause
         END
     WHERE r.radacctid IN (
       SELECT radacctid FROM (
         SELECT r2.radacctid
         FROM subscribers s
         STRAIGHT_JOIN radacct r2${radacctIndexHint}
           ON r2.username = s.username
          AND r2.acctstoptime IS NULL
         WHERE s.tenant_id = ?
           AND LOWER(TRIM(COALESCE(s.status, ''))) <> 'active'
         LIMIT ${PROJECT_EXPIRED_RADIUS_BATCH}
       ) disabled_open
     )`,
    [tenantId]
  );
  const closed = Number(result?.affectedRows ?? 0);
  if (closed > 0) {
    console.info(`[usage-worker] stale open sessions closed by policy: ${closed} (tenant=${tenantId})`);
  }
  return closed;
}

/**
 * Every 60s cycle (BullMQ `update-usage` job):
 * 1. Refresh user_usage_live from radacct, sync subscribers.used_bytes
 * 2. Expired active subscribers → CoA, disableRadiusUser, status expired + event
 * 3. Overdue sent invoices → CoA + disableRadiusUser
 * 4. Lifetime quota (used_bytes vs package.quota_total_bytes) → CoA, applyQuotaHardDeny, suspend + event
 * 5. Policy sweep: anyone failing tenant/customer/package/expiry/quota/invoice rules loses Cleartext-Password
 * 6. Stale open radacct rows (NAS reboot / lost stop) closed by idle threshold and by non-active subscriber policy
 */
export async function runUsageAndExpiryCycle(): Promise<void> {
  const tenantId = config.defaultTenantId;
  const accounting = new AccountingService(pool);
  const radius = new RadiusService(pool);
  const coa = new CoaService(pool);

  const endTimer = workerCycleDurationSeconds.startTimer({ mode: "full" });
  try {
    const locked = await withUsageCycleLock(getRedisLock(), async () => {
      await runUsageAndExpiryCycleUnlocked({
        tenantId,
        accounting,
        radius,
        coa,
      });
    });
    if (!locked.ran) {
      console.info("[usage-worker] skip cycle: another instance holds the lock");
    }
  } finally {
    endTimer();
    await sampleRadiusGauges();
  }
}

async function runUsageAndExpiryCycleUnlocked(opts: {
  tenantId: string;
  accounting: AccountingService;
  radius: RadiusService;
  coa: CoaService;
}): Promise<void> {
  const { tenantId, accounting, radius, coa } = opts;
  let expiredHandledCount = 0;
  let quotaDeniedCount = 0;

  if (!(await hasTable(pool, "radcheck"))) {
    return;
  }

  if (!(await hasTable(pool, "subscribers"))) {
    return;
  }

  const refreshEveryCycles = Math.max(
    1,
    Number.parseInt(process.env.USAGE_CACHE_REFRESH_EVERY_CYCLES ?? "5", 10) || 5
  );
  usageRefreshCycleCounter = (usageRefreshCycleCounter + 1) % refreshEveryCycles;
  const shouldRefreshUsageCache = usageRefreshCycleCounter === 0;
  if (shouldRefreshUsageCache) {
    await accounting.refreshUsageCache(tenantId);
    try {
      await accounting.syncSubscribersUsedBytes(tenantId);
    } catch (e) {
      console.error("[usage-worker] syncSubscribersUsedBytes", e);
    }
    if (await hasTable(pool, "user_usage_daily")) {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      try {
        await accounting.rollupDailyForStoppedSessions(tenantId, today);
        if (yesterday !== today) {
          await accounting.rollupDailyForStoppedSessions(tenantId, yesterday);
        }
      } catch (e) {
        console.error("[usage-worker] rollupDailyForStoppedSessions", e);
      }
    }
  }

  // Anyone who still has Cleartext-Password in radcheck but fails subscription rules → hard deny (no naked deletes).
  if (await hasTable(pool, "radcheck")) {
    const [violators] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT s.username
       FROM subscribers s
       INNER JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
       INNER JOIN radcheck rc ON rc.username = s.username AND rc.attribute = 'Cleartext-Password'
       WHERE s.tenant_id = ?
         AND (
           LOWER(TRIM(COALESCE(t.status, ''))) <> 'active'
           OR (c.id IS NOT NULL AND LOWER(TRIM(COALESCE(c.status, ''))) <> 'active')
           OR LOWER(TRIM(COALESCE(s.status, ''))) <> 'active'
           OR (s.expiration_date IS NOT NULL AND s.expiration_date < NOW())
           OR s.package_id IS NULL
           OR COALESCE(p.active, 0) <> 1
           OR (COALESCE(p.quota_total_bytes, 0) > 0 AND s.used_bytes >= p.quota_total_bytes)
           OR EXISTS (
             SELECT 1 FROM invoices i
             WHERE i.tenant_id = s.tenant_id
               AND i.subscriber_id = s.id
               AND i.status = 'sent'
               AND i.due_date < CURDATE()
           )
         )
       LIMIT ${PROJECT_EXPIRED_RADIUS_BATCH}`,
      [tenantId]
    );
    for (const row of violators) {
      const u = String(row.username ?? "");
      if (!u) continue;
      await radius.disableRadiusUser(u).catch((e) =>
        console.error("[usage-worker] disableRadius policy sweep failed for", u, e)
      );
    }
  }

  const [due] = await pool.query<RowDataPacket[]>(
    `SELECT id, username FROM subscribers
     WHERE tenant_id = ? AND status = 'active' AND expiration_date < NOW()`,
    [tenantId]
  );
  for (const row of due) {
    const username = row.username as string;
    const report = await coa.disconnectAllSessions(username, tenantId).catch((e) => {
      console.error("[usage-worker] coa on expiry for", username, e);
      return null;
    });
    await closeDisconnectedRadacctSessions(pool, username, tenantId, report, "expired").catch((e) =>
      console.error("[usage-worker] radacct close on expiry for", username, e)
    );
    await radius.disableRadiusUser(username);
    await pool.execute(`UPDATE subscribers SET status = 'expired' WHERE id = ?`, [row.id]);
    try {
      await emitEvent(Events.USER_EXPIRED, {
        tenantId,
        subscriberId: String(row.id ?? ""),
        username,
        expirationDate: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[usage-worker] emit USER_EXPIRED failed", e);
    }
    expiredHandledCount += 1;
    expiredUsersTotal.inc();
  }

  let overdueInvoiceDenyCount = 0;
  if (await hasTable(pool, "invoices")) {
    const [overdueSubs] = await pool.query<RowDataPacket[]>(
      `SELECT s.username
       FROM subscribers s
       WHERE s.tenant_id = ?
         AND LOWER(TRIM(COALESCE(s.status, ''))) = 'active'
         AND EXISTS (
           SELECT 1 FROM invoices i
           WHERE i.tenant_id = s.tenant_id
             AND i.subscriber_id = s.id
             AND i.status = 'sent'
             AND i.due_date < CURDATE()
         )`,
      [tenantId]
    );
    for (const row of overdueSubs) {
      const username = String(row.username ?? "");
      if (!username) continue;
      const report = await coa.disconnectAllSessions(username, tenantId).catch((e) => {
        console.error("[usage-worker] coa on overdue invoice for", username, e);
        return null;
      });
      await closeDisconnectedRadacctSessions(pool, username, tenantId, report, "overdue_invoice").catch((e) =>
        console.error("[usage-worker] radacct close on overdue invoice for", username, e)
      );
      await radius.disableRadiusUser(username).catch((e) =>
        console.error("[usage-worker] disableRadius on overdue invoice for", username, e)
      );
      overdueInvoiceDenyCount += 1;
    }
  }

  const [quotaRows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.username, s.used_bytes, p.quota_total_bytes
     FROM subscribers s
     INNER JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     WHERE s.tenant_id = ?
       AND s.status = 'active'
       AND COALESCE(p.quota_total_bytes, 0) > 0
       AND s.used_bytes >= p.quota_total_bytes`,
    [tenantId]
  );
  for (const row of quotaRows) {
    const username = row.username as string;
    const sid = String(row.id ?? "");
    const usedB = String(row.used_bytes ?? "0");
    const quotaB = String(row.quota_total_bytes ?? "0");
    let report: DisconnectAllReport | null = null;
    try {
      report = await coa.disconnectAllSessions(username, tenantId);
    } catch (e) {
      console.error("[usage-worker] coa before quota hard deny for", username, e);
    }
    await closeDisconnectedRadacctSessions(pool, username, tenantId, report, "quota").catch((e) =>
      console.error("[usage-worker] radacct close before quota hard deny for", username, e)
    );
    if (report && !report.anyOk) {
      console.warn(
        "[usage-worker] no session disconnect success for",
        username,
        JSON.stringify(report.results?.slice(0, 2))
      );
    }
    try {
      await radius.applyQuotaHardDeny(username);
    } catch (e) {
      console.error("[usage-worker] applyQuotaHardDeny failed for", username, e);
    }
    await pool
      .execute(`UPDATE subscribers SET status = 'suspended' WHERE id = ? AND tenant_id = ?`, [sid, tenantId])
      .catch((e) => console.error("[usage-worker] suspend on quota failed for", username, e));
    try {
      await emitEvent(Events.USER_QUOTA_SUSPENDED, {
        tenantId,
        subscriberId: sid,
        username,
        usedBytes: usedB,
        quotaBytes: quotaB,
      });
    } catch (e) {
      console.error("[usage-worker] emit USER_QUOTA_SUSPENDED failed", e);
    }
    quotaDeniedCount += 1;
    quotaExceededTotal.inc();
  }

  const stalePolicy = await closeStaleOpenRadacctSessionsByPolicy(tenantId);
  const timedOut = await closeTimedOutSessions();
  await reconcileSubscriberSessions(pool, tenantId).catch((e) =>
    console.warn("[usage-worker] session reconcile failed", e instanceof Error ? e.message : e)
  );

  let prepaidSummary = {
    usage_refreshed: 0,
    expired: 0,
    quota_exceeded: 0,
    time_exceeded: 0,
    disconnect_sent: 0,
    disconnect_failed: 0,
  };
  try {
    prepaidSummary = await runPrepaidCardLifecycleCycle({ pool, tenantId, coa, radius });
  } catch (e) {
    console.error("[usage-worker] prepaid card lifecycle failed", e);
  }

  console.info(
    `[usage-worker] cycle summary: expired_handled=${expiredHandledCount} overdue_invoice_radius_cleared=${overdueInvoiceDenyCount} quota_suspended=${quotaDeniedCount} stale_policy_closed=${stalePolicy} timed_out=${timedOut} prepaid_expired=${prepaidSummary.expired} prepaid_quota=${prepaidSummary.quota_exceeded} prepaid_time=${prepaidSummary.time_exceeded}`
  );
  log.info(
    "usage_cycle_summary",
    {
      tenant_id: tenantId,
      expired_handled: expiredHandledCount,
      overdue_invoice_cleared: overdueInvoiceDenyCount,
      quota_suspended: quotaDeniedCount,
      stale_policy_closed: stalePolicy,
      timed_out_sessions: timedOut,
      prepaid: prepaidSummary,
    },
    "usage-worker"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @deprecated Standalone loop for emergencies only; production uses BullMQ `update-usage` in `workers/index.ts`.
 */
export async function mainUsageWorkerLoop(): Promise<void> {
  await waitForDbReady();
  console.warn("[usage-worker] mainUsageWorkerLoop is deprecated; use the BullMQ worker `update-usage` job");
  for (;;) {
    try {
      await runUsageAndExpiryCycle();
    } catch (e) {
      console.error("[usage-worker] cycle failed (will retry)", e);
    }
    await sleep(60_000);
  }
}
