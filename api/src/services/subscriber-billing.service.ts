import { randomUUID } from "crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { hasTable } from "../db/schemaGuards.js";
import { resolveExpirationAfterPayment } from "../lib/billing.js";
import { formatExpirationForDb } from "../lib/expiration-date.js";
import { withTransaction } from "../db/transaction.js";
import { chargeManagerWalletWithConnection, ManagerBalanceError } from "./manager-wallet.service.js";
import { sendSubscriberBillingDemandWhatsApp } from "./whatsapp.service.js";

export type BillingContext = {
  subscriber: {
    id: string;
    username: string;
    package_id: string | null;
    package_name: string | null;
    package_price: number;
    currency: string;
    billing_period_days: number;
    created_at: string | null;
    start_date: string | null;
    expiration_date: string | null;
  };
  open_invoice: {
    id: string;
    invoice_no: string;
    amount: number;
    currency: string;
    status: string;
    balance: number;
    paid_sum: number;
  } | null;
  arrears_total: number;
  unpaid_invoices: Array<{
    id: string;
    invoice_no: string;
    amount: number;
    currency: string;
    balance: number;
    status: string;
    issue_date: string | null;
  }>;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type SqlExec = Pick<Pool, "query">;

async function invoiceBalanceRows(
  exec: SqlExec,
  tenantId: string,
  subscriberId: string,
  schemaPool: Pool
): Promise<
  Array<{
    id: string;
    invoice_no: string;
    amount: number;
    currency: string;
    status: string;
    issue_date: string | null;
    due_date: string | null;
    paid_sum: number;
    balance: number;
  }>
> {
  if (!(await hasTable(schemaPool, "invoices"))) return [];
  const [rows] = await exec.query<RowDataPacket[]>(
    `SELECT i.id, i.invoice_no, i.amount, i.currency, i.status, i.issue_date, i.due_date,
            COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.tenant_id = i.tenant_id), 0) AS paid_sum
     FROM invoices i
     WHERE i.tenant_id = ? AND i.subscriber_id = ?
       AND LOWER(i.status) <> 'paid'
     ORDER BY i.due_date ASC, i.issue_date ASC`,
    [tenantId, subscriberId]
  );
  return rows.map((r) => {
    const amount = Number(r.amount ?? 0);
    const paid = Number(r.paid_sum ?? 0);
    return {
      id: String(r.id),
      invoice_no: String(r.invoice_no ?? ""),
      amount,
      currency: String(r.currency ?? "USD").toUpperCase(),
      status: String(r.status ?? ""),
      issue_date: r.issue_date != null ? String(r.issue_date).slice(0, 10) : null,
      due_date: r.due_date != null ? String(r.due_date).slice(0, 10) : null,
      paid_sum: paid,
      balance: round2(Math.max(0, amount - paid)),
    };
  });
}

export async function getBillingContext(pool: Pool, tenantId: string, subscriberId: string): Promise<BillingContext | null> {
  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.username, s.package_id, s.created_at, s.expiration_date,
            p.name AS package_name, p.price AS package_price, p.currency, p.billing_period_days
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     WHERE s.id = ? AND s.tenant_id = ?
     LIMIT 1`,
    [subscriberId, tenantId]
  );
  const s = subRows[0];
  if (!s) return null;
  const invs = await invoiceBalanceRows(pool, tenantId, subscriberId, pool);
  const withBal = invs.filter((i) => i.balance > 0.009);
  const open = withBal[0] ?? null;
  const arrears_total = round2(withBal.reduce((sum, i) => sum + i.balance, 0));
  return {
    subscriber: {
      id: String(s.id),
      username: String(s.username ?? ""),
      package_id: s.package_id != null ? String(s.package_id) : null,
      package_name: s.package_name != null ? String(s.package_name) : null,
      package_price: Number(s.package_price ?? 0),
      currency: String(s.currency ?? "USD").toUpperCase().slice(0, 8),
      billing_period_days: Number(s.billing_period_days ?? 30),
      created_at: s.created_at != null ? String(s.created_at) : null,
      start_date: s.created_at != null ? String(s.created_at) : null,
      expiration_date: s.expiration_date != null ? String(s.expiration_date) : null,
    },
    open_invoice: open
      ? {
          id: open.id,
          invoice_no: open.invoice_no,
          amount: open.amount,
          currency: open.currency,
          status: open.status,
          balance: open.balance,
          paid_sum: open.paid_sum,
        }
      : null,
    arrears_total,
    unpaid_invoices: withBal.map((i) => ({
      id: i.id,
      invoice_no: i.invoice_no,
      amount: i.amount,
      currency: i.currency,
      balance: i.balance,
      status: i.status,
      issue_date: i.issue_date,
    })),
  };
}

export async function getFinancialReportJson(pool: Pool, tenantId: string, subscriberId: string) {
  const ctx = await getBillingContext(pool, tenantId, subscriberId);
  if (!ctx) return null;
  const [sub] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.username, s.expiration_date, p.name AS package_name, p.price, p.currency
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     WHERE s.id = ? AND s.tenant_id = ? LIMIT 1`,
    [subscriberId, tenantId]
  );
  const row = sub[0];
  const allPaid: RowDataPacket[] = [];
  if (await hasTable(pool, "invoices")) {
    const [paidInv] = await pool.query<RowDataPacket[]>(
      `SELECT i.invoice_no, i.amount, i.currency, i.status, i.issue_date, i.due_date,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.tenant_id = i.tenant_id), 0) AS paid_sum
       FROM invoices i
       WHERE i.tenant_id = ? AND i.subscriber_id = ?
       ORDER BY i.issue_date DESC
       LIMIT 200`,
      [tenantId, subscriberId]
    );
    allPaid.push(...paidInv);
  }
  const invoices = allPaid.map((i) => {
    const amount = Number(i.amount ?? 0);
    const paid = Number(i.paid_sum ?? 0);
    return {
      invoice_no: String(i.invoice_no ?? ""),
      amount,
      currency: String(i.currency ?? "USD"),
      status: String(i.status ?? ""),
      issue_date: i.issue_date != null ? String(i.issue_date).slice(0, 10) : null,
      due_date: i.due_date != null ? String(i.due_date).slice(0, 10) : null,
      paid_sum: paid,
      balance: round2(Math.max(0, amount - paid)),
    };
  });
  let payments: Array<{ invoice_no: string; amount: number; currency: string; method: string; paid_at: string | null }> =
    [];
  if (await hasTable(pool, "payments")) {
    const [pays] = await pool.query<RowDataPacket[]>(
      `SELECT py.amount, py.currency, py.method, py.paid_at, i.invoice_no
       FROM payments py
       JOIN invoices i ON i.id = py.invoice_id AND i.tenant_id = py.tenant_id
       WHERE py.tenant_id = ? AND i.subscriber_id = ?
       ORDER BY py.paid_at DESC
       LIMIT 200`,
      [tenantId, subscriberId]
    );
    payments = pays.map((p) => ({
      invoice_no: String(p.invoice_no ?? ""),
      amount: Number(p.amount ?? 0),
      currency: String(p.currency ?? "USD"),
      method: String(p.method ?? "manual"),
      paid_at: p.paid_at != null ? String(p.paid_at) : null,
    }));
  }
  const total_invoiced = invoices.reduce((s, i) => s + i.amount, 0);
  const total_recorded_payments = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding_balance = round2(
    invoices.filter((i) => String(i.status).toLowerCase() !== "paid").reduce((s, i) => s + i.balance, 0)
  );
  return {
    generated_at: new Date().toISOString(),
    subscriber: {
      id: String(row?.id ?? subscriberId),
      username: String(row?.username ?? ctx.subscriber.username),
      subscription_since: ctx.subscriber.created_at,
      expiration_date: ctx.subscriber.expiration_date,
      current_package: row?.package_name != null ? String(row.package_name) : null,
      list_price: Number(row?.price ?? ctx.subscriber.package_price ?? 0),
      currency: String(row?.currency ?? ctx.subscriber.currency ?? "USD"),
    },
    invoices,
    payments,
    totals: {
      total_invoiced: round2(total_invoiced),
      total_recorded_payments: round2(total_recorded_payments),
      outstanding_balance,
    },
  };
}

