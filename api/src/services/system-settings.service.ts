import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { getTableColumns } from "../db/schemaGuards.js";

export type SystemSettingsView = {
  critical_alert_enabled: boolean;
  critical_alert_phone: string;
  critical_alert_use_session_owner: boolean;
  server_log_retention_days: number;
  user_idle_timeout_minutes: number;
  mikrotik_interim_update_minutes: number;
  disconnect_on_activation: boolean;
  disconnect_on_update: boolean;
  subscription_license_note: string;
  accountant_contact_phone: string;
};

export async function ensureSystemSettings(tenantId: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      tenant_id CHAR(36) NOT NULL PRIMARY KEY,
      critical_alert_enabled TINYINT(1) NOT NULL DEFAULT 0,
      critical_alert_phone VARCHAR(32) DEFAULT NULL,
      critical_alert_use_session_owner TINYINT(1) NOT NULL DEFAULT 1,
      server_log_retention_days INT NOT NULL DEFAULT 14,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.execute(
    `INSERT INTO system_settings (tenant_id)
     VALUES (?)
     ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [tenantId]
  );
}

function normalizePhone(raw: string | null | undefined): string {
  const clean = String(raw ?? "").replace(/[^\d+]/g, "").trim();
  if (!clean) return "";
  return clean.startsWith("+") ? clean.slice(1) : clean;
}

function rowToView(row: RowDataPacket, col: Set<string>): SystemSettingsView {
  return {
    critical_alert_enabled: Boolean(Number(row.critical_alert_enabled ?? 0)),
    critical_alert_phone: normalizePhone(String(row.critical_alert_phone ?? "")),
    critical_alert_use_session_owner: Boolean(Number(row.critical_alert_use_session_owner ?? 1)),
    server_log_retention_days: Math.max(3, Math.min(90, Number(row.server_log_retention_days ?? 14))),
    user_idle_timeout_minutes: col.has("user_idle_timeout_minutes")
      ? Math.max(2, Math.min(10_080, Number(row.user_idle_timeout_minutes ?? 4)))
      : 4,
    mikrotik_interim_update_minutes: col.has("mikrotik_interim_update_minutes")
      ? Math.max(1, Math.min(60, Number(row.mikrotik_interim_update_minutes ?? 1)))
      : 1,
    disconnect_on_activation: col.has("disconnect_on_activation")
      ? Boolean(Number(row.disconnect_on_activation ?? 1))
      : true,
    disconnect_on_update: col.has("disconnect_on_update")
      ? Boolean(Number(row.disconnect_on_update ?? 1))
      : true,
    subscription_license_note: col.has("subscription_license_note")
      ? String(row.subscription_license_note ?? "")
      : "",
    accountant_contact_phone: col.has("accountant_contact_phone")
      ? normalizePhone(String(row.accountant_contact_phone ?? ""))
      : "",
  };
}

export async function getSystemSettings(tenantId: string): Promise<SystemSettingsView> {
  await ensureSystemSettings(tenantId);
  const col = await getTableColumns(pool, "system_settings");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM system_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  return rowToView(rows[0] ?? {}, col);
}

export type SystemSettingsInput = {
  critical_alert_enabled: boolean;
  critical_alert_phone: string;
  critical_alert_use_session_owner: boolean;
  server_log_retention_days: number;
  user_idle_timeout_minutes: number;
  mikrotik_interim_update_minutes: number;
  disconnect_on_activation: boolean;
  disconnect_on_update: boolean;
  subscription_license_note: string;
  accountant_contact_phone: string;
};

export async function updateSystemSettings(
  tenantId: string,
  input: SystemSettingsInput
): Promise<SystemSettingsView> {
  await ensureSystemSettings(tenantId);
  const col = await getTableColumns(pool, "system_settings");
  const baseSets: string[] = [
    "critical_alert_enabled = ?",
    "critical_alert_phone = ?",
    "critical_alert_use_session_owner = ?",
    "server_log_retention_days = ?",
  ];
  const baseVals: (string | number | null)[] = [
    input.critical_alert_enabled ? 1 : 0,
    normalizePhone(input.critical_alert_phone) || null,
    input.critical_alert_use_session_owner ? 1 : 0,
    Math.max(3, Math.min(90, Math.floor(input.server_log_retention_days || 14))),
  ];
  if (col.has("user_idle_timeout_minutes")) {
    baseSets.push("user_idle_timeout_minutes = ?");
    baseVals.push(Math.max(2, Math.min(10_080, Math.floor(input.user_idle_timeout_minutes || 4))));
  }
  if (col.has("mikrotik_interim_update_minutes")) {
    baseSets.push("mikrotik_interim_update_minutes = ?");
    baseVals.push(Math.max(1, Math.min(60, Math.floor(input.mikrotik_interim_update_minutes || 1))));
  }
  if (col.has("disconnect_on_activation")) {
    baseSets.push("disconnect_on_activation = ?");
    baseVals.push(input.disconnect_on_activation ? 1 : 0);
  }
  if (col.has("disconnect_on_update")) {
    baseSets.push("disconnect_on_update = ?");
    baseVals.push(input.disconnect_on_update ? 1 : 0);
  }
  if (col.has("subscription_license_note")) {
    baseSets.push("subscription_license_note = ?");
    const note = String(input.subscription_license_note ?? "").trim();
    baseVals.push(note.length ? note.slice(0, 512) : null);
  }
  if (col.has("accountant_contact_phone")) {
    baseSets.push("accountant_contact_phone = ?");
    baseVals.push(normalizePhone(input.accountant_contact_phone) || null);
  }
  await pool.query(`UPDATE system_settings SET ${baseSets.join(", ")} WHERE tenant_id = ?`, [
    ...baseVals,
    tenantId,
  ]);
  return getSystemSettings(tenantId);
}
