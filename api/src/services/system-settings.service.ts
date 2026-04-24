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
  wireguard_vpn_enabled: boolean;
  wireguard_server_host: string;
  wireguard_server_port: number;
  wireguard_interface_cidr: string;
  wireguard_client_dns: string;
  wireguard_persistent_keepalive: number;
  wireguard_server_public_key: string;
  wireguard_server_private_key: string;
  wireguard_server_private_key_set: boolean;
};

export async function ensureSystemSettings(tenantId: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      tenant_id CHAR(36) NOT NULL PRIMARY KEY,
      critical_alert_enabled TINYINT(1) NOT NULL DEFAULT 0,
      critical_alert_phone VARCHAR(32) DEFAULT NULL,
      critical_alert_use_session_owner TINYINT(1) NOT NULL DEFAULT 1,
      server_log_retention_days INT NOT NULL DEFAULT 14,
      wireguard_vpn_enabled TINYINT(1) NOT NULL DEFAULT 1,
      wireguard_server_host VARCHAR(128) DEFAULT NULL,
      wireguard_server_port INT NOT NULL DEFAULT 51820,
      wireguard_interface_cidr VARCHAR(64) DEFAULT NULL,
      wireguard_client_dns VARCHAR(128) DEFAULT NULL,
      wireguard_persistent_keepalive INT NOT NULL DEFAULT 25,
      wireguard_server_public_key VARCHAR(64) DEFAULT NULL,
      wireguard_server_private_key_encrypted VARBINARY(512) DEFAULT NULL,
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
  let wireguardPrivateKey = "";
  const wireguardPrivateBlob = col.has("wireguard_server_private_key_encrypted")
    ? (row.wireguard_server_private_key_encrypted as Buffer | Uint8Array | null | undefined)
    : null;
  if (wireguardPrivateBlob) {
    wireguardPrivateKey = tryDecryptSecret(Buffer.from(wireguardPrivateBlob)) ?? "";
  }
  const wireguardHostRaw = col.has("wireguard_server_host") ? String(row.wireguard_server_host ?? "").trim() : "";
  const wireguardCidrRaw = col.has("wireguard_interface_cidr")
    ? String(row.wireguard_interface_cidr ?? "").trim()
    : "";
  const wireguardUnconfigured = !wireguardHostRaw && !wireguardCidrRaw && !wireguardPrivateKey;
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
    wireguard_vpn_enabled: col.has("wireguard_vpn_enabled")
      ? (wireguardUnconfigured ? true : Boolean(Number(row.wireguard_vpn_enabled ?? 1)))
      : true,
    wireguard_server_host: col.has("wireguard_server_host")
      ? String(row.wireguard_server_host ?? "")
      : "",
    wireguard_server_port: col.has("wireguard_server_port")
      ? Math.max(1, Math.min(65535, Number(row.wireguard_server_port ?? 51820)))
      : 51820,
    wireguard_interface_cidr: col.has("wireguard_interface_cidr")
      ? String(row.wireguard_interface_cidr ?? "") || "10.20.0.1/24"
      : "10.20.0.1/24",
    wireguard_client_dns: col.has("wireguard_client_dns")
      ? String(row.wireguard_client_dns ?? "") || "1.1.1.1,8.8.8.8"
      : "1.1.1.1,8.8.8.8",
    wireguard_persistent_keepalive: col.has("wireguard_persistent_keepalive")
      ? Math.max(0, Math.min(300, Number(row.wireguard_persistent_keepalive ?? 25)))
      : 25,
    wireguard_server_public_key: col.has("wireguard_server_public_key")
      ? String(row.wireguard_server_public_key ?? "")
      : "",
    wireguard_server_private_key: wireguardPrivateKey,
    wireguard_server_private_key_set: Boolean(wireguardPrivateKey),
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
  wireguard_vpn_enabled: boolean;
  wireguard_server_host: string;
  wireguard_server_port: number;
  wireguard_interface_cidr: string;
  wireguard_client_dns: string;
  wireguard_persistent_keepalive: number;
  wireguard_server_public_key: string;
  wireguard_server_private_key?: string;
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
  if (col.has("wireguard_vpn_enabled")) {
    baseSets.push("wireguard_vpn_enabled = ?");
    baseVals.push(input.wireguard_vpn_enabled ? 1 : 0);
  }
  if (col.has("wireguard_server_host")) {
    const host = String(input.wireguard_server_host ?? "").trim();
    baseSets.push("wireguard_server_host = ?");
    baseVals.push(host.length ? host.slice(0, 128) : null);
  }
  if (col.has("wireguard_server_port")) {
    baseSets.push("wireguard_server_port = ?");
    baseVals.push(Math.max(1, Math.min(65535, Math.floor(input.wireguard_server_port || 51820))));
  }
  if (col.has("wireguard_interface_cidr")) {
    const cidr = String(input.wireguard_interface_cidr ?? "").trim();
    baseSets.push("wireguard_interface_cidr = ?");
    baseVals.push(cidr.length ? cidr.slice(0, 64) : null);
  }
  if (col.has("wireguard_client_dns")) {
    const dns = String(input.wireguard_client_dns ?? "").trim();
    baseSets.push("wireguard_client_dns = ?");
    baseVals.push(dns.length ? dns.slice(0, 128) : null);
  }
  if (col.has("wireguard_persistent_keepalive")) {
    baseSets.push("wireguard_persistent_keepalive = ?");
    baseVals.push(Math.max(0, Math.min(300, Math.floor(input.wireguard_persistent_keepalive || 25))));
  }
  if (col.has("wireguard_server_public_key")) {
    const publicKey = String(input.wireguard_server_public_key ?? "").trim();
    baseSets.push("wireguard_server_public_key = ?");
    baseVals.push(publicKey.length ? publicKey.slice(0, 64) : null);
  }
  if (col.has("wireguard_server_private_key_encrypted")) {
    const privateKey = String(input.wireguard_server_private_key ?? "");
    if (privateKey.trim().length > 0) {
      baseSets.push("wireguard_server_private_key_encrypted = ?");
      baseVals.push(encryptSecret(privateKey.trim()));
    }
  }
  await pool.query(`UPDATE system_settings SET ${baseSets.join(", ")} WHERE tenant_id = ?`, [
    ...baseVals,
    tenantId,
  ]);
  return getSystemSettings(tenantId);
}
