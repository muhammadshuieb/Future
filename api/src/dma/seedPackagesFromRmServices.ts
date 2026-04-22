import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";

export type SeedPackagesResult = { upserted: number };

/**
 * ينشئ/يحدّث صفوف packages من rm_services حسب srvid
 * (يحتاج UNIQUE(tenant_id, rm_srvid) في جدول packages).
 */
export async function seedPackagesFromRmServices(
  pool: Pool,
  tenantId: string
): Promise<SeedPackagesResult> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT srvid, srvname, combquota, dlquota, ulquota, unitprice
     FROM rm_services`
  );
  let upserted = 0;
  for (const r of rows) {
    const srvid = r.srvid as number;
    const name = String(r.srvname ?? `srv-${srvid}`).slice(0, 128);
    const comb = BigInt(r.combquota ?? 0);
    const dl = BigInt(r.dlquota ?? 0);
    const ul = BigInt(r.ulquota ?? 0);
    const quota =
      comb > 0n ? comb : dl > ul ? dl : ul;
    const price = Number(r.unitprice ?? 0);

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM packages WHERE tenant_id = ? AND rm_srvid = ? LIMIT 1`,
      [tenantId, srvid]
    );
    if (existing[0]) {
      await pool.execute(
        `UPDATE packages SET name = ?, quota_total_bytes = ?, price = ?, active = 1
         WHERE tenant_id = ? AND rm_srvid = ?`,
        [name, quota.toString(), price, tenantId, srvid]
      );
    } else {
      await pool.execute(
        `INSERT INTO packages (id, tenant_id, name, rm_srvid, quota_total_bytes, price, active, billing_period_days, currency, simultaneous_use)
         VALUES (?, ?, ?, ?, ?, ?, 1, 30, 'USD', 1)`,
        [randomUUID(), tenantId, name, srvid, quota.toString(), price]
      );
    }
    upserted++;
  }
  return { upserted };
}
