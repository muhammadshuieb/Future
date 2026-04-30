import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";

/** Keyed by configured database name + lowercased table name. */
const tableExistenceCache = new Map<string, boolean>();

export function invalidateTableExistenceCache(): void {
  tableExistenceCache.clear();
}

/**
 * Cached existence check (information_schema). Use after SQL restore if schema changed.
 */
export async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const key = `${config.db.database}\0${tableName.toLowerCase()}`;
  const hit = tableExistenceCache.get(key);
  if (hit !== undefined) return hit;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [tableName]
  );
  const ok = rows.length > 0;
  tableExistenceCache.set(key, ok);
  return ok;
}
