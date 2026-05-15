import type { Pool, PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { hasTable } from "../db/schemaGuards.js";
import { pool } from "../db/pool.js";

export type CommissionSplit = {
  grossAmount: number;
  commissionAmount: number;
  companyAmount: number;
  currency: string;
  rule: "none" | "package_override" | "user_percentage" | "user_fixed";
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolve commission for a renewal/package payment. Company share = gross - commission.
 */
export async function resolveRenewalCommission(
  poolOrConn: Pool | PoolConnection,
  tenantId: string,
  managerId: string,
  packageId: string | null,
  grossAmount: number,
  currency: string
): Promise<CommissionSplit> {
  const gross = round2(Math.max(0, grossAmount));
  const cur = String(currency ?? "USD").slice(0, 8).toUpperCase();
  if (!(await hasTable(pool, "users"))) {
    return { grossAmount: gross, commissionAmount: 0, companyAmount: gross, currency: cur, rule: "none" };
  }

  if (packageId && (await hasTable(pool, "manager_package_commission_rules"))) {
    const [rules] = await poolOrConn.query<RowDataPacket[]>(
      `SELECT commission_type, commission_value FROM manager_package_commission_rules
       WHERE tenant_id = ? AND manager_id = ? AND package_id = ? LIMIT 1`,
      [tenantId, managerId, packageId]
    );
    const rp = rules[0];
    if (rp) {
      const ct = String(rp.commission_type ?? "none").toLowerCase();
      const cv = Number(rp.commission_value ?? 0);
      if (ct === "percentage") {
        const comm = round2((gross * cv) / 100);
        return {
          grossAmount: gross,
          commissionAmount: comm,
          companyAmount: round2(gross - comm),
          currency: cur,
          rule: "package_override",
        };
      }
      if (ct === "fixed") {
        const comm = round2(Math.min(gross, cv));
        return {
          grossAmount: gross,
          commissionAmount: comm,
          companyAmount: round2(gross - comm),
          currency: cur,
          rule: "package_override",
        };
      }
    }
  }

  const [users] = await poolOrConn.query<RowDataPacket[]>(
    `SELECT commission_type, commission_value FROM users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [managerId, tenantId]
  );
  const u = users[0];
  const ct = String(u?.commission_type ?? "none").toLowerCase();
  const cv = Number(u?.commission_value ?? 0);
  if (ct === "percentage") {
    const comm = round2((gross * cv) / 100);
    return {
      grossAmount: gross,
      commissionAmount: comm,
      companyAmount: round2(gross - comm),
      currency: cur,
      rule: "user_percentage",
    };
  }
  if (ct === "fixed") {
    const comm = round2(Math.min(gross, cv));
    return {
      grossAmount: gross,
      commissionAmount: comm,
      companyAmount: round2(gross - comm),
      currency: cur,
      rule: "user_fixed",
    };
  }
  return { grossAmount: gross, commissionAmount: 0, companyAmount: gross, currency: cur, rule: "none" };
}

export async function insertCommissionEntry(
  conn: PoolConnection,
  input: {
    tenantId: string;
    managerId: string;
    sourceType: string;
    sourceId: string | null;
    subscriberId: string | null;
    packageId: string | null;
    split: CommissionSplit;
    ledgerEntryId: string | null;
  }
): Promise<void> {
  if (!(await hasTable(pool, "manager_commission_entries"))) return;
  if (input.split.commissionAmount <= 0) return;
  const id = randomUUID();
  await conn.execute(
    `INSERT INTO manager_commission_entries
      (id, tenant_id, manager_id, source_type, source_id, subscriber_id, package_id,
       gross_amount, commission_amount, company_amount, currency, ledger_entry_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.tenantId,
      input.managerId,
      input.sourceType,
      input.sourceId,
      input.subscriberId,
      input.packageId,
      input.split.grossAmount,
      input.split.commissionAmount,
      input.split.companyAmount,
      input.split.currency,
      input.ledgerEntryId,
    ]
  );
}

/** Per batch — uses commission_prepaid_fixed when set. */
export async function resolvePrepaidCommission(
  poolOrConn: Pool | PoolConnection,
  tenantId: string,
  managerId: string,
  totalPrintedValue: number,
  currency: string
): Promise<CommissionSplit> {
  const gross = round2(Math.max(0, totalPrintedValue));
  const cur = String(currency ?? "USD").slice(0, 8).toUpperCase();
  const [users] = await poolOrConn.query<RowDataPacket[]>(
    `SELECT commission_prepaid_fixed FROM users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [managerId, tenantId]
  );
  const u = users[0];
  const prepaidFix = u?.commission_prepaid_fixed != null ? Number(u.commission_prepaid_fixed) : null;
  if (prepaidFix != null && Number.isFinite(prepaidFix) && prepaidFix > 0) {
    const comm = round2(Math.min(gross, prepaidFix));
    return {
      grossAmount: gross,
      commissionAmount: comm,
      companyAmount: round2(gross - comm),
      currency: cur,
      rule: "user_fixed",
    };
  }
  return resolveRenewalCommission(poolOrConn, tenantId, managerId, null, gross, cur);
}
