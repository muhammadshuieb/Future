import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { createRedisClient, listenRedisErrors } from "../lib/redis-connection.js";
import { AccountingService } from "../services/accounting.service.js";
import { computeQoeScore, nasOverloadFromPoorCounts } from "../services/qoe-score.service.js";
import {
  radiusAuthAcceptTotal,
  radiusAuthRejectTotal,
  radiusAccountingUpdatesTotal,
} from "../services/metrics.service.js";

let lastRadpostauthWatermark: number | null = null;

const publisher = createRedisClient("enterprise-analytics-publish");
listenRedisErrors(publisher, "enterprise-analytics");

async function publish(tenantId: string, type: string, payload: Record<string, unknown>) {
  try {
    await publisher.publish(
      config.eventsChannel,
      JSON.stringify({ type, tenant_id: tenantId, tenantId, ...payload })
    );
  } catch {
    /* ignore */
  }
}

export async function runQoeCycle(pool: Pool, tenantId: string): Promise<void> {
  if (!(await hasTable(pool, "subscriber_qoe_samples"))) return;
  const [subs] = await pool.query<RowDataPacket[]>(
    `SELECT id, username FROM subscribers WHERE tenant_id = ? AND status = 'active' LIMIT 500`,
    [tenantId]
  );
  for (const s of subs) {
    const username = String(s.username);
    const sid = String(s.id);
    const [sessStats] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS sessions,
              COALESCE(AVG(acctsessiontime), 0) AS avg_sec
       FROM radacct
       WHERE username = ? AND acctstarttime >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      [username]
    );
    let failedAuth = 0;
    if (await hasTable(pool, "radpostauth")) {
      const [authStats] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS fails
         FROM radpostauth
         WHERE username = ? AND reply <> 'Access-Accept' AND authdate >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
        [username]
      );
      failedAuth = Number(authStats[0]?.fails ?? 0);
    }
    const reconnects = Number(sessStats[0]?.sessions ?? 0);
    const avgSessionSec = Number(sessStats[0]?.avg_sec ?? 0);
    const qoe = computeQoeScore({
      packetLossPct: 0,
      jitterMs: 0,
      latencyMs: 0,
      reconnectsPerDay: reconnects,
      failedAuthPerDay: failedAuth,
      avgSessionSec,
      bandwidthSaturationPct: 0,
    });
    await pool.execute(
      `INSERT INTO subscriber_qoe_samples
        (tenant_id, subscriber_id, sampled_at, latency_ms, jitter_ms, packet_loss_pct, reconnect_count, failed_auth_count, avg_session_sec, bandwidth_saturation_pct, disconnect_count, meta)
       VALUES (?, ?, NOW(3), NULL, NULL, NULL, ?, ?, ?, NULL, 0, NULL)`,
      [tenantId, sid, reconnects, failedAuth, avgSessionSec]
    );
    const mid = randomUUID();
    await pool.execute(
      `INSERT INTO subscriber_qoe_metrics (id, tenant_id, subscriber_id, score, status, reasons_json, recommendations_json, computed_at)
       VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), NOW(3))`,
      [
        mid,
        tenantId,
        sid,
        qoe.score,
        qoe.status,
        JSON.stringify(qoe.reasons),
        JSON.stringify(qoe.recommendations),
      ]
    );
    if (qoe.status === "red") {
      const aid = randomUUID();
      await pool.execute(
        `INSERT INTO subscriber_qoe_alerts (id, tenant_id, subscriber_id, severity, title, body, status)
         VALUES (?, ?, ?, 'warning', ?, ?, 'open')`,
        [aid, tenantId, sid, `QoE degraded: ${username}`, qoe.reasons.join("; ").slice(0, 2000)]
      );
      await publish(tenantId, "qoe.alert", { subscriber_id: sid, score: qoe.score });
    }
  }

  if (await hasTable(pool, "nas_devices")) {
    const [nasRows] = await pool.query<RowDataPacket[]>(
      `SELECT n.id, n.session_count,
              SUM(CASE WHEN COALESCE(m.score, 100) < 70 THEN 1 ELSE 0 END) AS poor
       FROM nas_devices n
       LEFT JOIN subscribers s ON s.nas_server_id = n.id AND s.tenant_id = n.tenant_id
       LEFT JOIN (
         SELECT subscriber_id, score FROM subscriber_qoe_metrics
         WHERE tenant_id = ? AND computed_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
       ) m ON m.subscriber_id = s.id
       WHERE n.tenant_id = ?
       GROUP BY n.id, n.session_count`,
      [tenantId, tenantId]
    );
    for (const n of nasRows) {
      const active = Number(n.session_count ?? 0);
      const poor = Number(n.poor ?? 0);
      const overloaded = nasOverloadFromPoorCounts(active, poor);
      const score = overloaded ? 40 : Math.max(50, 100 - poor * 5);
      await pool.execute(
        `INSERT INTO nas_qoe_scores (id, tenant_id, nas_device_id, score, status, active_sessions, poor_subscriber_count, computed_at, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), CAST(? AS JSON))`,
        [
          randomUUID(),
          tenantId,
          String(n.id),
          score,
          overloaded ? "red" : "green",
          active,
          poor,
          JSON.stringify({ overloaded }),
        ]
      );
    }
  }
}

