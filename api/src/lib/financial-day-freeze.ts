import type { Pool } from "mysql2/promise";
import type { Request } from "express";
import { hasTable } from "../db/schemaGuards.js";
import type { RowDataPacket } from "mysql2";

/** Dates (YYYY-MM-DD) that have been financially closed — expenses on/before last closed day are locked for non-admins. */
export async function getLatestClosedBusinessDate(pool: Pool, tenantId: string): Promise<string | null> {
  if (!(await hasTable(pool, "financial_day_closings"))) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT business_date FROM financial_day_closings
     WHERE tenant_id = ? AND status = 'closed'
     ORDER BY business_date DESC LIMIT 1`,
    [tenantId]
  );
  const d = rows[0]?.business_date;
  return d != null ? String(d).slice(0, 10) : null;
}

export async function isExpenseDateLockedForRole(
  pool: Pool,
  tenantId: string,
  expenseDateYmd: string,
  role: string | undefined
): Promise<boolean> {
  if (role === "admin") return false;
  const latest = await getLatestClosedBusinessDate(pool, tenantId);
  if (!latest) return false;
  const exp = expenseDateYmd.slice(0, 10);
  return exp <= latest;
}

export function requestCanOverrideFinancialFreeze(req: Request): boolean {
  return req.auth?.role === "admin";
}
