import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { hasTable } from "../db/schemaGuards.js";

export class ManagerBalanceError extends Error {
  code: "insufficient_balance" | "staff_not_found";
  constructor(code: "insufficient_balance" | "staff_not_found", message: string) {
    super(message);
    this.code = code;
  }
}

type ChargeInput = {
  tenantId: string;
  staffId: string;
  amount: number;
  currency?: string;
  reason: string;
  subscriberId?: string;
  note?: string;
};

export async function chargeManagerWallet(input: ChargeInput): Promise<{ balance: number }> {
  return withTransaction((conn) => chargeManagerWalletWithConnection(conn, input));
}

export async function chargeManagerWalletWithConnection(
  conn: PoolConnection,
  input: ChargeInput
): Promise<{ balance: number }> {
  if (!(await hasTable(pool, "rm_managers"))) {
    throw new ManagerBalanceError("staff_not_found", "manager_not_found");
  }
  const managerName = String(input.staffId ?? "").replace(/^rm:/i, "").trim();
  if (!managerName) {
    throw new ManagerBalanceError("staff_not_found", "manager_not_found");
  }
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT managername, balance AS wallet_balance, COALESCE(allowed_negative_balance, 0) AS allowed_negative_balance,
            COALESCE(enablemanager, 1) AS active
     FROM rm_managers
     WHERE managername = ?
     LIMIT 1 FOR UPDATE`,
    [managerName]
  );
  const row = rows[0];
  if (!row || Number(row.active ?? 1) !== 1) {
    throw new ManagerBalanceError("staff_not_found", "manager_not_found");
  }
  const current = Number(row.wallet_balance ?? 0);
  const allowedNegative = Math.max(0, Number(row.allowed_negative_balance ?? 0));
  const amount = Number(input.amount || 0);
  if (amount <= 0) {
    return { balance: current };
  }
  if (current - amount < -allowedNegative) {
    throw new ManagerBalanceError("insufficient_balance", "insufficient_manager_balance");
  }
  const next = current - amount;
  await conn.execute(`UPDATE rm_managers SET balance = ? WHERE managername = ?`, [next, managerName]);
  return { balance: next };
}
