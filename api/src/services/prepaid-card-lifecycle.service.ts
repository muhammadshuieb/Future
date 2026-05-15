import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { radacctSessionOctetsExpr } from "../lib/radacct-octets.js";
import {
  evaluatePrepaidCardAccessFromRow,
  lifecycleStatusForTerminateReason,
  type PrepaidDenyReason,
} from "../lib/prepaid-card-access.js";
import type { CoaService } from "./coa.service.js";
import type { RadiusService } from "./radius.service.js";
import { closeDisconnectedRadacctSessions, summarizeDisconnectReport } from "./session-disconnect.service.js";
import { syncRmCardToRadius, type RmCardRadiusRow } from "./rm-card-radius-sync.service.js";
import { writeAuditLog } from "./audit-log.service.js";
import { log } from "./logger.service.js";
import {
  prepaidCardsDisconnectTotal,
  prepaidCardsExpiredTotal,
  prepaidCardsQuotaExceededTotal,
  prepaidCardsTimeExceededTotal,
} from "./metrics.service.js";

const PREPAID_BATCH = Math.max(
  50,
  Math.min(2000, parseInt(process.env.PREPAID_CARD_LIFECYCLE_BATCH ?? "500", 10) || 500)
);

export type PrepaidLifecycleSummary = {
  usage_refreshed: number;
  expired: number;
  quota_exceeded: number;
  time_exceeded: number;
  disconnect_sent: number;
  disconnect_failed: number;
};

type CardLifecycleRow = RowDataPacket & {
  id: number;
  tenant_id: string;
  cardnum: string;
  password: string;
  expiration: string;
  package_id: string | null;
  simultaneous_use: number;
  active: number;
  revoked: number;
  total_limit_mb: number;
  download_limit_mb: number;
  upload_limit_mb: number;
  online_time_limit: number;
  available_time_from_activation: number;
  lifecycle_status: string;
  used_bytes: number;
  used_seconds: number;
  first_used_at: Date | string | null;
};

