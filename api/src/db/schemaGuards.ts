import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { invalidateTableExistenceCache, tableExists } from "./table-exists.js";

export async function hasTable(pool: Pool, name: string): Promise<boolean> {
  return tableExists(pool, name);
}

export { tableExists, invalidateTableExistenceCache };

/**
 * True when `rm_users` is the subscriber source of truth: table exists and either there is no
 * `subscribers` table or no row for this tenant (typical after a Radius Manager SQL restore with
 * an empty legacy `subscribers` table left by migrations).
 */
export async function isRadiusManagerSubscribersPrimary(pool: Pool, tenantId: string): Promise<boolean> {
  if (config.dmaMode) {
    return await hasTable(pool, "rm_users");
  }
  if (!(await hasTable(pool, "rm_users"))) return false;
  if (!(await hasTable(pool, "subscribers"))) return true;
  const [r] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS ok FROM subscribers WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  return !r[0];
}

export async function hasColumn(pool: Pool, table: string, column: string): Promise<boolean> {
  const cols = await getTableColumns(pool, table);
  return cols.has(column.toLowerCase());
}

const tableColumnsCache = new Map<string, Set<string>>();

/** أسماء أعمدة الجدول في القاعدة الحالية (مع تخزين مؤقت لتقليل الاستعلامات). */
export async function getTableColumns(pool: Pool, table: string): Promise<Set<string>> {
  const [dbRow] = await pool.query<RowDataPacket[]>(`SELECT DATABASE() AS d`);
  const db = String(dbRow[0]?.d ?? "");
  const key = `${db}\0${table}`;
  const hit = tableColumnsCache.get(key);
  if (hit) return hit;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const set = new Set(rows.map((r) => String(r.c).toLowerCase()));
  tableColumnsCache.set(key, set);
  return set;
}

/** بعد أخطاء مخطط (مثل عمود ناقص) لإجبار إعادة قراءة information_schema */
export function invalidateColumnCache(): void {
  tableColumnsCache.clear();
  invalidateTableExistenceCache();
}
