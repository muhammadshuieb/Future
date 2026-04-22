import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

export async function hasTable(pool: Pool, name: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [name]
  );
  return rows.length > 0;
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
}
