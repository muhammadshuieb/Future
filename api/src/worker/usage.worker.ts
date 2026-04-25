import { Redis } from "ioredis";
import { config } from "../config.js";
import { pool, waitForDbReady } from "../lib/db.js";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { AccountingService } from "../services/accounting.service.js";
import { RadiusService } from "../services/radius.service.js";
import { CoaService, type DisconnectAllReport } from "../services/coa.service.js";
import type { RowDataPacket } from "mysql2";
import { emitEvent } from "../events/eventBus.js";
import { Events } from "../events/eventTypes.js";
import { withUsageCycleLock } from "../lib/usage-lock.js";
import { pushRadiusByUsername } from "../lib/subscriber-radius.js";

let redisLock: Redis | null = null;
function getRedisLock(): Redis {
  if (!redisLock) {
    redisLock = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  return redisLock;
}

async function buildSessionOctetMaxExpr(): Promise<string> {
  const gIn = await hasColumn(pool, "radacct", "acctinputgigawords");
  const gOut = await hasColumn(pool, "radacct", "acctoutputgigawords");
  if (gIn && gOut) {
    return `(COALESCE(r.acctinputoctets,0) + COALESCE(r.acctinputgigawords,0) * 4294967296) + (COALESCE(r.acctoutputoctets,0) + COALESCE(r.acctoutputgigawords,0) * 4294967296)`;
  }
  return `COALESCE(r.acctinputoctets, 0) + COALESCE(r.acctoutputoctets, 0)`;
}

/**
 * Every 60s cycle (BullMQ `update-usage` job):
 * 1. Refresh user_usage_live from radacct, sync subscribers.used_bytes
 * 2. Expired subscribers → disableRadiusUser + status disabled
 * 3. Daily quota exceeded → hard deny in radcheck + CoA + MikroTik (once/day via user_quota_state)
 * 4. New calendar day: restore package speed from subscribers (push RADIUS) if not enforced today
 */
export async function runUsageAndExpiryCycle(): Promise<void> {
  const tenantId = config.defaultTenantId;
  const accounting = new AccountingService(pool);
  const radius = new RadiusService(pool);
  const coa = new CoaService(pool);

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
}

async function runUsageAndExpiryCycleUnlocked(opts: {
  tenantId: string;
  accounting: AccountingService;
  radius: RadiusService;
  coa: CoaService;
}): Promise<void> {
  const { tenantId, accounting, radius, coa } = opts;

  if (!(await hasTable(pool, "radcheck"))) {
    return;
  }
  if (!(await hasTable(pool, "user_quota_state"))) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_quota_state (
        tenant_id CHAR(36) NOT NULL,
        username VARCHAR(64) NOT NULL,
        quota_date DATE NOT NULL,
        enforced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, username, quota_date),
        KEY idx_uqs_tenant_date (tenant_id, quota_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  await accounting.refreshUsageCache(tenantId);
  try {
    await accounting.syncSubscribersUsedBytes(tenantId);
  } catch (e) {
    console.error("[usage-worker] syncSubscribersUsedBytes", e);
  }

  const [due] = await pool.query<RowDataPacket[]>(
    `SELECT id, username FROM subscribers
     WHERE tenant_id = ? AND status = 'active' AND expiration_date < NOW()`,
    [tenantId]
  );
  for (const row of due) {
    const username = row.username as string;
    await coa.disconnectAllSessions(username, tenantId).catch((e) =>
      console.error("[usage-worker] coa on expiry for", username, e)
    );
    await radius.disableRadiusUser(username);
    await pool.execute(`UPDATE subscribers SET status = 'disabled' WHERE id = ?`, [row.id]);
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
    try {
      await pool.execute(`UPDATE rm_users SET enableuser = 0 WHERE username = ?`, [username]);
    } catch {
      /* rm_users optional */
    }
  }

  const octMax = await buildSessionOctetMaxExpr();
  const quotaSql = `
    WITH sess AS (
      SELECT
        r.username,
        r.radacctid,
        MIN(r.acctstarttime) AS acctstarttime,
        MAX(r.acctstoptime) AS acctstoptime,
        MAX(${octMax}) AS session_octets
      FROM radacct r
      WHERE r.username <> ''
      GROUP BY r.username, r.radacctid
    )
    SELECT
      s.id,
      s.username,
      p.quota_total_bytes,
      p.mikrotik_rate_limit,
      COALESCE(
        SUM(
          CASE
            WHEN se.acctstoptime IS NULL THEN
              se.session_octets * (
                GREATEST(0, TIMESTAMPDIFF(SECOND, GREATEST(se.acctstarttime, CONCAT(CURDATE(), ' 00:00:00')), NOW()))
                / NULLIF(GREATEST(1, TIMESTAMPDIFF(SECOND, se.acctstarttime, NOW())), 0)
              )
            WHEN se.acctstoptime IS NOT NULL THEN
              se.session_octets * (
                GREATEST(0, TIMESTAMPDIFF(SECOND, GREATEST(se.acctstarttime, CONCAT(CURDATE(), ' 00:00:00')), se.acctstoptime))
                / NULLIF(GREATEST(1, TIMESTAMPDIFF(SECOND, se.acctstarttime, se.acctstoptime)), 0)
              )
            ELSE 0
          END
        ),
        0
      ) AS today_bytes
    FROM subscribers s
    JOIN packages p ON p.id = s.package_id
    LEFT JOIN sess se ON se.username = s.username
    WHERE s.tenant_id = ? AND s.status = 'active' AND p.quota_total_bytes > 0
    GROUP BY s.id, s.username, p.quota_total_bytes, p.mikrotik_rate_limit
    HAVING today_bytes >= p.quota_total_bytes
  `;

  const [quotaRows] = await pool.query<RowDataPacket[]>(quotaSql, [tenantId]);
  for (const row of quotaRows) {
    const username = row.username as string;
    const [already] = await pool.query<RowDataPacket[]>(
      `SELECT username FROM user_quota_state WHERE tenant_id = ? AND username = ? AND quota_date = CURDATE() LIMIT 1`,
      [tenantId, username]
    );
    if (already[0]) continue;
    let report: DisconnectAllReport | null = null;
    try {
      report = await coa.disconnectAllSessions(username, tenantId);
    } catch (e) {
      console.error("[usage-worker] coa before quota hard deny for", username, e);
    }
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
    await pool.execute(
      `INSERT INTO user_quota_state (tenant_id, username, quota_date)
       VALUES (?, ?, CURDATE())
       ON DUPLICATE KEY UPDATE enforced_at = CURRENT_TIMESTAMP`,
      [tenantId, username]
    );
  }

  // New day: re-push full RADIUS profile for users throttled on a previous calendar day.
  const [restoreRows] = await pool.query<RowDataPacket[]>(
    `SELECT s.username
     FROM subscribers s
     WHERE s.tenant_id = ? AND s.status = 'active'
       AND EXISTS (
         SELECT 1 FROM user_quota_state q
         WHERE q.tenant_id = s.tenant_id AND q.username = s.username
       )
       AND NOT EXISTS (
         SELECT 1 FROM user_quota_state q
         WHERE q.tenant_id = s.tenant_id AND q.username = s.username AND q.quota_date = CURDATE()
       )`,
    [tenantId]
  );
  for (const row of restoreRows) {
    const username = String(row.username ?? "");
    if (!username) continue;
    const push = await pushRadiusByUsername(pool, radius, tenantId, username);
    if (!push.ok) {
      console.error("[usage-worker] restore RADIUS after quota day failed for", username, push.reason);
      continue;
    }
    const rep = await coa.disconnectAllSessions(username, tenantId).catch((e) => {
      console.error("[usage-worker] coa after restore for", username, e);
      return null;
    });
    if (rep && !rep.anyOk) {
      console.warn("[usage-worker] coa after day-boundary restore: no-ack for", username);
    }
    await pool.execute(`DELETE FROM user_quota_state WHERE tenant_id = ? AND username = ?`, [tenantId, username]);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @deprecated Do not use alongside BullMQ `update-usage` (duplicate 60s cycles). Kept for emergency scripts only.
 */
export async function mainUsageWorkerLoop(): Promise<void> {
  await waitForDbReady();
  console.warn(
    "[usage-worker] start:usage-worker is deprecated; use the worker service (BullMQ) for update-usage"
  );
  for (;;) {
    try {
      await runUsageAndExpiryCycle();
    } catch (e) {
      console.error("[usage-worker] cycle failed (will retry)", e);
    }
    await sleep(60_000);
  }
}
