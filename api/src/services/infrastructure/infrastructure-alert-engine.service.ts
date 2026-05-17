import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasTable } from "../../db/schemaGuards.js";
import { getBackupAlert } from "../backup.service.js";
import { getWhatsAppStatus } from "../whatsapp.service.js";
import type {
  AlertSeverity,
  AlertStatus,
  InfrastructureAlertType,
  RouterHealthSnapshot,
  ThresholdConfig,
} from "./infrastructure-types.js";
import { getNasThresholds } from "./infrastructure-thresholds.service.js";
import { getMonitoringSettings } from "./infrastructure-settings.service.js";
import type { MonitoringSettings } from "./infrastructure-types.js";
import type { ServerHealthSnapshot } from "./server-health-collector.service.js";
import {
  dispatchInfrastructureWhatsApp,
  formatAlertWhatsAppMessage,
  formatRecoveryWhatsAppMessage,
} from "./infrastructure-whatsapp-notify.service.js";
import {
  dispatchInfrastructureTelegram,
  formatAlertTelegramMessage,
  formatRecoveryTelegramMessage,
} from "./infrastructure-telegram-notify.service.js";

export type EvaluatedAlert = {
  alert_type: InfrastructureAlertType;
  severity: AlertSeverity;
  nas_device_id: string | null;
  nas_name: string | null;
  title: string;
  message: string;
  metric_value: string | null;
  threshold_value: string | null;
  fingerprint: string;
};

function fp(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join("|").slice(0, 190);
}

export function evaluateRouterAlerts(
  snap: RouterHealthSnapshot,
  prev: RouterHealthSnapshot | null,
  thresholds: ThresholdConfig,
  settings: MonitoringSettings
): EvaluatedAlert[] {
  const alerts: EvaluatedAlert[] = [];
  const name = snap.nas_name || snap.nas_ip;

  if (!snap.last_sync_ok) {
    alerts.push({
      alert_type: "router_offline",
      severity: "critical",
      nas_device_id: snap.nas_device_id,
      nas_name: name,
      title: `الراوتر ${name} غير متصل`,
      message: snap.last_sync_error ?? "فشل الاتصال بـ RouterOS API",
      metric_value: null,
      threshold_value: String(settings.router_offline_minutes),
      fingerprint: fp([snap.tenant_id, snap.nas_device_id, "router_offline"]),
    });
    return alerts;
  }

  if (snap.cpu_percent != null && snap.cpu_percent >= thresholds.cpu_percent_max) {
    alerts.push({
      alert_type: "high_cpu",
      severity: snap.cpu_percent >= thresholds.cpu_percent_max + 5 ? "critical" : "warning",
      nas_device_id: snap.nas_device_id,
      nas_name: name,
      title: `ارتفاع المعالج — ${name}`,
      message: `استخدام CPU: ${snap.cpu_percent}% (الحد ${thresholds.cpu_percent_max}%)`,
      metric_value: `${snap.cpu_percent}`,
      threshold_value: `${thresholds.cpu_percent_max}`,
      fingerprint: fp([snap.tenant_id, snap.nas_device_id, "high_cpu"]),
    });
  }

  if (snap.ram_percent != null && snap.ram_percent >= thresholds.ram_percent_max) {
    alerts.push({
      alert_type: "high_ram",
      severity: snap.ram_percent >= thresholds.ram_percent_max + 5 ? "critical" : "warning",
      nas_device_id: snap.nas_device_id,
      nas_name: name,
      title: `ارتفاع الذاكرة — ${name}`,
      message: `استخدام RAM: ${snap.ram_percent}% (الحد ${thresholds.ram_percent_max}%)`,
      metric_value: `${snap.ram_percent}`,
      threshold_value: `${thresholds.ram_percent_max}`,
      fingerprint: fp([snap.tenant_id, snap.nas_device_id, "high_ram"]),
    });
  }

  if (snap.board_temperature_c != null && snap.board_temperature_c >= thresholds.temperature_c_max) {
    alerts.push({
      alert_type: "high_temperature",
      severity: "critical",
      nas_device_id: snap.nas_device_id,
      nas_name: name,
      title: `ارتفاع حرارة — ${name}`,
      message: `الحرارة: ${snap.board_temperature_c}°C`,
      metric_value: `${snap.board_temperature_c}`,
      threshold_value: `${thresholds.temperature_c_max}`,
      fingerprint: fp([snap.tenant_id, snap.nas_device_id, "high_temperature"]),
    });
  }

  if (
    snap.voltage_supported &&
    snap.voltage_v != null &&
    thresholds.voltage_v_min != null &&
    snap.voltage_v < thresholds.voltage_v_min
  ) {
    alerts.push({
      alert_type: "low_voltage",
      severity: "critical",
      nas_device_id: snap.nas_device_id,
      nas_name: name,
      title: `انخفاض الجهد — ${name}`,
      message: `الجهد ${snap.voltage_v}V أقل من ${thresholds.voltage_v_min}V`,
      metric_value: `${snap.voltage_v}`,
      threshold_value: `${thresholds.voltage_v_min}`,
      fingerprint: fp([snap.tenant_id, snap.nas_device_id, "low_voltage"]),
    });
  }

  if (snap.interfaces_down > 0) {
    alerts.push({
      alert_type: "interface_down",
      severity: "warning",
      nas_device_id: snap.nas_device_id,
      nas_name: name,
      title: `واجهة متوقفة — ${name}`,
      message: `${snap.interfaces_down} واجهة غير تعمل`,
      metric_value: String(snap.interfaces_down),
      threshold_value: "1",
      fingerprint: fp([snap.tenant_id, snap.nas_device_id, "interface_down"]),
    });
  }

  if (prev && prev.ppp_active_sessions > 0 && snap.ppp_active_sessions >= 0) {
    const dropPct = ((prev.ppp_active_sessions - snap.ppp_active_sessions) / prev.ppp_active_sessions) * 100;
    if (dropPct >= thresholds.ppp_session_drop_percent) {
      alerts.push({
        alert_type: "ppp_session_drop",
        severity: "warning",
        nas_device_id: snap.nas_device_id,
        nas_name: name,
        title: `انخفاض جلسات PPP — ${name}`,
        message: `من ${prev.ppp_active_sessions} إلى ${snap.ppp_active_sessions} (${Math.round(dropPct)}%)`,
        metric_value: String(snap.ppp_active_sessions),
        threshold_value: String(thresholds.ppp_session_drop_percent),
        fingerprint: fp([snap.tenant_id, snap.nas_device_id, "ppp_session_drop"]),
      });
    }
  }

  return alerts;
}