export async function runRadiusMonitorCycle(pool: Pool, tenantId: string): Promise<void> {
  if (await hasTable(pool, "radpostauth")) {
    if (lastRadpostauthWatermark === null) {
      const [wm] = await pool.query<RowDataPacket[]>(`SELECT COALESCE(MAX(id), 0) AS m FROM radpostauth`);
      lastRadpostauthWatermark = Number(wm[0]?.m ?? 0);
    } else {
      const [delta] = await pool.query<RowDataPacket[]>(
        `SELECT id, reply FROM radpostauth WHERE id > ? ORDER BY id ASC LIMIT 8000`,
        [lastRadpostauthWatermark]
      );
      for (const row of delta) {
        const id = Number(row.id ?? 0);
        if (id > lastRadpostauthWatermark) lastRadpostauthWatermark = id;
        if (String(row.reply ?? "") === "Access-Accept") radiusAuthAcceptTotal.inc();
        else radiusAuthRejectTotal.inc();
      }
    }
  }

  if (await hasTable(pool, "radacct")) {
    const hasUpdate = await hasColumn(pool, "radacct", "acctupdatetime");
    if (hasUpdate) {
      const [acctRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM radacct
         WHERE acctupdatetime IS NOT NULL AND acctupdatetime >= DATE_SUB(NOW(), INTERVAL 75 SECOND)`
      );
      const c = Number(acctRows[0]?.c ?? 0);
      if (c > 0) radiusAccountingUpdatesTotal.inc(c);
    }
  }

  if (!(await hasTable(pool, "radius_metrics_snapshots"))) return;
  const bucket = new Date();
  bucket.setSeconds(0, 0);
  const bucketStr = bucket.toISOString().slice(0, 19).replace("T", " ");

  let authAccept = 0;
  let authReject = 0;
  if (await hasTable(pool, "radpostauth")) {
    const [a] = await pool.query<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN reply = 'Access-Accept' THEN 1 ELSE 0 END) AS okc,
         SUM(CASE WHEN reply <> 'Access-Accept' THEN 1 ELSE 0 END) AS bad
       FROM radpostauth
       WHERE authdate >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)`
    );
    authAccept = Number(a[0]?.okc ?? 0);
    authReject = Number(a[0]?.bad ?? 0);
  }

  const acct = new AccountingService(pool);
  const activeSessions = await acct.countActiveSessions(tenantId);

  const id = randomUUID();
  await pool.execute(
    `INSERT INTO radius_metrics_snapshots
      (id, tenant_id, bucket_start, auth_accept, auth_reject, acct_start, acct_stop, acct_interim, active_sessions, coa_success, coa_failure, avg_acct_delay_ms, nas_load_json, top_reject_users_json, top_reject_nas_json)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, 0, 0, NULL, NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       auth_accept = VALUES(auth_accept),
       auth_reject = VALUES(auth_reject),
       active_sessions = VALUES(active_sessions)`,
    [id, tenantId, bucketStr, authAccept, authReject, activeSessions]
  );

  if (await hasTable(pool, "radpostauth")) {
    const [batch] = await pool.query<RowDataPacket[]>(
      `SELECT username, reply, authdate
       FROM radpostauth
       WHERE authdate >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
       ORDER BY authdate DESC
       LIMIT 25`
    );
    if (await hasTable(pool, "radius_auth_events")) {
      for (const b of batch) {
        await pool.execute(
          `INSERT INTO radius_auth_events (tenant_id, event_time, nas_ip, username, reply, reject_reason)
           VALUES (?, ?, NULL, ?, ?, ?)`,
          [
            tenantId,
            b.authdate,
            String(b.username ?? ""),
            String(b.reply ?? ""),
            String(b.reply ?? "") === "Access-Accept" ? null : "reject",
          ]
        );
      }
    }
  }

  const rejectRatio = authAccept + authReject > 0 ? authReject / (authAccept + authReject) : 0;
  if (rejectRatio > 0.35 && authAccept + authReject > 20) {
    const aid = randomUUID();
    await pool.execute(
      `INSERT INTO radius_monitor_alerts (id, tenant_id, severity, title, body, status)
       VALUES (?, ?, 'warning', 'High RADIUS reject ratio', ?, 'open')`,
      [aid, tenantId, `reject_ratio=${rejectRatio.toFixed(2)} in last minute`]
    );
    await publish(tenantId, "radius_monitor.alert", { reject_ratio: rejectRatio });
  }

  await publish(tenantId, "radius_monitor.snapshot", {
    bucket_start: bucketStr,
    auth_accept: authAccept,
    auth_reject: authReject,
    active_sessions: activeSessions,
  });
}

export async function recordCoaEvent(
  pool: Pool,
  tenantId: string,
  nasIp: string,
  username: string,
  ok: boolean,
  message: string
): Promise<void> {
  if (!(await hasTable(pool, "radius_coa_events"))) return;
  await pool.execute(
    `INSERT INTO radius_coa_events (tenant_id, event_time, nas_ip, username, ok, message)
     VALUES (?, NOW(3), ?, ?, ?, ?)`,
    [tenantId, nasIp, username, ok ? 1 : 0, message.slice(0, 250)]
  );
}