export async function refreshPrepaidCardsUsageFromRadacct(pool: Pool, tenantId: string): Promise<number> {
  if (!(await hasTable(pool, "rm_cards")) || !(await hasTable(pool, "radacct"))) return 0;
  if (!(await hasColumn(pool, "rm_cards", "used_bytes"))) return 0;

  const hasLifecycle = await hasColumn(pool, "rm_cards", "lifecycle_status");
  const lifecycleFilter = hasLifecycle
    ? `AND c2.lifecycle_status IN ('available', 'active')`
    : `AND c2.active = 1 AND c2.revoked = 0`;

  const octets = await radacctSessionOctetsExpr(pool, "r");

  const [result] = await pool.query(
    `UPDATE rm_cards c
     INNER JOIN (
       SELECT
         agg.username,
         COALESCE(SUM(agg.session_bytes), 0) AS total_bytes,
         COALESCE(SUM(agg.session_seconds), 0) AS total_seconds,
         MIN(agg.first_start) AS first_start,
         MAX(agg.last_touch) AS last_touch
       FROM (
         SELECT
           r.username,
           r.radacctid,
           MAX(${octets}) AS session_bytes,
           MAX(
             CASE WHEN r.acctstoptime IS NULL THEN
               GREATEST(COALESCE(r.acctsessiontime, 0), TIMESTAMPDIFF(SECOND, r.acctstarttime, NOW()))
             ELSE COALESCE(r.acctsessiontime, 0) END
           ) AS session_seconds,
           MIN(r.acctstarttime) AS first_start,
           MAX(COALESCE(r.acctupdatetime, r.acctstoptime, r.acctstarttime)) AS last_touch
         FROM radacct r
         INNER JOIN rm_cards c2 ON c2.cardnum = r.username AND c2.tenant_id = ?
         WHERE r.username <> ''
           ${lifecycleFilter}
         GROUP BY r.username, r.radacctid
       ) agg
       GROUP BY agg.username
     ) u ON u.username = c.cardnum
     SET
       c.used_bytes = u.total_bytes,
       c.used_seconds = u.total_seconds,
       c.first_used_at = COALESCE(c.first_used_at, u.first_start),
       c.last_used_at = u.last_touch,
       c.lifecycle_status = CASE
         WHEN c.lifecycle_status = 'available' AND u.first_start IS NOT NULL THEN 'active'
         ELSE c.lifecycle_status
       END
     WHERE c.tenant_id = ?`,
    [tenantId, tenantId]
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

function rowToRadiusSync(row: CardLifecycleRow): RmCardRadiusRow {
  return {
    cardnum: String(row.cardnum),
    password: String(row.password),
    expiration: String(row.expiration),
    package_id: row.package_id != null ? String(row.package_id) : null,
    simultaneous_use: Number(row.simultaneous_use ?? 1),
    active: Number(row.active ?? 1),
    revoked: Number(row.revoked ?? 0),
    total_limit_mb: Number(row.total_limit_mb ?? 0),
    download_limit_mb: Number(row.download_limit_mb ?? 0),
    upload_limit_mb: Number(row.upload_limit_mb ?? 0),
    online_time_limit: Number(row.online_time_limit ?? 0),
    lifecycle_status: String(row.lifecycle_status ?? "available"),
    terminate_reason: null,
  };
}

async function terminatePrepaidCard(
  pool: Pool,
  tenantId: string,
  row: CardLifecycleRow,
  reason: PrepaidDenyReason,
  coa: CoaService,
  radius: RadiusService
): Promise<{ disconnectOk: boolean; disconnectSummary: string }> {
  const username = String(row.cardnum);
  let report = null;
  try {
    report = await coa.disconnectAllSessions(username, tenantId);
    prepaidCardsDisconnectTotal.inc({ result: report.anyOk ? "ok" : "partial" });
    log.info(
      "prepaid_card_disconnect_sent",
      { tenant_id: tenantId, card_id: row.id, username, reason, summary: summarizeDisconnectReport(report) },
      "prepaid-lifecycle"
    );
  } catch (e) {
    prepaidCardsDisconnectTotal.inc({ result: "error" });
    log.error(
      "prepaid_card_disconnect_failed",
      {
        tenant_id: tenantId,
        card_id: row.id,
        username,
        reason,
        error: e instanceof Error ? e.message : String(e),
      },
      "prepaid-lifecycle"
    );
  }

  await closeDisconnectedRadacctSessions(pool, username, tenantId, report, `prepaid_${reason}`).catch((e) =>
    console.error("[prepaid-lifecycle] radacct close failed", username, e)
  );

  try {
    if (reason === "quota_exceeded" || reason === "activation_window_expired" || reason === "consumed") {
      await radius.applyQuotaHardDeny(username);
    } else {
      await radius.disableRadiusUser(username);
    }
    log.info(
      "prepaid_card_radius_disabled",
      { tenant_id: tenantId, card_id: row.id, username, reason },
      "prepaid-lifecycle"
    );
  } catch (e) {
    console.error("[prepaid-lifecycle] radius deny failed", username, e);
  }

  const lifecycle = lifecycleStatusForTerminateReason(reason);
  const disconnectSummary = summarizeDisconnectReport(report);
  const nowSql = new Date();

  await pool.execute(
    `UPDATE rm_cards
     SET lifecycle_status = ?,
         active = 0,
         terminate_reason = ?,
         finished_at = COALESCE(finished_at, NOW()),
         expired_at = CASE WHEN ? IN ('calendar_expired', 'expired') THEN COALESCE(expired_at, NOW()) ELSE expired_at END,
         last_disconnect_status = ?
     WHERE id = ? AND tenant_id = ?`,
    [lifecycle, reason, reason, disconnectSummary.slice(0, 255), row.id, tenantId]
  );

  const updated = { ...row, lifecycle_status: lifecycle, active: 0, terminate_reason: reason };
  await syncRmCardToRadius(pool, rowToRadiusSync(updated as CardLifecycleRow)).catch((e) =>
    console.error("[prepaid-lifecycle] radius sync after terminate failed", username, e)
  );

  await writeAuditLog(pool, {
    tenantId,
    action: `prepaid_card_${reason}`,
    entityType: "rm_card",
    entityId: String(row.id),
    payload: { cardnum: username, disconnect: disconnectSummary },
  });

  void nowSql;
  return { disconnectOk: Boolean(report?.anyOk), disconnectSummary };
}

export async function runPrepaidCardLifecycleCycle(opts: {
  pool: Pool;
  tenantId: string;
  coa: CoaService;
  radius: RadiusService;
}): Promise<PrepaidLifecycleSummary> {
  const { pool, tenantId, coa, radius } = opts;
  const summary: PrepaidLifecycleSummary = {
    usage_refreshed: 0,
    expired: 0,
    quota_exceeded: 0,
    time_exceeded: 0,
    disconnect_sent: 0,
    disconnect_failed: 0,
  };

  if (!(await hasTable(pool, "rm_cards"))) return summary;

  summary.usage_refreshed = await refreshPrepaidCardsUsageFromRadacct(pool, tenantId);

  const hasLifecycle = await hasColumn(pool, "rm_cards", "lifecycle_status");
  const lifecycleFilter = hasLifecycle
    ? `c.lifecycle_status IN ('available', 'active')`
    : `c.active = 1 AND c.revoked = 0`;

  const [candidates] = await pool.query<CardLifecycleRow[]>(
    `SELECT c.*
     FROM rm_cards c
     WHERE c.tenant_id = ?
       AND c.active = 1
       AND c.revoked = 0
       AND ${lifecycleFilter}
     ORDER BY c.id ASC
     LIMIT ${PREPAID_BATCH}`,
    [tenantId]
  );

  for (const row of candidates) {
    const access = evaluatePrepaidCardAccessFromRow({
      lifecycle_status: row.lifecycle_status,
      active: row.active,
      revoked: row.revoked,
      expiration: row.expiration,
      total_limit_mb: row.total_limit_mb,
      used_bytes: row.used_bytes,
      used_seconds: row.used_seconds,
      online_time_limit: row.online_time_limit,
      available_time_from_activation: row.available_time_from_activation,
      first_used_at: row.first_used_at,
    });
    if (access.ok) continue;

    const { disconnectOk } = await terminatePrepaidCard(pool, tenantId, row, access.reason, coa, radius);
    if (disconnectOk) summary.disconnect_sent += 1;
    else summary.disconnect_failed += 1;

    switch (access.reason) {
      case "calendar_expired":
      case "expired":
        summary.expired += 1;
        prepaidCardsExpiredTotal.inc();
        log.info("prepaid_card_expired", { cardnum: row.cardnum, reason: access.reason }, "prepaid-lifecycle");
        break;
      case "quota_exceeded":
      case "consumed":
        summary.quota_exceeded += 1;
        prepaidCardsQuotaExceededTotal.inc();
        log.info("prepaid_card_quota_exceeded", { cardnum: row.cardnum }, "prepaid-lifecycle");
        break;
      case "online_time_exceeded":
      case "activation_window_expired":
        summary.time_exceeded += 1;
        prepaidCardsTimeExceededTotal.inc();
        log.info("prepaid_card_time_exceeded", { cardnum: row.cardnum, reason: access.reason }, "prepaid-lifecycle");
        break;
      default:
        break;
    }
  }

  await closeStalePrepaidCardRadacct(pool, tenantId).catch((e) =>
    console.warn("[prepaid-lifecycle] stale radacct close failed", e)
  );

  return summary;
}

async function closeStalePrepaidCardRadacct(pool: Pool, tenantId: string): Promise<number> {
  if (!(await hasTable(pool, "radacct")) || !(await hasTable(pool, "rm_cards"))) return 0;
  if (!(await hasColumn(pool, "rm_cards", "lifecycle_status"))) return 0;
  const [result] = await pool.query(
    `UPDATE radacct r
     INNER JOIN rm_cards c ON c.cardnum = r.username AND c.tenant_id = ?
     SET r.acctstoptime = NOW(),
         r.acctsessiontime = GREATEST(0, TIMESTAMPDIFF(SECOND, r.acctstarttime, NOW())),
         r.acctterminatecause = CASE
           WHEN COALESCE(r.acctterminatecause, '') = '' THEN 'Admin-Reset'
           ELSE r.acctterminatecause
         END
     WHERE r.acctstoptime IS NULL
       AND c.lifecycle_status IN ('expired', 'consumed', 'disabled')
     LIMIT ${PREPAID_BATCH}`,
    [tenantId]
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

/** Manual admin cleanup: terminate calendar-expired cards (does not DELETE rows). */
export async function terminateExpiredPrepaidCardsManual(
  pool: Pool,
  tenantId: string,
  coa: CoaService,
  radius: RadiusService
): Promise<number> {
  const [rows] = await pool.query<CardLifecycleRow[]>(
    `SELECT c.* FROM rm_cards c
     WHERE c.tenant_id = ?
       AND c.expiration < CURDATE()
       AND c.lifecycle_status IN ('available', 'active')
       AND c.active = 1 AND c.revoked = 0
     LIMIT ${PREPAID_BATCH}`,
    [tenantId]
  );
  let n = 0;
  for (const row of rows) {
    await terminatePrepaidCard(pool, tenantId, row, "calendar_expired", coa, radius);
    prepaidCardsExpiredTotal.inc();
    n += 1;
  }
  return n;
}