export function evaluateServerAlerts(
  snap: ServerHealthSnapshot,
  thresholds: ThresholdConfig,
  tenantId: string
): EvaluatedAlert[] {
  const alerts: EvaluatedAlert[] = [];
  if (snap.health_status === "offline") {
    alerts.push({
      alert_type: "server_down",
      severity: "critical",
      nas_device_id: null,
      nas_name: null,
      title: "السيرفر — حالة حرجة",
      message: "فشل التحقق من خدمات أساسية (MySQL/Redis/Worker)",
      metric_value: snap.health_status,
      threshold_value: null,
      fingerprint: fp([tenantId, null, "server_down"]),
    });
  }
  if (snap.ram_percent != null && snap.ram_percent >= thresholds.server_ram_percent_max) {
    alerts.push({
      alert_type: "high_server_ram",
      severity: "warning",
      nas_device_id: null,
      nas_name: null,
      title: "ارتفاع ذاكرة السيرفر",
      message: `استخدام RAM: ${snap.ram_percent}% (الحد ${thresholds.server_ram_percent_max}%)`,
      metric_value: `${snap.ram_percent}`,
      threshold_value: `${thresholds.server_ram_percent_max}`,
      fingerprint: fp([tenantId, null, "high_server_ram"]),
    });
  }
  if (
    snap.cpu_load_1m != null &&
    snap.cpu_count != null &&
    snap.cpu_count > 0 &&
    snap.cpu_load_1m >= snap.cpu_count * thresholds.server_cpu_load_multiplier
  ) {
    alerts.push({
      alert_type: "high_server_cpu",
      severity: "warning",
      nas_device_id: null,
      nas_name: null,
      title: "ارتفاع معالج السيرفر",
      message: `حمل CPU: ${snap.cpu_load_1m} — أنوية: ${snap.cpu_count} (الحد ×${thresholds.server_cpu_load_multiplier})`,
      metric_value: `${snap.cpu_load_1m}`,
      threshold_value: `${thresholds.server_cpu_load_multiplier}x`,
      fingerprint: fp([tenantId, null, "high_server_cpu"]),
    });
  }
  if (snap.disk_percent != null && snap.disk_percent >= thresholds.disk_percent_max) {
    alerts.push({
      alert_type: "disk_almost_full",
      severity: "critical",
      nas_device_id: null,
      nas_name: null,
      title: "القرص ممتلئ تقريباً",
      message: `استخدام القرص: ${snap.disk_percent}% (الحد ${thresholds.disk_percent_max}%)`,
      metric_value: `${snap.disk_percent}`,
      threshold_value: `${thresholds.disk_percent_max}`,
      fingerprint: fp([tenantId, null, "disk_almost_full"]),
    });
  }
  if (snap.mysql_ok === false || snap.redis_ok === false || snap.worker_ok === false) {
    const down = [
      snap.mysql_ok === false ? "MySQL" : null,
      snap.redis_ok === false ? "Redis" : null,
      snap.worker_ok === false ? "Worker" : null,
    ]
      .filter(Boolean)
      .join(", ");
    alerts.push({
      alert_type: "service_down",
      severity: "critical",
      nas_device_id: null,
      nas_name: null,
      title: "خدمة متوقفة",
      message: down,
      metric_value: down,
      threshold_value: null,
      fingerprint: fp([tenantId, null, "service_down", down]),
    });
  }
  if (snap.freeradius_ok === false) {
    alerts.push({
      alert_type: "radius_down",
      severity: "critical",
      nas_device_id: null,
      nas_name: null,
      title: "RADIUS — لا محاسبة حديثة",
      message: "لم تُرصد جلسات محاسبة نشطة مؤخراً",
      metric_value: null,
      threshold_value: null,
      fingerprint: fp([tenantId, null, "radius_down"]),
    });
  }
  return alerts;
}

