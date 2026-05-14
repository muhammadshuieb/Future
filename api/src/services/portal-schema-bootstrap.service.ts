import { pool } from "../db/pool.js";
import { config } from "../config.js";

/**
 * Tables required by the API but not owned by sql migrations versioning (cross-cutting).
 * Kept minimal — full DDL lives in `sql/migrations/001_initial_future_radius.sql`.
 */
export async function ensurePortalTenantAndStaffTables(): Promise<void> {
  await pool.execute(`INSERT IGNORE INTO tenants (id, name, status) VALUES (?, 'Default', 'active')`, [
    config.defaultTenantId,
  ]);
}
