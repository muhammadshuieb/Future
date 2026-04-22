import { pathToFileURL } from "url";
import { config } from "../config.js";
import { pool, waitForDbReady } from "../lib/db.js";
import { hasTable } from "../db/schemaGuards.js";
import { AccountingService } from "../services/accounting.service.js";
import { RadiusService } from "../services/radius.service.js";
import { CoaService } from "../services/coa.service.js";
import type { RowDataPacket } from "mysql2";
import { emitEvent } from "../events/eventBus.js";
import { Events } from "../events/eventTypes.js";

/**
 * Every 60s cycle (used by BullMQ job and optional standalone process):
 * 1. Refresh user_usage_live from radacct, sync subscribers.used_bytes
 * 2. Expired subscribers → disableRadiusUser + status disabled
 * 3. Daily quota exceeded → throttle speed + CoA once/day (user_quota_state)
 */
export async function runUsageAndExpiryCycle(): Promise<void> {
  const tenantId = config.defaultTenantId;
  const accounting = new AccountingService(pool);
  const radius = new RadiusService(pool);
  const coa = new CoaService(pool);

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
    await radius.disableRadiusUser(username);
    await pool.execute(`UPDATE subscribers SET status = 'disabled' WHERE id = ?`, [row.id]);
    await emitEvent(Events.USER_EXPIRED, {
      tenantId,
      subscriberId: String(row.id ?? ""),
      username,
      expirationDate: new Date().toISOString(),
    }).catch(() => {});
    try {
      await pool.execute(`UPDATE rm_users SET enableuser = 0 WHERE username = ?`, [username]);
    } catch {
      /* rm_users optional */
    }
  }

  const [quotaRows] = await pool.query<RowDataPacket[]>(
    `SELECT
        s.id,
        s.username,
        p.quota_total_bytes,
        p.mikrotik_rate_limit,
        COALESCE(
          SUM(
            CASE
              WHEN r.acctstoptime IS NULL AND DATE(r.acctstarttime) = CURDATE()
                THEN COALESCE(r.acctinputoctets, 0) + COALESCE(r.acctoutputoctets, 0)
              WHEN r.acctstoptime IS NOT NULL AND DATE(r.acctstoptime) = CURDATE()
                THEN COALESCE(r.acctinputoctets, 0) + COALESCE(r.acctoutputoctets, 0)
              ELSE 0
            END
          ),
          0
        ) AS today_bytes
     FROM subscribers s
     JOIN packages p ON p.id = s.package_id
     LEFT JOIN radacct r
       ON r.username COLLATE utf8mb4_unicode_ci = s.username COLLATE utf8mb4_unicode_ci
     WHERE s.tenant_id = ? AND s.status = 'active' AND p.quota_total_bytes > 0
     GROUP BY s.id, s.username, p.quota_total_bytes, p.mikrotik_rate_limit
     HAVING today_bytes >= p.quota_total_bytes`,
    [tenantId]
  );
  for (const row of quotaRows) {
    const username = row.username as string;
    const [already] = await pool.query<RowDataPacket[]>(
      `SELECT username FROM user_quota_state WHERE tenant_id = ? AND username = ? AND quota_date = CURDATE() LIMIT 1`,
      [tenantId, username]
    );
    if (already[0]) continue;
    await radius.updateUserSpeed(username, config.quotaThrottleRate);
    await coa.disconnectAllSessions(username, tenantId);
    await pool.execute(
      `INSERT INTO user_quota_state (tenant_id, username, quota_date)
       VALUES (?, ?, CURDATE())
       ON DUPLICATE KEY UPDATE enforced_at = CURRENT_TIMESTAMP`,
      [tenantId, username]
    );
  }

  // Midnight restore: users throttled on previous day go back to package speed.
  const [restoreRows] = await pool.query<RowDataPacket[]>(
    `SELECT s.username, p.mikrotik_rate_limit
     FROM subscribers s
     JOIN packages p ON p.id = s.package_id
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
    const normalRate = String(row.mikrotik_rate_limit ?? "").trim();
    if (!username || !normalRate) continue;
    await radius.updateUserSpeed(username, normalRate);
    await coa.disconnectAllSessions(username, tenantId);
    await pool.execute(`DELETE FROM user_quota_state WHERE tenant_id = ? AND username = ?`, [
      tenantId,
      username,
    ]);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function mainUsageWorkerLoop(): Promise<void> {
  await waitForDbReady();
  console.log("[usage-worker] running full RADIUS usage + expiry cycle every 60s");
  for (;;) {
    try {
      await runUsageAndExpiryCycle();
    } catch (e) {
      console.error("[usage-worker] cycle failed (will retry)", e);
    }
    await sleep(60_000);
  }
}

const isMain =
  process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  mainUsageWorkerLoop().catch((e) => {
    console.error("[usage-worker] fatal", e);
    process.exit(1);
  });
}
