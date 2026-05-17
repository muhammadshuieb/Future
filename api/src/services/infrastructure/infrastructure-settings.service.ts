import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../../db/schemaGuards.js";
import {
  DEFAULT_MONITORING_SETTINGS,
  type MonitoringSettings,
} from "./infrastructure-types.js";

export async function ensureInfrastructureMonitoringSchema(pool: Pool): Promise<void> {
  if (!(await hasTable(pool, "infrastructure_monitoring_settings"))) return;
}

export async function getMonitoringSettings(
  pool: Pool,
  tenantId: string
): Promise<MonitoringSettings> {
  if (!(await hasTable(pool, "infrastructure_monitoring_settings"))) {
    return { ...DEFAULT_MONITORING_SETTINGS };
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM infrastructure_monitoring_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  if (!rows[0]) {
    await pool.execute(
      `INSERT INTO infrastructure_monitoring_settings (tenant_id) VALUES (?) ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
      [tenantId]
    );
    return { ...DEFAULT_MONITORING_SETTINGS };
  }
  const r = rows[0];
  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  const hasTelegram = col.has("telegram_chat_id");
  const chatId = hasTelegram && r.telegram_chat_id != null ? String(r.telegram_chat_id).trim() : "";
  const hasToken =
    hasTelegram &&
    r.telegram_bot_token_encrypted != null &&
    (r.telegram_bot_token_encrypted as Buffer)?.length > 0;
  return {
    infrastructure_alerts_enabled: Boolean(r.infrastructure_alerts_enabled ?? 1),
    whatsapp_alerts_enabled: Boolean(r.whatsapp_alerts_enabled ?? 1),
    whatsapp_critical_only: Boolean(r.whatsapp_critical_only ?? 0),
    telegram_configured: Boolean(hasTelegram && chatId && hasToken),
    telegram_alerts_enabled: Boolean(hasTelegram && (r.telegram_alerts_enabled ?? 0)),
    alert_cooldown_minutes: Math.max(5, Number(r.alert_cooldown_minutes ?? 30)),
    router_offline_minutes: Math.max(1, Number(r.router_offline_minutes ?? 2)),
    quiet_hours_enabled: Boolean(r.quiet_hours_enabled ?? 0),
    quiet_hours_start: r.quiet_hours_start != null ? String(r.quiet_hours_start) : null,
    quiet_hours_end: r.quiet_hours_end != null ? String(r.quiet_hours_end) : null,
    recovery_notifications_enabled: Boolean(r.recovery_notifications_enabled ?? 1),
    poll_interval_seconds: Math.max(60, Number(r.poll_interval_seconds ?? 180)),
  };
}

export async function updateMonitoringSettings(
  pool: Pool,
  tenantId: string,
  input: Partial<MonitoringSettings>
): Promise<MonitoringSettings> {
  await pool.execute(
    `INSERT INTO infrastructure_monitoring_settings (tenant_id) VALUES (?) ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [tenantId]
  );
  const cur = await getMonitoringSettings(pool, tenantId);
  const next = { ...cur, ...input };
  await pool.execute(
    `UPDATE infrastructure_monitoring_settings SET
      infrastructure_alerts_enabled = ?,
      whatsapp_alerts_enabled = ?,
      whatsapp_critical_only = ?,
      alert_cooldown_minutes = ?,
      router_offline_minutes = ?,
      quiet_hours_enabled = ?,
      quiet_hours_start = ?,
      quiet_hours_end = ?,
      recovery_notifications_enabled = ?,
      poll_interval_seconds = ?
     WHERE tenant_id = ?`,
    [
      next.infrastructure_alerts_enabled ? 1 : 0,
      next.whatsapp_alerts_enabled ? 1 : 0,
      next.whatsapp_critical_only ? 1 : 0,
      next.alert_cooldown_minutes,
      next.router_offline_minutes,
      next.quiet_hours_enabled ? 1 : 0,
      next.quiet_hours_start,
      next.quiet_hours_end,
      next.recovery_notifications_enabled ? 1 : 0,
      next.poll_interval_seconds,
      tenantId,
    ]
  );
  return next;
}

export function isInQuietHours(settings: MonitoringSettings, now = new Date()): boolean {
  if (!settings.quiet_hours_enabled || !settings.quiet_hours_start || !settings.quiet_hours_end) {
    return false;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const cur = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const start = settings.quiet_hours_start.slice(0, 5);
  const end = settings.quiet_hours_end.slice(0, 5);
  if (start <= end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

export type NotificationTarget = {
  id: string;
  label: string;
  phone: string;
  is_group: boolean;
  enabled: boolean;
  receive_critical: boolean;
  receive_warning: boolean;
  receive_info: boolean;
  receive_recovery: boolean;
  sort_order: number;
};

export async function listNotificationTargets(
  pool: Pool,
  tenantId: string
): Promise<NotificationTarget[]> {
  if (!(await hasTable(pool, "infrastructure_notification_targets"))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM infrastructure_notification_targets WHERE tenant_id = ? ORDER BY sort_order, label`,
    [tenantId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label ?? ""),
    phone: String(r.phone ?? ""),
    is_group: Boolean(r.is_group),
    enabled: Boolean(r.enabled),
    receive_critical: Boolean(r.receive_critical ?? 1),
    receive_warning: Boolean(r.receive_warning ?? 1),
    receive_info: Boolean(r.receive_info ?? 0),
    receive_recovery: Boolean(r.receive_recovery ?? 1),
    sort_order: Number(r.sort_order ?? 0),
  }));
}

export async function upsertNotificationTarget(
  pool: Pool,
  tenantId: string,
  input: Omit<NotificationTarget, "id"> & { id?: string }
): Promise<string> {
  const id = input.id ?? randomUUID();
  await pool.execute(
    `INSERT INTO infrastructure_notification_targets
      (id, tenant_id, label, phone, is_group, enabled, receive_critical, receive_warning, receive_info, receive_recovery, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      label = VALUES(label), phone = VALUES(phone), is_group = VALUES(is_group), enabled = VALUES(enabled),
      receive_critical = VALUES(receive_critical), receive_warning = VALUES(receive_warning),
      receive_info = VALUES(receive_info), receive_recovery = VALUES(receive_recovery), sort_order = VALUES(sort_order)`,
    [
      id,
      tenantId,
      input.label,
      input.phone,
      input.is_group ? 1 : 0,
      input.enabled ? 1 : 0,
      input.receive_critical ? 1 : 0,
      input.receive_warning ? 1 : 0,
      input.receive_info ? 1 : 0,
      input.receive_recovery ? 1 : 0,
      input.sort_order,
    ]
  );
  return id;
}

export async function deleteNotificationTarget(pool: Pool, tenantId: string, id: string): Promise<void> {
  await pool.execute(`DELETE FROM infrastructure_notification_targets WHERE id = ? AND tenant_id = ?`, [
    id,
    tenantId,
  ]);
}
