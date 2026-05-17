import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns } from "../../db/schemaGuards.js";
import { listRouterHealthSnapshots } from "./router-health-collector.service.js";
import { buildScheduledStatusMessages } from "./infrastructure-status-report-build.service.js";
import { getWhatsAppStatus, sendOperationalAlertWhatsApp } from "../whatsapp.service.js";
import { log } from "../logger.service.js";

async function dispatchWhatsAppStatusReport(
  pool: Pool,
  tenantId: string,
  freshCollect: boolean
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const wa = await getWhatsAppStatus(tenantId);
  if (!wa.enabled || !wa.configured) {
    return { ok: false, error: "whatsapp_not_configured", detail: "فعّل WhatsApp من صفحة الاتصال" };
  }
  if (!wa.connected) {
    return {
      ok: false,
      error: "whatsapp_not_connected",
      detail: wa.last_error ?? "امسح QR وأكمل الربط",
    };
  }

  const { messages } = await buildScheduledStatusMessages(pool, tenantId, freshCollect);

  for (const body of messages) {
    const send = await sendOperationalAlertWhatsApp(tenantId, null, body, {
      preferSessionOwner: true,
      skipMessageInterval: true,
    });
    if (!send.sent) {
      return { ok: false, error: "whatsapp_send_failed", detail: send.reason };
    }
  }

  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (col.has("whatsapp_last_status_report_at")) {
    await pool.execute(
      `UPDATE infrastructure_monitoring_settings SET whatsapp_last_status_report_at = NOW(3) WHERE tenant_id = ?`,
      [tenantId]
    );
  }
  return { ok: true };
}

const SNAPSHOT_MAX_AGE_MS = 3 * 60_000;

async function shouldFreshCollectForReport(pool: Pool, tenantId: string): Promise<boolean> {
  const routers = await listRouterHealthSnapshots(pool, tenantId);
  if (routers.length === 0) return true;
  let newest = 0;
  for (const r of routers) {
    const raw = r.last_sync_at ?? r.last_seen_at;
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest === 0 || Date.now() - newest > SNAPSHOT_MAX_AGE_MS;
}

export async function maybeSendWhatsAppStatusReport(
  pool: Pool,
  tenantId: string,
  options: { freshCollect?: boolean } = {}
): Promise<boolean> {
  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (!col.has("whatsapp_status_interval_minutes")) return false;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT whatsapp_status_reports_enabled, whatsapp_status_interval_minutes, whatsapp_last_status_report_at
     FROM infrastructure_monitoring_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  const r = rows[0];
  if (!r || !Boolean(r.whatsapp_status_reports_enabled ?? 1)) return false;

  const intervalMin = Math.max(1, Math.min(1440, Number(r.whatsapp_status_interval_minutes ?? 5)));
  const lastAt = r.whatsapp_last_status_report_at ? new Date(String(r.whatsapp_last_status_report_at)) : null;
  const elapsedMs = lastAt ? Date.now() - lastAt.getTime() : Infinity;
  const dueMs = intervalMin * 60_000;
  if (elapsedMs < dueMs) return false;

  const wa = await getWhatsAppStatus(tenantId);
  if (!wa.enabled || !wa.configured || !wa.connected) {
    log.warn(
      `whatsapp_status_report_skip_wa_offline tenant=${tenantId} enabled=${wa.enabled} connected=${wa.connected}`,
      {},
      "whatsapp"
    );
    return false;
  }

  const freshCollect =
    options.freshCollect ?? (await shouldFreshCollectForReport(pool, tenantId));
  const result = await dispatchWhatsAppStatusReport(pool, tenantId, freshCollect);
  if (!result.ok) {
    log.warn(`whatsapp_status_report_failed tenant=${tenantId} ${result.detail}`, {}, "whatsapp");
    return false;
  }
  log.info(`whatsapp_status_report_sent tenant=${tenantId}`, {}, "whatsapp");
  return true;
}

export async function runWhatsAppStatusReportsDue(
  pool: Pool
): Promise<{ checked: number; sent: number }> {
  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (!col.has("whatsapp_status_interval_minutes")) return { checked: 0, sent: 0 };

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT tenant_id FROM infrastructure_monitoring_settings
     WHERE COALESCE(whatsapp_status_reports_enabled, 0) = 1`
  );

  let sent = 0;
  for (const row of rows) {
    const tenantId = String(row.tenant_id);
    try {
      if (await maybeSendWhatsAppStatusReport(pool, tenantId)) sent += 1;
    } catch (err) {
      log.warn(`whatsapp_status_report_tick_failed tenant=${tenantId} ${String(err)}`, {}, "whatsapp");
    }
  }
  return { checked: rows.length, sent };
}

export async function sendWhatsAppStatusReportNow(
  pool: Pool,
  tenantId: string
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  return dispatchWhatsAppStatusReport(pool, tenantId, true);
}