async function recordHistory(
  pool: Pool,
  alertId: string,
  tenantId: string,
  eventType: string,
  severity: string | null,
  message: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  if (!(await hasTable(pool, "infrastructure_alert_history"))) return;
  await pool.execute(
    `INSERT INTO infrastructure_alert_history (id, alert_id, tenant_id, event_type, severity, message, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), alertId, tenantId, eventType, severity, message, meta ? JSON.stringify(meta) : null]
  );
}

function canNotify(
  settings: MonitoringSettings,
  severity: AlertSeverity,
  lastNotifiedAt: Date | null
): boolean {
  if (!settings.infrastructure_alerts_enabled) return false;
  if (!lastNotifiedAt) return true;
  const cooldownMs = settings.alert_cooldown_minutes * 60_000;
  return Date.now() - lastNotifiedAt.getTime() >= cooldownMs;
}

function shouldNotifyWhatsApp(settings: MonitoringSettings, severity: AlertSeverity): boolean {
  if (!settings.whatsapp_alerts_enabled) return false;
  if (settings.whatsapp_critical_only && severity !== "critical") return false;
  return true;
}

function shouldNotifyTelegram(settings: MonitoringSettings): boolean {
  return settings.telegram_configured && settings.telegram_alerts_enabled;
}

async function dispatchAlertNotifications(
  pool: Pool,
  tenantId: string,
  severity: AlertSeverity,
  ev: EvaluatedAlert,
  snap: RouterHealthSnapshot | null | undefined,
  serverSnap: ServerHealthSnapshot | null | undefined,
  isRecovery: boolean,
  settings: MonitoringSettings
): Promise<boolean> {
  let anySent = false;
  if (!isRecovery && shouldNotifyWhatsApp(settings, severity)) {
    const body = formatAlertWhatsAppMessage(ev, snap, serverSnap);
    if (await dispatchInfrastructureWhatsApp(pool, tenantId, severity, body, false)) anySent = true;
  }
  if (isRecovery && settings.recovery_notifications_enabled && settings.whatsapp_alerts_enabled) {
    const body = formatRecoveryWhatsAppMessage(ev);
    if (await dispatchInfrastructureWhatsApp(pool, tenantId, "info", body, true)) anySent = true;
  }
  if (!isRecovery && shouldNotifyTelegram(settings)) {
    const body = formatAlertTelegramMessage(ev, snap, serverSnap);
    if (await dispatchInfrastructureTelegram(pool, tenantId, severity, body, false)) anySent = true;
  }
  if (isRecovery && settings.recovery_notifications_enabled && shouldNotifyTelegram(settings)) {
    const body = formatRecoveryTelegramMessage(ev);
    if (await dispatchInfrastructureTelegram(pool, tenantId, "info", body, true)) anySent = true;
  }
  return anySent;
}

export async function upsertInfrastructureAlerts(
  pool: Pool,
  tenantId: string,
  evaluated: EvaluatedAlert[],
  settings: MonitoringSettings,
  routerSnapsById: Map<string, RouterHealthSnapshot> = new Map(),
  serverSnap: ServerHealthSnapshot | null = null
): Promise<void> {
  if (!(await hasTable(pool, "infrastructure_alerts"))) return;

  const firingFps = new Set(evaluated.map((e) => e.fingerprint));
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM infrastructure_alerts WHERE tenant_id = ? AND status = 'firing'`,
    [tenantId]
  );

  for (const ev of evaluated) {
    const found = existing.find((r) => String(r.fingerprint) === ev.fingerprint);
    if (found) {
      const alertId = String(found.id);
      const lastNotified = found.last_notified_at ? new Date(String(found.last_notified_at)) : null;
      const failureCount = Number(found.failure_count ?? 0) + 1;
      await pool.execute(
        `UPDATE infrastructure_alerts SET
          last_seen_at = NOW(3), failure_count = ?, severity = ?, message = ?, metric_value = ?, threshold_value = ?
         WHERE id = ?`,
        [failureCount, ev.severity, ev.message, ev.metric_value, ev.threshold_value, alertId]
      );
      if (canNotify(settings, ev.severity, lastNotified)) {
        const snap = ev.nas_device_id ? routerSnapsById.get(ev.nas_device_id) ?? null : null;
        const sent = await dispatchAlertNotifications(
          pool,
          tenantId,
          ev.severity,
          ev,
          snap,
          serverSnap,
          false,
          settings
        );
        if (sent) {
          await pool.execute(
            `UPDATE infrastructure_alerts SET notification_count = notification_count + 1, last_notified_at = NOW(3) WHERE id = ?`,
            [alertId]
          );
          await recordHistory(pool, alertId, tenantId, "notified", ev.severity, ev.message, {
            channel: "multi",
          });
        }
      }
      await recordHistory(pool, alertId, tenantId, "updated", ev.severity, ev.message);
      continue;
    }

    const alertId = randomUUID();
    await pool.execute(
      `INSERT INTO infrastructure_alerts
        (id, tenant_id, nas_device_id, alert_type, severity, status, title, message, metric_value, threshold_value,
         fingerprint, first_seen_at, last_seen_at, failure_count)
       VALUES (?, ?, ?, ?, ?, 'firing', ?, ?, ?, ?, ?, NOW(3), NOW(3), 1)`,
      [
        alertId,
        tenantId,
        ev.nas_device_id,
        ev.alert_type,
        ev.severity,
        ev.title,
        ev.message,
        ev.metric_value,
        ev.threshold_value,
        ev.fingerprint,
      ]
    );
    await recordHistory(pool, alertId, tenantId, "created", ev.severity, ev.message);
    if (canNotify(settings, ev.severity, null)) {
      const snap = ev.nas_device_id ? routerSnapsById.get(ev.nas_device_id) ?? null : null;
      const sent = await dispatchAlertNotifications(
        pool,
        tenantId,
        ev.severity,
        ev,
        snap,
        serverSnap,
        false,
        settings
      );
      if (sent) {
        await pool.execute(
          `UPDATE infrastructure_alerts SET notification_count = 1, last_notified_at = NOW(3) WHERE id = ?`,
          [alertId]
        );
        await recordHistory(pool, alertId, tenantId, "notified", ev.severity, ev.message, { channel: "multi" });
      }
    }
  }

  for (const row of existing) {
    const fingerprint = String(row.fingerprint);
    if (firingFps.has(fingerprint)) continue;
    const alertId = String(row.id);
    await pool.execute(
      `UPDATE infrastructure_alerts SET status = 'resolved', resolved_at = NOW(3) WHERE id = ?`,
      [alertId]
    );
    await recordHistory(pool, alertId, tenantId, "resolved", String(row.severity), "تم حل المشكلة");

    if (settings.recovery_notifications_enabled) {
      const recoveryEv: EvaluatedAlert = {
        alert_type: String(row.alert_type) as InfrastructureAlertType,
        severity: String(row.severity) as AlertSeverity,
        nas_device_id: row.nas_device_id != null ? String(row.nas_device_id) : null,
        nas_name: null,
        title: String(row.title),
        message: String(row.message),
        metric_value: null,
        threshold_value: null,
        fingerprint,
      };
      const snap = recoveryEv.nas_device_id ? routerSnapsById.get(recoveryEv.nas_device_id) ?? null : null;
      const sent = await dispatchAlertNotifications(
        pool,
        tenantId,
        "info",
        recoveryEv,
        snap,
        serverSnap,
        true,
        settings
      );
      if (sent) {
        await pool.execute(`UPDATE infrastructure_alerts SET recovery_notified_at = NOW(3) WHERE id = ?`, [alertId]);
        await recordHistory(pool, alertId, tenantId, "recovery_notified", "info", recoveryEv.message);
      }
    }
  }
}

