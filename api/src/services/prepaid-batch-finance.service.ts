import type { RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import { hasColumn } from "../db/schemaGuards.js";
import { pool } from "../db/pool.js";
import { chargeManagerLedgerWithConnection } from "./manager-wallet-ledger.service.js";
import { insertCommissionEntry, resolvePrepaidCommission } from "./manager-commission.service.js";

/** Wallet charge + commission + obligation for prepaid batch (manager only). */
export async function applyManagerPrepaidBatchFinancials(
  conn: PoolConnection,
  schemaPool: Pool,
  tenantId: string,
  managerId: string,
  packageId: string | null,
  grossTotal: number,
  currency: string,
  batchId: string,
  createdBy: string
): Promise<{ ledger_id: string }> {
  const gross = Math.max(0, Number(grossTotal));
  if (gross <= 0) return { ledger_id: "" };
  const ch = await chargeManagerLedgerWithConnection(conn, {
    tenantId,
    managerId,
    amount: gross,
    type: "prepaid_card_print",
    currency,
    referenceType: "prepaid_card_batch",
    referenceId: batchId,
    description: "prepaid_card_batch",
    createdBy,
    meta: { batch_id: batchId },
  });
  const split = await resolvePrepaidCommission(conn, tenantId, managerId, gross, currency);
  await insertCommissionEntry(conn, {
    tenantId,
    managerId,
    sourceType: "prepaid_batch",
    sourceId: batchId,
    subscriberId: null,
    packageId,
    split,
    ledgerEntryId: ch.ledger_id || null,
  });
  if (await hasColumn(schemaPool, "users", "manager_obligation_balance")) {
    await conn.execute(
      `UPDATE users SET manager_obligation_balance = COALESCE(manager_obligation_balance, 0) + ? WHERE id = ? AND tenant_id = ?`,
      [split.companyAmount, managerId, tenantId]
    );
  }
  return { ledger_id: ch.ledger_id };
}

export async function assertManagerCanPrintCards(
  conn: PoolConnection,
  tenantId: string,
  managerId: string
): Promise<void> {
  if (!(await hasColumn(pool, "users", "can_print_prepaid_cards"))) return;
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT can_print_prepaid_cards FROM users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [managerId, tenantId]
  );
  if (rows[0] && Number(rows[0].can_print_prepaid_cards ?? 1) === 0) {
    throw new Error("prepaid_print_disabled");
  }
}

export async function assertManagerCanSellCards(
  conn: PoolConnection,
  tenantId: string,
  managerId: string
): Promise<void> {
  if (!(await hasColumn(pool, "users", "can_sell_prepaid_cards"))) return;
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT can_sell_prepaid_cards FROM users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [managerId, tenantId]
  );
  if (rows[0] && Number(rows[0].can_sell_prepaid_cards ?? 1) === 0) {
    throw new Error("prepaid_sell_disabled");
  }
}