export async function getSubscriberStatement(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  from?: string | null,
  to?: string | null
) {
  const base = await getFinancialReportJson(pool, tenantId, subscriberId);
  if (!base) return null;
  const [uname] = await pool.query<RowDataPacket[]>(
    `SELECT username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [subscriberId, tenantId]
  );
  const username = String(uname[0]?.username ?? "");
  let sessions: RowDataPacket[] = [];
  if (username && (await hasTable(pool, "radacct"))) {
    const args: unknown[] = [username];
    let sql = `SELECT radacctid, acctsessionid, nasipaddress, framedipaddress, callingstationid,
                      acctstarttime, acctstoptime, acctsessiontime, acctterminatecause,
                      acctinputoctets, acctoutputoctets
               FROM radacct WHERE username = ?`;
    if (from) {
      sql += ` AND (acctstarttime >= ? OR acctstoptime >= ?)`;
      args.push(from, from);
    }
    if (to) {
      sql += ` AND (acctstarttime < DATE_ADD(?, INTERVAL 1 DAY))`;
      args.push(to);
    }
    sql += ` ORDER BY acctstarttime DESC LIMIT 500`;
    const [sr] = await pool.query<RowDataPacket[]>(sql, args);
    sessions = sr;
  }
  let whatsapp: RowDataPacket[] = [];
  if (await hasTable(pool, "whatsapp_message_logs")) {
    const [wr] = await pool.query<RowDataPacket[]>(
      `SELECT template_key, status, message_body, created_at
       FROM whatsapp_message_logs
       WHERE tenant_id = ? AND subscriber_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
      [tenantId, subscriberId]
    );
    whatsapp = wr;
  }
  return { ...base, period: { from: from ?? null, to: to ?? null }, sessions, whatsapp_logs: whatsapp };
}

