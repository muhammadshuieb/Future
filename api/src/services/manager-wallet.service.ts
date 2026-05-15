import type { PoolConnection } from "mysql2/promise";
import { withTransaction } from "../db/transaction.js";
import {
  chargeManagerLedgerWithConnection,
  type ManagerWalletLedgerType,
} from "./manager-wallet-ledger.service.js";

export { ManagerBalanceError } from "./manager-wallet-ledger.service.js";

type ChargeInput = {
  tenantId: string;
  staffId: string;
  amount: number;
  currency?: string;
  reason: string;
  subscriberId?: string;
  note?: string;
};

function reasonToLedgerType(reason: string): ManagerWalletLedgerType {
  const r = String(reason ?? "").toLowerCase();
  if (r.includes("prepaid") || r.includes("card")) return "prepaid_card_print";
  if (r.includes("renewal") || r.includes("subscription")) return "subscription_renewal";
  return "invoice_payment";
}

export async function chargeManagerWallet(
  input: ChargeInput
): Promise<{ balance: number; ledger_id?: string }> {
  return withTransaction((conn) => chargeManagerWalletWithConnection(conn, input));
}

export async function chargeManagerWalletWithConnection(
  conn: PoolConnection,
  input: ChargeInput
): Promise<{ balance: number; ledger_id?: string }> {
  const out = await chargeManagerLedgerWithConnection(conn, {
    tenantId: input.tenantId,
    managerId: input.staffId,
    amount: input.amount,
    type: reasonToLedgerType(input.reason),
    currency: input.currency ?? "USD",
    referenceType: input.reason,
    referenceId: input.subscriberId ?? input.note ?? null,
    description: input.note ?? input.reason,
    createdBy: input.staffId,
    meta: { subscriber_id: input.subscriberId ?? null, reason: input.reason },
  });
  return { balance: out.balance_after, ledger_id: out.ledger_id || undefined };
}
