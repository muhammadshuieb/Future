import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { config } from "../config.js";

/**
 * Minimal portal tables (not part of Radius Manager dumps). Keeps staff login working
 * when DMA_MODE is on or rm_users already exists (Radius Manager dump).
 */
export async function ensurePortalTenantAndStaffTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`tenants\` (
      \`id\` CHAR(36) NOT NULL,
      \`name\` VARCHAR(128) NOT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`INSERT IGNORE INTO \`tenants\` (\`id\`, \`name\`) VALUES (?, 'Default')`, [
    config.defaultTenantId,
  ]);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`rm_managers\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`managername\` VARCHAR(128) NOT NULL,
      \`password\` VARCHAR(128) NOT NULL,
      \`firstname\` VARCHAR(128) DEFAULT NULL,
      \`lastname\` VARCHAR(128) DEFAULT NULL,
      \`email\` VARCHAR(255) DEFAULT NULL,
      \`balance\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      \`enablemanager\` TINYINT(1) NOT NULL DEFAULT 1,
      \`perm_listmanagers\` TINYINT(1) NOT NULL DEFAULT 0,
      \`perm_createmanagers\` TINYINT(1) NOT NULL DEFAULT 0,
      \`perm_deletemanagers\` TINYINT(1) NOT NULL DEFAULT 0,
      \`perm_listusers\` TINYINT(1) NOT NULL DEFAULT 0,
      \`perm_editusers\` TINYINT(1) NOT NULL DEFAULT 0,
      \`perm_addcredits\` TINYINT(1) NOT NULL DEFAULT 0,
      \`perm_listinvoices\` TINYINT(1) NOT NULL DEFAULT 0,
      \`perm_editinvoice\` TINYINT(1) NOT NULL DEFAULT 0,
      \`perm_negbalance\` TINYINT(1) NOT NULL DEFAULT 0,
      \`allowed_negative_balance\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      \`perm_logout\` TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_rm_managers_managername\` (\`managername\`),
      UNIQUE KEY \`uq_rm_managers_email\` (\`email\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [rmNegCol] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS ok
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'rm_managers'
       AND COLUMN_NAME = 'allowed_negative_balance'
     LIMIT 1`
  );
  if (!rmNegCol[0]) {
    await pool.query(
      `ALTER TABLE \`rm_managers\`
       ADD COLUMN \`allowed_negative_balance\` DECIMAL(14,2) NOT NULL DEFAULT 0.00`
    );
  }
  // staff_users table intentionally not bootstrapped; auth/staff use rm_managers as source of truth.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`manager_wallet_transactions\` (
      \`id\` CHAR(36) NOT NULL,
      \`tenant_id\` CHAR(36) NOT NULL,
      \`staff_id\` CHAR(36) NOT NULL,
      \`actor_staff_id\` CHAR(36) DEFAULT NULL,
      \`amount\` DECIMAL(14,2) NOT NULL,
      \`tx_type\` VARCHAR(48) NOT NULL,
      \`note\` VARCHAR(255) DEFAULT NULL,
      \`related_subscriber_id\` CHAR(36) DEFAULT NULL,
      \`currency\` VARCHAR(8) DEFAULT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      KEY \`idx_manager_wallet_tx_staff\` (\`tenant_id\`, \`staff_id\`, \`created_at\`),
      KEY \`idx_manager_wallet_tx_actor\` (\`tenant_id\`, \`actor_staff_id\`, \`created_at\`),
      KEY \`idx_manager_wallet_tx_sub\` (\`tenant_id\`, \`related_subscriber_id\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`server_logs\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`level\` ENUM('error','warn','info','debug') NOT NULL DEFAULT 'info',
      \`source\` VARCHAR(64) NOT NULL DEFAULT 'api',
      \`category\` VARCHAR(96) DEFAULT NULL,
      \`message\` VARCHAR(8000) NOT NULL,
      \`stack\` MEDIUMTEXT DEFAULT NULL,
      \`meta\` JSON DEFAULT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      KEY \`idx_server_logs_level_created\` (\`level\`, \`created_at\`),
      KEY \`idx_server_logs_source_created\` (\`source\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`server_log_alerts\` (
      \`id\` CHAR(36) NOT NULL,
      \`log_id\` BIGINT UNSIGNED NOT NULL,
      \`tenant_id\` CHAR(36) NOT NULL,
      \`status\` ENUM('sent','failed','skipped') NOT NULL DEFAULT 'skipped',
      \`error_message\` VARCHAR(4000) DEFAULT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_server_log_alerts_log\` (\`log_id\`),
      KEY \`idx_server_log_alerts_tenant_created\` (\`tenant_id\`, \`created_at\`),
      CONSTRAINT \`fk_server_log_alerts_log\`
        FOREIGN KEY (\`log_id\`) REFERENCES \`server_logs\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`staff_role_permissions\` (
      \`id\` CHAR(36) NOT NULL,
      \`tenant_id\` CHAR(36) NOT NULL,
      \`role\` ENUM('admin','manager','accountant','viewer') NOT NULL,
      \`permissions_json\` JSON DEFAULT NULL,
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_staff_role_permissions_tenant_role\` (\`tenant_id\`,\`role\`),
      CONSTRAINT \`fk_staff_role_permissions_tenant\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`subscriber_regions\` (
      \`id\` CHAR(36) NOT NULL,
      \`tenant_id\` CHAR(36) NOT NULL,
      \`parent_id\` CHAR(36) DEFAULT NULL,
      \`name\` VARCHAR(128) NOT NULL,
      \`sort_order\` INT NOT NULL DEFAULT 0,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      KEY \`idx_regions_tenant_parent_sort\` (\`tenant_id\`, \`parent_id\`, \`sort_order\`),
      CONSTRAINT \`fk_regions_tenant\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_regions_parent\` FOREIGN KEY (\`parent_id\`) REFERENCES \`subscriber_regions\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`wireguard_peers\` (
      \`id\` CHAR(36) NOT NULL,
      \`tenant_id\` CHAR(36) NOT NULL,
      \`username\` VARCHAR(128) NOT NULL,
      \`public_key\` VARCHAR(64) NOT NULL,
      \`private_key_encrypted\` VARBINARY(512) NOT NULL,
      \`tunnel_ip\` VARCHAR(64) DEFAULT NULL,
      \`allowed_ips\` VARCHAR(255) DEFAULT NULL,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`note\` VARCHAR(255) DEFAULT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      KEY \`idx_wireguard_peers_tenant\` (\`tenant_id\`),
      KEY \`idx_wireguard_peers_username\` (\`username\`),
      KEY \`idx_wireguard_peers_tunnel_ip\` (\`tunnel_ip\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function logRadiusManagerUserCount(): Promise<void> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'rm_users'`
    );
    if (Number(rows[0]?.c ?? 0) === 0) {
      console.log("[bootstrap] rm_users table not present");
      return;
    }
    const [c] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM rm_users`);
    const n = Number(c[0]?.c ?? 0);
    console.log(`[bootstrap] rm_users row count=${n} (${n === 0 ? "fresh" : "existing Radius Manager data"})`);
  } catch (e) {
    console.warn("[bootstrap] rm_users count check failed", e);
  }
}