const recordBody = z.object({
  pay_timing: z.enum(["immediate", "defer"]),
  payment_method: z.enum(["manual", "cash", "bank_transfer", "wallet", "card", "other"]).optional(),
  package_id: z.string().min(1).optional(),
  invoice_amount: z.number().positive(),
  currency: z.enum(["USD", "SYP", "TRY"]),
  due_date: z.string().optional(),
  send_whatsapp_reminder: z.boolean().optional(),
  pay_amount: z.number().positive().optional(),
  payment_allocations: z.array(z.object({ invoice_id: z.string().min(1), amount: z.number().positive() })).optional(),
  /** When set on full payment, overrides package-day extension for subscriber expiration_date. */
  subscription_expires_at: z.string().min(1).optional(),
});

export type RecordPackagePaymentInput = z.infer<typeof recordBody>;

async function applyExpirationAfterFullPayment(
  conn: PoolConnection,
  tenantId: string,
  subscriberId: string,
  billingDays: number,
  explicitRaw?: string
): Promise<
  | {
      previous_expiration_date: string | null;
      new_expiration_date: string;
      used_explicit_date: boolean;
    }
  | { error: "invalid_expiration" }
> {
  const [ex] = await conn.query<RowDataPacket[]>(
    `SELECT expiration_date FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [subscriberId, tenantId]
  );
  const prevRaw = ex[0]?.expiration_date != null ? String(ex[0].expiration_date) : null;
  let nextExp: Date;
  try {
    nextExp = resolveExpirationAfterPayment(explicitRaw, prevRaw, billingDays).next;
  } catch {
    return { error: "invalid_expiration" };
  }
  await conn.execute(`UPDATE subscribers SET expiration_date = ?, status = 'active' WHERE id = ? AND tenant_id = ?`, [
    formatExpirationForDb(nextExp),
    subscriberId,
    tenantId,
  ]);
  return {
    previous_expiration_date: prevRaw,
    new_expiration_date: formatExpirationForDb(nextExp),
    used_explicit_date: Boolean(explicitRaw?.trim()),
  };
}

async function packageBillingPeriodDays(
  conn: PoolConnection,
  tenantId: string,
  subscriberId: string
): Promise<number> {
  const [pRow] = await conn.query<RowDataPacket[]>(
    `SELECT billing_period_days FROM packages p
     JOIN subscribers s ON s.package_id = p.id AND s.tenant_id = p.tenant_id
     WHERE s.id = ? AND s.tenant_id = ? LIMIT 1`,
    [subscriberId, tenantId]
  );
  return Number(pRow[0]?.billing_period_days ?? 30);
}

export async function recordPackagePayment(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  body: RecordPackagePaymentInput,
  auth: { role: string; sub: string }
): Promise<
  | {
      ok: true;
      deferred?: boolean;
      partial?: boolean;
      allocation?: boolean;
      payment_id?: string;
      invoice_id?: string;
      expiration_audit?: {
        previous_expiration_date: string | null;
        new_expiration_date: string;
        used_explicit_date: boolean;
      };
    }
  | { ok: false; error: string }
> {
  const parsed = recordBody.safeParse(body);
  if (!parsed.success) return { ok: false, error: "invalid_body" };

  const b = parsed.data;
  const method = b.payment_method ?? "manual";

  try {
    if (b.pay_timing === "defer") {
      const id = randomUUID();
      const invNo = `INV-${Date.now()}`;
      const today = new Date().toISOString().slice(0, 10);
      const due = b.due_date?.trim() || today;
      await pool.execute(
        `INSERT INTO invoices (id, tenant_id, subscriber_id, period, invoice_no, issue_date, due_date, amount, currency, status, meta)
         VALUES (?, ?, ?, 'one_time', ?, ?, ?, ?, ?, 'sent', NULL)`,
        [id, tenantId, subscriberId, invNo, today, due, b.invoice_amount, b.currency]
      );
      if (b.package_id) {
        await pool.execute(`UPDATE subscribers SET package_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`, [
          b.package_id,
          subscriberId,
          tenantId,
        ]);
      }
      if (b.send_whatsapp_reminder) {
        await sendSubscriberBillingDemandWhatsApp({ tenantId, subscriberId, headline: "تذكير بفاتورة جديدة" }).catch(
          () => {}
        );
      }
      return { ok: true, deferred: true };
    }

    const result = await withTransaction(async (conn) => {
      const [subRows] = await conn.query<RowDataPacket[]>(
        `SELECT id, username, package_id, expiration_date FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [subscriberId, tenantId]
      );
      if (!subRows[0]) return { kind: "not_found" as const };
      if (b.package_id) {
        await conn.execute(`UPDATE subscribers SET package_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`, [
          b.package_id,
          subscriberId,
          tenantId,
        ]);
      }

      if (b.payment_allocations && b.payment_allocations.length > 0) {
        let partial = false;
        let fullyPaidInvoices = 0;
        for (const al of b.payment_allocations) {
          const [invRows] = await conn.query<RowDataPacket[]>(
            `SELECT id, amount, status, meta FROM invoices WHERE id = ? AND tenant_id = ? AND subscriber_id = ? LIMIT 1 FOR UPDATE`,
            [al.invoice_id, tenantId, subscriberId]
          );
          const inv = invRows[0];
          if (!inv) return { kind: "bad_invoice" as const };
          const paidSoFar = await sumPayments(conn, al.invoice_id, tenantId);
          const amount = Number(inv.amount ?? 0);
          const balance = round2(Math.max(0, amount - paidSoFar));
          if (al.amount > balance + 0.01) return { kind: "overpay" as const };
          if (auth.role === "manager") {
            await chargeManagerWalletWithConnection(conn, {
              tenantId,
              staffId: auth.sub,
              amount: al.amount,
              currency: b.currency,
              reason: "invoice_payment_allocation",
              subscriberId,
              note: String(inv.id),
            });
          }
          const payId = randomUUID();
          await conn.execute(
            `INSERT INTO payments (id, tenant_id, invoice_id, subscriber_id, amount, currency, method, status, paid_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?)`,
            [payId, tenantId, al.invoice_id, subscriberId, al.amount, b.currency.slice(0, 8), method, new Date()]
          );
          const newPaid = paidSoFar + al.amount;
          if (newPaid + 0.009 >= amount) {
            await conn.execute(`UPDATE invoices SET status = 'paid' WHERE id = ? AND tenant_id = ?`, [al.invoice_id, tenantId]);
            fullyPaidInvoices += 1;
          } else {
            partial = true;
          }
        }
        if (fullyPaidInvoices > 0) {
          const periodDays = await packageBillingPeriodDays(conn, tenantId, subscriberId);
          const extension = await applyExpirationAfterFullPayment(
            conn,
            tenantId,
            subscriberId,
            periodDays * fullyPaidInvoices,
            b.subscription_expires_at
          );
          if ("error" in extension) return { kind: "invalid_expiration" as const };
          return {
            kind: "ok" as const,
            allocation: true,
            partial,
            expiration_audit: extension,
          };
        }
        return { kind: "ok" as const, allocation: true, partial };
      }

      const invs = await invoiceRowsForUpdate(conn, pool, tenantId, subscriberId);
      const open = invs.find((i) => i.balance > 0.009);
      let invoiceId = open?.id;
      if (!invoiceId) {
        invoiceId = randomUUID();
        const invNo = `INV-${Date.now()}`;
        const today = new Date().toISOString().slice(0, 10);
        await conn.execute(
          `INSERT INTO invoices (id, tenant_id, subscriber_id, period, invoice_no, issue_date, due_date, amount, currency, status, meta)
           VALUES (?, ?, ?, 'one_time', ?, ?, ?, ?, ?, 'sent', NULL)`,
          [invoiceId, tenantId, subscriberId, invNo, today, today, b.invoice_amount, b.currency]
        );
      }
      const [invLock] = await conn.query<RowDataPacket[]>(
        `SELECT id, amount, status FROM invoices WHERE id = ? AND tenant_id = ? FOR UPDATE`,
        [invoiceId, tenantId]
      );
      const invRow = invLock[0];
      if (!invRow) return { kind: "not_found" as const };
      const paidSoFar = await sumPayments(conn, invoiceId!, tenantId);
      const invAmount = Number(invRow.amount ?? 0);
      const balance = round2(Math.max(0, invAmount - paidSoFar));
      const payTarget = b.pay_amount != null ? round2(b.pay_amount) : balance;
      if (payTarget <= 0) return { kind: "nothing_to_pay" as const };
      if (payTarget > balance + 0.01) return { kind: "overpay" as const };
      if (auth.role === "manager") {
        await chargeManagerWalletWithConnection(conn, {
          tenantId,
          staffId: auth.sub,
          amount: payTarget,
          currency: b.currency,
          reason: "invoice_mark_paid_partial",
          subscriberId,
          note: String(invoiceId),
        });
      }
      const payId = randomUUID();
      await conn.execute(
        `INSERT INTO payments (id, tenant_id, invoice_id, subscriber_id, amount, currency, method, status, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?)`,
        [payId, tenantId, invoiceId, subscriberId, payTarget, b.currency.slice(0, 8), method, new Date()]
      );
      const newPaid = paidSoFar + payTarget;
      let partial = false;
      if (newPaid + 0.009 >= invAmount) {
        await conn.execute(`UPDATE invoices SET status = 'paid' WHERE id = ? AND tenant_id = ?`, [invoiceId, tenantId]);
        const days = await packageBillingPeriodDays(conn, tenantId, subscriberId);
        const extension = await applyExpirationAfterFullPayment(
          conn,
          tenantId,
          subscriberId,
          days,
          b.subscription_expires_at
        );
        if ("error" in extension) return { kind: "invalid_expiration" as const };
        return {
          kind: "ok" as const,
          partial,
          payment_id: payId,
          invoice_id: invoiceId!,
          expiration_audit: extension,
        };
      } else {
        partial = true;
      }
      return { kind: "ok" as const, partial, payment_id: payId, invoice_id: invoiceId! };
    });

    if (result.kind === "not_found") return { ok: false, error: "not_found" };
    if (result.kind === "bad_invoice") return { ok: false, error: "invalid_invoice" };
    if (result.kind === "overpay") return { ok: false, error: "payment_exceeds_balance" };
    if (result.kind === "nothing_to_pay") return { ok: false, error: "nothing_to_pay" };
    if (result.kind === "invalid_expiration") return { ok: false, error: "invalid_expiration" };
    const r = result as {
      partial?: boolean;
      allocation?: boolean;
      payment_id?: string;
      invoice_id?: string;
      expiration_audit?: {
        previous_expiration_date: string | null;
        new_expiration_date: string;
        used_explicit_date: boolean;
      };
    };
    return {
      ok: true,
      partial: Boolean(r.partial),
      allocation: Boolean(r.allocation),
      payment_id: r.payment_id,
      invoice_id: r.invoice_id,
      expiration_audit: r.expiration_audit,
    };
  } catch (e) {
    if (e instanceof ManagerBalanceError && e.code === "insufficient_balance") {
      return { ok: false, error: "insufficient_manager_balance" };
    }
    console.error("[recordPackagePayment]", e);
    return { ok: false, error: "payment_failed" };
  }
}

async function sumPayments(conn: import("mysql2/promise").PoolConnection, invoiceId: string, tenantId: string): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ? AND tenant_id = ?`,
    [invoiceId, tenantId]
  );
  return Number(rows[0]?.s ?? 0);
}

async function invoiceRowsForUpdate(
  conn: PoolConnection,
  schemaPool: Pool,
  tenantId: string,
  subscriberId: string
): Promise<Array<{ id: string; balance: number }>> {
  const rows = await invoiceBalanceRows(conn, tenantId, subscriberId, schemaPool);
  return rows.map((r) => ({ id: r.id, balance: r.balance }));
}
