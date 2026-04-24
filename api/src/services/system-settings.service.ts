import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { getTableColumns } from "../db/schemaGuards.js";
import { encryptSecret, tryDecryptSecret } from "./crypto.service.js";

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
  pptp_vpn_enabled: boolean;
  pptp_server_host: string;
  pptp_server_port: number;
  pptp_server_username: string;
  pptp_server_password: string;
  pptp_server_password_set: boolean;
  pptp_local_network_cidr: string;
  pptp_client_pool_cidr: string;
};

export async function ensureSystemSettings(tenantId: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      tenant_id CHAR(36) NOT NULL PRIMARY KEY,
      critical_alert_enabled TINYINT(1) NOT NULL DEFAULT 0,
      critical_alert_phone VARCHAR(32) DEFAULT NULL,
      critical_alert_use_session_owner TINYINT(1) NOT NULL DEFAULT 1,
      server_log_retention_days INT NOT NULL DEFAULT 14,
      pptp_vpn_enabled TINYINT(1) NOT NULL DEFAULT 0,
      pptp_server_host VARCHAR(128) DEFAULT NULL,
      pptp_server_port INT NOT NULL DEFAULT 1723,
      pptp_server_username VARCHAR(128) DEFAULT NULL,
      pptp_server_password_encrypted VARBINARY(512) DEFAULT NULL,
      pptp_local_network_cidr VARCHAR(64) DEFAULT NULL,
      pptp_client_pool_cidr VARCHAR(64) DEFAULT NULL,
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
  let pptpPassword = "";
  const pptpPasswordBlob = col.has("pptp_server_password_encrypted")
    ? (row.pptp_server_password_encrypted as Buffer | Uint8Array | null | undefined)
    : null;
  if (pptpPasswordBlob) {
    pptpPassword = tryDecryptSecret(Buffer.from(pptpPasswordBlob)) ?? "";
  }
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
    pptp_vpn_enabled: col.has("pptp_vpn_enabled")
      ? Boolean(Number(row.pptp_vpn_enabled ?? 0))
      : false,
    pptp_server_host: col.has("pptp_server_host")
      ? String(row.pptp_server_host ?? "")
      : "",
    pptp_server_port: col.has("pptp_server_port")
      ? Math.max(1, Math.min(65535, Number(row.pptp_server_port ?? 1723)))
      : 1723,
    pptp_server_username: col.has("pptp_server_username")
      ? String(row.pptp_server_username ?? "")
      : "",
    pptp_server_password: pptpPassword,
    pptp_server_password_set: Boolean(pptpPassword),
    pptp_local_network_cidr: col.has("pptp_local_network_cidr")
      ? String(row.pptp_local_network_cidr ?? "")
      : "",
    pptp_client_pool_cidr: col.has("pptp_client_pool_cidr")
      ? String(row.pptp_client_pool_cidr ?? "")
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
  pptp_vpn_enabled: boolean;
  pptp_server_host: string;
  pptp_server_port: number;
  pptp_server_username: string;
  pptp_server_password?: string;
  pptp_local_network_cidr: string;
  pptp_client_pool_cidr: string;
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
  const baseVals: (string | number | Buffer | null)[] = [
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
  if (col.has("pptp_vpn_enabled")) {
    baseSets.push("pptp_vpn_enabled = ?");
    baseVals.push(input.pptp_vpn_enabled ? 1 : 0);
  }
  if (col.has("pptp_server_host")) {
    const host = String(input.pptp_server_host ?? "").trim();
    baseSets.push("pptp_server_host = ?");
    baseVals.push(host.length ? host.slice(0, 128) : null);
  }
  if (col.has("pptp_server_port")) {
    baseSets.push("pptp_server_port = ?");
    baseVals.push(Math.max(1, Math.min(65535, Math.floor(input.pptp_server_port || 1723))));
  }
  if (col.has("pptp_server_username")) {
    const user = String(input.pptp_server_username ?? "").trim();
    baseSets.push("pptp_server_username = ?");
    baseVals.push(user.length ? user.slice(0, 128) : null);
  }
  if (col.has("pptp_local_network_cidr")) {
    const cidr = String(input.pptp_local_network_cidr ?? "").trim();
    baseSets.push("pptp_local_network_cidr = ?");
    baseVals.push(cidr.length ? cidr.slice(0, 64) : null);
  }
  if (col.has("pptp_client_pool_cidr")) {
    const cidr = String(input.pptp_client_pool_cidr ?? "").trim();
    baseSets.push("pptp_client_pool_cidr = ?");
    baseVals.push(cidr.length ? cidr.slice(0, 64) : null);
  }
  if (col.has("pptp_server_password_encrypted")) {
    const password = String(input.pptp_server_password ?? "");
    if (password.trim().length > 0) {
      baseSets.push("pptp_server_password_encrypted = ?");
      baseVals.push(encryptSecret(password.trim()));
    }
  }
  await pool.query(`UPDATE system_settings SET ${baseSets.join(", ")} WHERE tenant_id = ?`, [
    ...baseVals,
    tenantId,
  ]);
  return getSystemSettings(tenantId);
}
