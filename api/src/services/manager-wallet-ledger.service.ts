import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { hasTable } from "../db/schemaGuards.js";
import { pool } from "../db/pool.js";

export class ManagerBalanceError extends Error {
  code: "insufficient_balance" | "staff_not_found";
  constructor(code: "insufficient_balance" | "staff_not_found", message: string) {
    super(message);
    this.code = code;
  }
}

export type ManagerWalletLedgerType =
  | "topup"
  | "subscription_renewal"
  | "invoice_payment"
  | "prepaid_card_print"
  | "commission"
  | "settlement_payment"
  | "manual_adjustment"
  | "refund"
  | "reversal";

export type LedgerMutationInput = {
  tenantId: string;
  managerId: string;
  /** Negative reduces wallet_balance (money to company). Positive increases (topup). */
  delta: number;
  type: ManagerWalletLedgerType;
  currency: string;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  createdBy?: string | null;
  meta?: unknown;
};

/**
 * Apply a signed delta to manager wallet with FOR UPDATE lock, append immutable ledger row.
 * Must be called inside an active transaction.
 */
export async function applyManagerWalletLedgerWithConnection(
  conn: PoolConnection,
  input: LedgerMutationInput
): Promise<{ balance_before: number; balance_after: number; ledger_id: string }> {
  if (!(await hasTable(pool, "users"))) {
    throw new ManagerBalanceError("staff_not_found", "manager_not_found");
  }
  const hasLedger = await hasTable(pool, "manager_wallet_ledger");
  const mid = String(input.managerId ?? "").trim();
  if (!mid) throw new ManagerBalanceError("staff_not_found", "manager_not_found");

  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT wallet_balance, COALESCE(allowed_negative_balance, 0) AS allowed_negative_balance,
            CASE WHEN status = 'active' THEN 1 ELSE 0 END AS active
     FROM users
     WHERE id = ? AND tenant_id = ?
     LIMIT 1 FOR UPDATE`,
    [mid, input.tenantId]
  );
  const row = rows[0];
  if (!row || Number(row.active ?? 1) !== 1) {
    throw new ManagerBalanceError("staff_not_found", "manager_not_found");
  }
  const balanceBefore = Number(row.wallet_balance ?? 0);
  const allowedNegative = Math.max(0, Number(row.allowed_negative_balance ?? 0));
  const delta = Number(input.delta);
  const next = balanceBefore + delta;
  if (next < -allowedNegative) {
    throw new ManagerBalanceError("insufficient_balance", "insufficient_manager_balance");
  }

  const ledgerId = randomUUID();
  if (hasLedger) {
    await conn.execute(
      `INSERT INTO manager_wallet_ledger
        (id, tenant_id, manager_id, type, amount, balance_before, balance_after, currency, reference_type, reference_id, description, created_by, meta)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ledgerId,
        input.tenantId,
        mid,
        input.type,
        delta,
        balanceBefore,
        next,
        String(input.currency ?? "USD").slice(0, 8).toUpperCase(),
        input.referenceType ?? null,
        input.referenceId ?? null,
        input.description ?? null,
        input.createdBy ?? null,
        input.meta != null ? JSON.stringify(input.meta) : null,
      ]
    );
  }

  await conn.execute(`UPDATE users SET wallet_balance = ? WHERE id = ? AND tenant_id = ?`, [
    next,
    mid,
    input.tenantId,
  ]);

  return { balance_before: balanceBefore, balance_after: next, ledger_id: ledgerId };
}

/**
 * Backward-compatible: charge wallet by positive amount (deduct). Uses delta = -amount.
 */
export async function chargeManagerLedgerWithConnection(
  conn: PoolConnection,
  input: Omit<LedgerMutationInput, "delta"> & {
    amount: number;
  }
): Promise<{ balance_before: number; balance_after: number; ledger_id: string }> {
  const amt = Number(input.amount || 0);
  if (amt <= 0) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT wallet_balance FROM users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [input.managerId, input.tenantId]
    );
    const b = Number(rows[0]?.wallet_balance ?? 0);
    return { balance_before: b, balance_after: b, ledger_id: "" };
  }
  return applyManagerWalletLedgerWithConnection(conn, {
    ...input,
    delta: -amt,
  });
}