export async function ingestExternalAlerts(pool: Pool, tenantId: string): Promise<EvaluatedAlert[]> {
  const extra: EvaluatedAlert[] = [];
  const backup = await getBackupAlert(tenantId);
  if (backup.has_recent_failure) {
    extra.push({
      alert_type: "backup_failed",
      severity: "critical",
      nas_device_id: null,
      nas_name: null,
      title: "فشل النسخ الاحتياطي",
      message: backup.last_error ?? "آخر نسخة احتياطية فشلت",
      metric_value: null,
      threshold_value: null,
      fingerprint: fp([tenantId, null, "backup_failed"]),
    });
  }
  const wa = await getWhatsAppStatus(tenantId);
  if (wa.enabled && wa.configured && !wa.connected) {
    extra.push({
      alert_type: "whatsapp_disconnected",
      severity: "warning",
      nas_device_id: null,
      nas_name: null,
      title: "واتساب غير متصل",
      message: wa.last_error ?? "جلسة WAHA غير متصلة",
      metric_value: null,
      threshold_value: null,
      fingerprint: fp([tenantId, null, "whatsapp_disconnected"]),
    });
  }
  return extra;
}

export async function runAlertEvaluationCycle(
  pool: Pool,
  tenantId: string,
  routerSnaps: RouterHealthSnapshot[],
  prevRouterSnaps: Map<string, RouterHealthSnapshot>,
  serverSnap: ServerHealthSnapshot
): Promise<void> {
  const settings = await getMonitoringSettings(pool, tenantId);
  if (!settings.infrastructure_alerts_enabled) return;

  const globalThresholds = await import("./infrastructure-thresholds.service.js").then((m) =>
    m.getGlobalThresholds(pool, tenantId)
  );

  const evaluated: EvaluatedAlert[] = [];
  for (const snap of routerSnaps) {
    const thresholds = await getNasThresholds(pool, tenantId, snap.nas_device_id);
    const prev = prevRouterSnaps.get(snap.nas_device_id) ?? null;
    evaluated.push(...evaluateRouterAlerts(snap, prev, thresholds, settings));
  }
  evaluated.push(...evaluateServerAlerts(serverSnap, globalThresholds, tenantId));
  evaluated.push(...(await ingestExternalAlerts(pool, tenantId)));

  const routerSnapsById = new Map<string, RouterHealthSnapshot>();
  for (const s of routerSnaps) routerSnapsById.set(s.nas_device_id, s);

  await upsertInfrastructureAlerts(pool, tenantId, evaluated, settings, routerSnapsById, serverSnap);
}

export async function listActiveAlerts(pool: Pool, tenantId: string, limit = 50): Promise<RowDataPacket[]> {
  if (!(await hasTable(pool, "infrastructure_alerts"))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.*, n.name AS nas_name_resolved
     FROM infrastructure_alerts a
     LEFT JOIN nas_devices n ON n.id = a.nas_device_id
     WHERE a.tenant_id = ?
     ORDER BY FIELD(a.status,'firing','acknowledged','resolved'), FIELD(a.severity,'critical','warning','info'), a.last_seen_at DESC
     LIMIT ?`,
    [tenantId, limit]
  );
  return rows;
}

export async function acknowledgeAlert(
  pool: Pool,
  tenantId: string,
  alertId: string,
  userId: string
): Promise<boolean> {
  const [r] = await pool.execute(
    `UPDATE infrastructure_alerts SET status = 'acknowledged', acknowledged_at = NOW(3), acknowledged_by = ?
     WHERE id = ? AND tenant_id = ? AND status = 'firing'`,
    [userId, alertId, tenantId]
  );
  return (r as { affectedRows?: number }).affectedRows === 1;
}
