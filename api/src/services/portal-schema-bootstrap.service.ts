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
      \`perm_logout\` TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_rm_managers_managername\` (\`managername\`),
      UNIQUE KEY \`uq_rm_managers_email\` (\`email\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const legacyStaffUsersEnabled = String(process.env.LEGACY_STAFF_USERS_ENABLED || "false").toLowerCase() === "true";
  if (legacyStaffUsersEnabled) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`staff_users\` (
        \`id\` CHAR(36) NOT NULL,
        \`tenant_id\` CHAR(36) NOT NULL,
        \`name\` VARCHAR(128) NOT NULL,
        \`email\` VARCHAR(255) NOT NULL,
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`role\` ENUM('admin','manager','accountant','viewer') NOT NULL DEFAULT 'viewer',
        \`permissions_json\` JSON DEFAULT NULL,
        \`parent_staff_id\` CHAR(36) DEFAULT NULL,
        \`active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`opening_balance\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        \`wallet_balance\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_staff_email_tenant\` (\`tenant_id\`,\`email\`),
        KEY \`idx_staff_parent\` (\`tenant_id\`,\`parent_staff_id\`),
        CONSTRAINT \`fk_staff_tenant\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
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
