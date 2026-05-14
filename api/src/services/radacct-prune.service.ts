import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";

export type YearPrunePreview = {
  year: number;
  from: string;
  to_exclusive: string;
  radacct_rows: number;
  radacct_distinct_users: number;
};

function yearRange(year: number): { from: string; to: string } {
  const from = `${year}-01-01 00:00:00`;
  const to = `${year + 1}-01-01 00:00:00`;
  return { from, to };
}

async function countRange(from: string, to: string): Promise<{ rows: number; users: number }> {
  if (!(await hasTable(pool, "radacct"))) return { rows: 0, users: 0 };
  const [r1] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM radacct WHERE acctstarttime >= ? AND acctstarttime < ?`,
    [from, to]
  );
  const [r2] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT username) AS c FROM radacct WHERE acctstarttime >= ? AND acctstarttime < ? AND TRIM(COALESCE(username,'')) <> ''`,
    [from, to]
  );
  return {
    rows: Number(r1[0]?.c ?? 0),
    users: Number(r2[0]?.c ?? 0),
  };
}

export async function previewRadacctYearPrune(year: number): Promise<YearPrunePreview> {
  const { from, to } = yearRange(year);
  const radacct = await countRange(from, to);
  return {
    year,
    from,
    to_exclusive: to,
    radacct_rows: radacct.rows,
    radacct_distinct_users: radacct.users,
  };
}

export async function runRadacctYearPrune(year: number): Promise<YearPrunePreview> {
  const before = await previewRadacctYearPrune(year);
  const conn = await pool.getConnection();
  try {
    if (before.radacct_rows > 0 && (await hasTable(pool, "radacct"))) {
      await conn.execute(
        "DELETE FROM radacct WHERE acctstarttime >= ? AND acctstarttime < ?",
        [before.from, before.to_exclusive]
      );
    }
    return before;
  } finally {
    conn.release();
  }
}
