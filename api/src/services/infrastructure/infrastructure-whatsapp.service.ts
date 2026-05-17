import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../../db/schemaGuards.js";
import {
  getWhatsAppStatus,
  resolveWhatsAppSessionOwnerPhone,
  sendOperationalAlertWhatsApp,
} from "../whatsapp.service.js";
import { log } from "../logger.service.js";

export type WhatsAppInfraConfigPublic = {
  connected: boolean;
  configured: boolean;
  session_owner_phone: string | null;
  instant_alerts_enabled: boolean;
  critical_only: boolean;
  status_reports_enabled: boolean;
  status_interval_minutes: number;
  last_status_report_at: string | null;
  last_test_ok: boolean | null;
  last_error: string | null;
};

export type WhatsAppInfraConfigSave = {
  instant_alerts_enabled?: boolean;
  critical_only?: boolean;
  status_reports_enabled?: boolean;
  status_interval_minutes?: number;
};

export async function getWhatsAppInfraConfig(
  pool: Pool,
  tenantId: string
): Promise<WhatsAppInfraConfigPublic> {
  const empty: WhatsAppInfraConfigPublic = {
    connected: false,
    configured: false,
    session_owner_phone: null,
    instant_alerts_enabled: true,
    critical_only: false,
    status_reports_enabled: true,
    status_interval_minutes: 5,
    last_status_report_at: null,
    last_test_ok: null,
    last_error: null,
  };
  if (!(await hasTable(pool, "infrastructure_monitoring_settings"))) return empty;

  const waStatus = await getWhatsAppStatus(tenantId);
  const ownerPhone = await resolveWhatsAppSessionOwnerPhone(tenantId).catch(() => null);

  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (!col.has("whatsapp_alerts_enabled")) {
    return {
      ...empty,
      connected: waStatus.connected,
      configured: waStatus.configured,
      session_owner_phone: ownerPhone,
    };
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT whatsapp_alerts_enabled, whatsapp_critical_only,
            whatsapp_status_reports_enabled, whatsapp_status_interval_minutes,
            whatsapp_last_status_report_at
     FROM infrastructure_monitoring_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  const r = rows[0];

  return {
    connected: waStatus.connected,
    configured: waStatus.configured,
    session_owner_phone: ownerPhone,
    instant_alerts_enabled: Boolean(r?.whatsapp_alerts_enabled ?? 1),
    critical_only: Boolean(r?.whatsapp_critical_only ?? 0),
    status_reports_enabled: col.has("whatsapp_status_reports_enabled")
      ? Boolean(r?.whatsapp_status_reports_enabled ?? 1)
      : true,
    status_interval_minutes: col.has("whatsapp_status_interval_minutes")
      ? Math.max(1, Math.min(1440, Number(r?.whatsapp_status_interval_minutes ?? 5)))
      : 5,
    last_status_report_at:
      col.has("whatsapp_last_status_report_at") && r?.whatsapp_last_status_report_at
        ? new Date(String(r.whatsapp_last_status_report_at)).toISOString()
        : null,
    last_test_ok: null,
    last_error: waStatus.connected ? null : (waStatus.last_error ?? "whatsapp_not_connected"),
  };
}

export async function saveWhatsAppInfraConfig(
  pool: Pool,
  tenantId: string,
  input: WhatsAppInfraConfigSave
): Promise<WhatsAppInfraConfigPublic> {
  await pool.execute(
    `INSERT INTO infrastructure_monitoring_settings (tenant_id) VALUES (?) ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [tenantId]
  );

  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (!col.has("whatsapp_alerts_enabled")) {
    throw new Error("whatsapp_schema_missing");
  }

  const instantEnabled = input.instant_alerts_enabled ?? true;
  const criticalOnly = input.critical_only ?? false;
  const statusEnabled = input.status_reports_enabled ?? true;
  const statusInterval = Math.max(1, Math.min(1440, Number(input.status_interval_minutes ?? 5)));

  const sets = [
    "whatsapp_alerts_enabled = ?",
    "whatsapp_critical_only = ?",
    "infrastructure_alerts_enabled = 1",
  ];
  const vals: (string | number)[] = [instantEnabled ? 1 : 0, criticalOnly ? 1 : 0];

  if (col.has("whatsapp_status_reports_enabled")) {
    sets.push("whatsapp_status_reports_enabled = ?", "whatsapp_status_interval_minutes = ?");
    vals.push(statusEnabled ? 1 : 0, statusInterval);
  }

  vals.push(tenantId);
  await pool.execute(
    `UPDATE infrastructure_monitoring_settings SET ${sets.join(", ")} WHERE tenant_id = ?`,
    vals
  );

  if (col.has("whatsapp_last_status_report_at") && statusEnabled) {
    await pool.execute(
      `UPDATE infrastructure_monitoring_settings SET whatsapp_last_status_report_at = NULL WHERE tenant_id = ?`,
      [tenantId]
    );
  }

  const confirmation = await sendWhatsAppSaveConfirmation(pool, tenantId, statusInterval, statusEnabled);

  if (statusEnabled && col.has("whatsapp_status_interval_minutes")) {
    const { maybeSendWhatsAppStatusReport } = await import(
      "./infrastructure-whatsapp-status-report.service.js"
    );
    void maybeSendWhatsAppStatusReport(pool, tenantId, { freshCollect: true }).catch((e) => {
      log.warn(`whatsapp_first_report_after_save ${String(e)}`, {}, "whatsapp");
    });
  }

  return confirmation;
}

export async function sendWhatsAppSaveConfirmation(
  pool: Pool,
  tenantId: string,
  intervalMinutes: number,
  statusReportsEnabled: boolean
): Promise<WhatsAppInfraConfigPublic> {
  const ownerPhone = await resolveWhatsAppSessionOwnerPhone(tenantId).catch(() => null);
  const lines = [
    "✅ تم حفظ إعدادات WhatsApp للمراقبة",
    "",
    ownerPhone ? `📱 الإرسال إلى: ${ownerPhone}` : "📱 الإرسال إلى رقم الواتساب المربوط",
    "",
    statusReportsEnabled
      ? `📊 تقارير السيرفر والراوترات: تلقائياً كل ${intervalMinutes} دقيقة.`
      : "📊 التقارير الدورية: غير مفعّلة.",
    "⚠️ تنبيهات فورية: جهد، CPU، RAM، قرص — عند تجاوز العتبات.",
    "",
    statusReportsEnabled
      ? `أول تقرير تلقائي خلال ${intervalMinutes} دقيقة (أو أقل).`
      : "فعّل «التقارير الدورية» لاستلام تقارير مجدولة.",
  ];

  const send = await sendOperationalAlertWhatsApp(tenantId, null, lines.join("\n"), {
    preferSessionOwner: true,
  });

  const config = await getWhatsAppInfraConfig(pool, tenantId);
  return {
    ...config,
    last_test_ok: send.sent,
    last_error: send.sent ? null : (send.reason ?? "send_failed"),
  };
}

export async function testWhatsAppInfraConnection(
  pool: Pool,
  tenantId: string
): Promise<{ ok: boolean; config: WhatsAppInfraConfigPublic }> {
  const { formatAlertWhatsAppMessage } = await import("./infrastructure-whatsapp-notify.service.js");
  const sample = formatAlertWhatsAppMessage(
    {
      alert_type: "low_voltage",
      severity: "critical",
      nas_device_id: null,
      nas_name: "Router-1",
      title: "انخفاض الجهد — Router-1 (اختبار)",
      message: "الجهد 10.5V أقل من 11.5V — رسالة اختبار للتنسيق",
      metric_value: "10.5",
      threshold_value: "11.5",
      fingerprint: "test",
    },
    {
      nas_device_id: "test",
      tenant_id: tenantId,
      nas_name: "Router-1",
      nas_ip: "192.168.88.1",
      health_status: "online",
      cpu_percent: 45,
      ram_percent: 60,
      board_temperature_c: 42,
      voltage_v: 10.5,
      voltage_supported: true,
      uptime_seconds: 86400,
      ppp_active_sessions: 12,
      hotspot_active_sessions: 0,
      interfaces_down: 0,
      traffic_rx_bps: null,
      traffic_tx_bps: null,
      traffic_rx_mb: null,
      traffic_tx_mb: null,
      traffic_rx_mbps: null,
      traffic_tx_mbps: null,
      traffic_monitor_interface: null,
      internet_reachable: true,
      last_sync_ok: true,
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
      last_seen_at: null,
    },
    null
  );
  const send = await sendOperationalAlertWhatsApp(tenantId, null, sample, { preferSessionOwner: true });
  const config = await getWhatsAppInfraConfig(pool, tenantId);
  return {
    ok: send.sent,
    config: {
      ...config,
      last_test_ok: send.sent,
      last_error: send.sent ? null : (send.reason ?? "test_failed"),
    },
  };
}
