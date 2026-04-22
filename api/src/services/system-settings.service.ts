import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";

export type SystemSettingsView = {
  critical_alert_enabled: boolean;
  critical_alert_phone: string;
  critical_alert_use_session_owner: boolean;
  server_log_retention_days: number;
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

export async function getSystemSettings(tenantId: string): Promise<SystemSettingsView> {
  await ensureSystemSettings(tenantId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT critical_alert_enabled, critical_alert_phone, critical_alert_use_session_owner, server_log_retention_days
     FROM system_settings
     WHERE tenant_id = ?
     LIMIT 1`,
    [tenantId]
  );
  const row = rows[0] ?? {};
  return {
    critical_alert_enabled: Boolean(Number(row.critical_alert_enabled ?? 0)),
    critical_alert_phone: normalizePhone(String(row.critical_alert_phone ?? "")),
    critical_alert_use_session_owner: Boolean(Number(row.critical_alert_use_session_owner ?? 1)),
    server_log_retention_days: Math.max(3, Math.min(90, Number(row.server_log_retention_days ?? 14))),
  };
}

export async function updateSystemSettings(
  tenantId: string,
  input: {
    critical_alert_enabled: boolean;
    critical_alert_phone: string;
    critical_alert_use_session_owner: boolean;
    server_log_retention_days: number;
  }
): Promise<SystemSettingsView> {
  await ensureSystemSettings(tenantId);
  await pool.execute(
    `UPDATE system_settings
     SET critical_alert_enabled = ?,
         critical_alert_phone = ?,
         critical_alert_use_session_owner = ?,
         server_log_retention_days = ?
     WHERE tenant_id = ?`,
    [
      input.critical_alert_enabled ? 1 : 0,
      normalizePhone(input.critical_alert_phone) || null,
      input.critical_alert_use_session_owner ? 1 : 0,
      Math.max(3, Math.min(90, Math.floor(input.server_log_retention_days || 14))),
      tenantId,
    ]
  );
  return getSystemSettings(tenantId);
}
