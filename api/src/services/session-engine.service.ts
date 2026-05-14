import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasColumn, hasTable } from "../db/schemaGuards.js";

const STALE_MIN = () =>
  Math.max(5, Math.min(24 * 60, Number.parseInt(process.env.STALE_SESSION_MINUTES ?? "15", 10) || 15));

/**
 * Derives `sessions.session_state` from `radacct` (DB remains source of truth).
 * States: ONLINE (open + fresh heartbeat), STUCK (open + stale), OFFLINE (closed),
 * EXPIRED / DISCONNECT_PENDING / COA_PENDING / FAILED reserved for app workflow extensions.
 */
export async function reconcileSubscriberSessions(pool: Pool, tenantId: string): Promise<void> {
  if (!(await hasTable(pool, "sessions"))) return;
  if (!(await hasTable(pool, "radacct"))) return;
  if (!(await hasTable(pool, "subscribers"))) return;
  if (!(await hasColumn(pool, "sessions", "session_state"))) return;

  const staleM = STALE_MIN();
  const hasAcctUpdate = await hasColumn(pool, "radacct", "acctupdatetime");
  const heartbeat = hasAcctUpdate ? "COALESCE(r.acctupdatetime, r.acctstarttime)" : "r.acctstarttime";

  const [openRows] = await pool.query<RowDataPacket[]>(
    `SELECT r.radacctid, r.username, r.acctsessionid, r.nasipaddress, r.acctstarttime, r.acctstoptime,
            r.acctinputoctets, r.acctoutputoctets, r.acctterminatecause,
            s.id AS subscriber_id, s.tenant_id,
            CASE
              WHEN ${heartbeat} < DATE_SUB(NOW(), INTERVAL ${staleM} MINUTE) THEN 'STUCK'
              ELSE 'ONLINE'
            END AS next_state
     FROM radacct r
     INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
     WHERE r.acctstoptime IS NULL`,
    [tenantId]
  );

  for (const row of openRows) {
    const state = String(row.next_state ?? "OFFLINE");
    const username = String(row.username ?? "");
    const acctSessionId = String(row.acctsessionid ?? "");
    if (!username || !acctSessionId) continue;

    await pool.execute(
      `INSERT INTO sessions
        (tenant_id, subscriber_id, username, acctsessionid, nas_ip, started_at, stopped_at,
         input_octets, output_octets, session_state, radacct_radacctid, terminate_cause, last_reconcile_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         tenant_id = VALUES(tenant_id),
         subscriber_id = VALUES(subscriber_id),
         nas_ip = VALUES(nas_ip),
         started_at = VALUES(started_at),
         stopped_at = VALUES(stopped_at),
         input_octets = VALUES(input_octets),
         output_octets = VALUES(output_octets),
         session_state = VALUES(session_state),
         radacct_radacctid = VALUES(radacct_radacctid),
         terminate_cause = VALUES(terminate_cause),
         last_reconcile_at = NOW(3)`,
      [
        row.tenant_id,
        row.subscriber_id,
        username,
        acctSessionId,
        row.nasipaddress ?? null,
        row.acctstarttime ?? null,
        row.acctstoptime ?? null,
        Number(row.acctinputoctets ?? 0),
        Number(row.acctoutputoctets ?? 0),
        state,
        Number(row.radacctid ?? 0) || null,
        row.acctterminatecause ? String(row.acctterminatecause).slice(0, 64) : null,
      ]
    );
  }

  await pool.execute(
    `UPDATE sessions sess
     INNER JOIN subscribers s ON s.id = sess.subscriber_id AND s.tenant_id = ?
     LEFT JOIN radacct r ON r.username = sess.username
       AND r.acctsessionid = sess.acctsessionid
       AND r.acctstoptime IS NULL
     SET sess.session_state = 'OFFLINE',
         sess.stopped_at = COALESCE(sess.stopped_at, NOW()),
         sess.last_reconcile_at = NOW(3)
     WHERE sess.session_state IN ('ONLINE', 'STUCK', 'COA_PENDING', 'DISCONNECT_PENDING')
       AND r.radacctid IS NULL`,
    [tenantId]
  );
}
