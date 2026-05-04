import { pool } from "../db/pool.js";
import { invalidateColumnCache } from "../db/schemaGuards.js";

/** Idempotent DDL — keep in sync with `sql/schema_extensions.sql` (invoices / payments). */
const INVOICES_DDL = `
CREATE TABLE IF NOT EXISTS \`invoices\` (
  \`id\` CHAR(36) NOT NULL,
  \`tenant_id\` CHAR(36) NOT NULL,
  \`subscriber_id\` CHAR(36) NOT NULL,
  \`period\` VARCHAR(16) NOT NULL DEFAULT 'monthly',
  \`invoice_no\` VARCHAR(64) NOT NULL,
  \`issue_date\` DATE NOT NULL,
  \`due_date\` DATE NOT NULL,
  \`amount\` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  \`currency\` VARCHAR(8) NOT NULL DEFAULT 'USD',
  \`status\` VARCHAR(16) NOT NULL DEFAULT 'sent',
  \`meta\` JSON DEFAULT NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  KEY \`idx_invoices_tenant_subscriber_status\` (\`tenant_id\`,\`subscriber_id\`,\`status\`),
  KEY \`idx_invoices_tenant_issue_date\` (\`tenant_id\`,\`issue_date\`),
  KEY \`idx_invoices_tenant_created\` (\`tenant_id\`,\`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`.trim();

const PAYMENTS_DDL = `
CREATE TABLE IF NOT EXISTS \`payments\` (
  \`id\` CHAR(36) NOT NULL,
  \`tenant_id\` CHAR(36) NOT NULL,
  \`invoice_id\` CHAR(36) NOT NULL,
  \`amount\` DECIMAL(14,2) NOT NULL,
  \`method\` VARCHAR(64) NOT NULL DEFAULT 'manual',
  \`paid_at\` DATETIME(3) NOT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_payments_tenant_paid_at\` (\`tenant_id\`,\`paid_at\`),
  KEY \`idx_payments_invoice\` (\`invoice_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`.trim();

/**
 * Ensures modern `invoices` / `payments` tables exist after a Radius/DMA restore (which omits them).
 * Always runs in DMA too — package invoice + payment from `/users` need these tables even when only `rm_users` exists.
 * Set SKIP_BILLING_SCHEMA_BOOTSTRAP=1 to disable.
 */
export async function ensureBillingTables(): Promise<void> {
  if (String(process.env.SKIP_BILLING_SCHEMA_BOOTSTRAP ?? "").trim() === "1") {
    return;
  }
  const conn = await pool.getConnection();
  try {
    await conn.query(INVOICES_DDL);
    await conn.query(PAYMENTS_DDL);
  } finally {
    conn.release();
  }
  invalidateColumnCache();
}
