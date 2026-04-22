import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";

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

async function addTransaction(
  conn: PoolConnection,
  input: {
    tenantId: string;
    staffId: string;
    actorId: string | null;
    amount: number;
    type: string;
    note: string | null;
    subscriberId: string | null;
    currency: string | null;
  }
) {
  await conn.execute(
    `INSERT INTO manager_wallet_transactions
      (id, tenant_id, staff_id, actor_staff_id, amount, tx_type, note, related_subscriber_id, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.tenantId,
      input.staffId,
      input.actorId,
      input.amount,
      input.type,
      input.note,
      input.subscriberId,
      input.currency,
    ]
  );
}

export async function chargeManagerWallet(input: ChargeInput): Promise<{ balance: number }> {
  return withTransaction((conn) => chargeManagerWalletWithConnection(conn, input));
}

export async function chargeManagerWalletWithConnection(
  conn: PoolConnection,
  input: ChargeInput
): Promise<{ balance: number }> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id, wallet_balance FROM staff_users
     WHERE id = ? AND tenant_id = ? AND role = 'manager' AND active = 1
     LIMIT 1 FOR UPDATE`,
    [input.staffId, input.tenantId]
  );
  const row = rows[0];
  if (!row) {
    throw new ManagerBalanceError("staff_not_found", "manager_not_found");
  }
  const current = Number(row.wallet_balance ?? 0);
  const amount = Number(input.amount || 0);
  if (amount <= 0) {
    return { balance: current };
  }
  if (current < amount) {
    throw new ManagerBalanceError("insufficient_balance", "insufficient_manager_balance");
  }
  const next = current - amount;
  await conn.execute(`UPDATE staff_users SET wallet_balance = ? WHERE id = ?`, [next, input.staffId]);
  await addTransaction(conn, {
    tenantId: input.tenantId,
    staffId: input.staffId,
    actorId: input.staffId,
    amount: -amount,
    type: "renewal_charge",
    note: input.note ?? input.reason,
    subscriberId: input.subscriberId ?? null,
    currency: input.currency ?? null,
  });
  return { balance: next };
}
