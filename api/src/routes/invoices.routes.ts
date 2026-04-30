import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { extendSubscriptionByDaysNoon } from "../lib/billing.js";
import { RadiusService } from "../services/radius.service.js";
import { pushRadiusForSubscriber } from "../lib/subscriber-radius.js";
import { requestHasManagerPermission } from "../lib/manager-permissions.js";
import {
  chargeManagerWalletWithConnection,
  ManagerBalanceError,
} from "../services/manager-wallet.service.js";
import { withTransaction } from "../db/transaction.js";
import { emitEvent } from "../events/eventBus.js";
import { Events } from "../events/eventTypes.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const radius = new RadiusService(pool);
const currencySchema = z.enum(["USD", "SYP", "TRY"]);

router.use(requireAuth);

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const query = z.object({ subscriber_id: z.string().uuid().optional() }).safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const args: unknown[] = [tenantId];
  let sql = `SELECT * FROM invoices WHERE tenant_id = ?`;
  if (query.data.subscriber_id) {
    sql += ` AND subscriber_id = ?`;
    args.push(query.data.subscriber_id);
  }
  sql += ` ORDER BY issue_date DESC LIMIT 500`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, args);
  res.json({ items: rows });
});

const invBody = z.object({
  subscriber_id: z.string().uuid(),
  period: z.enum(["monthly", "yearly", "one_time"]).optional(),
  amount: z.number(),
  currency: currencySchema.optional(),
});

router.post("/generate-monthly", requireRole("admin", "manager", "accountant"), async (req, res) => {
  if (config.dmaMode) {
    res.status(410).json({ error: "gone", reason: "dma_mode" });
    return;
  }
  if (req.auth!.role === "manager" && !requestHasManagerPermission(req, "manage_invoices")) {
    res.status(403).json({ error: "forbidden", detail: "missing_manager_permission" });
    return;
  }
  const parsed = invBody.omit({ period: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const t = req.auth!.tenantId;
  const id = randomUUID();
  const invNo = `INV-${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);
  const [p] = await pool.query<RowDataPacket[]>(
    `SELECT billing_period_days, p.currency
     FROM subscribers s
     JOIN packages p ON p.id = s.package_id
     WHERE s.id = ? AND s.tenant_id = ?`,
    [parsed.data.subscriber_id, t]
  );
  const days = (p[0]?.billing_period_days as number) ?? 30;
  const currency = parsed.data.currency ?? String(p[0]?.currency ?? "USD");
  await pool.execute(
    `INSERT INTO invoices (id, tenant_id, subscriber_id, period, invoice_no, issue_date, due_date,
      amount, currency, status, meta)
     VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, ?, 'sent', JSON_OBJECT('billing_days', ?))`,
    [
      id,
      t,
      parsed.data.subscriber_id,
      invNo,
      today,
      today,
      parsed.data.amount,
      currency,
      days,
    ]
  );
  res.status(201).json({ id, invoice_no: invNo });
});

const markPaidBody = z.object({
  payment_method: z.string().optional(),
  extend_days: z.number().int().min(1).max(400).optional(),
});

router.post("/:id/mark-paid", requireRole("admin", "manager", "accountant"), async (req, res) => {
  if (config.dmaMode) {
    res.status(410).json({ error: "gone", reason: "dma_mode" });
    return;
  }
  if (req.auth!.role === "manager" && !requestHasManagerPermission(req, "manage_invoices")) {
    res.status(403).json({ error: "forbidden", detail: "missing_manager_permission" });
    return;
  }
  const parsed = markPaidBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const t = req.auth!.tenantId;
  try {
    const tx = await withTransaction(async (conn) => {
      const [invRows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM invoices WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [req.params.id, t]
      );
      const inv = invRows[0];
      if (!inv) return { kind: "not_found" as const };
      if (String(inv.status ?? "").toLowerCase() === "paid") return { kind: "already_paid" as const };

      const amount = Number(inv.amount ?? 0);
      const subscriberId = String(inv.subscriber_id ?? "");
      const currency = String(inv.currency ?? "USD");
      const invoiceNo = String(inv.invoice_no ?? "");
      if (req.auth!.role === "manager") {
        await chargeManagerWalletWithConnection(conn, {
          tenantId: t,
          staffId: req.auth!.sub,
          amount,
          currency,
          reason: "invoice_mark_paid",
          subscriberId,
          note: invoiceNo,
        });
      }

      const paidAt = new Date();
      await conn.execute(`UPDATE invoices SET status = 'paid' WHERE id = ? AND tenant_id = ?`, [req.params.id, t]);
      const payId = randomUUID();
      await conn.execute(
        `INSERT INTO payments (id, tenant_id, invoice_id, amount, method, paid_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [payId, t, req.params.id, amount, parsed.data.payment_method ?? "manual", paidAt]
      );

      let metaDays = 30;
      try {
        const parsedMeta = typeof inv.meta === "string" ? JSON.parse(inv.meta) : inv.meta;
        metaDays = Number((parsedMeta as { billing_days?: unknown } | null)?.billing_days ?? 30);
      } catch {
        metaDays = 30;
      }
      const extendDays = parsed.data.extend_days ?? metaDays;
      const [sub] = await conn.query<RowDataPacket[]>(
        `SELECT expiration_date FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [subscriberId, t]
      );
      let nextExpiration: Date | null = null;
      if (sub[0]) {
        const current = new Date(sub[0].expiration_date as string);
        nextExpiration = extendSubscriptionByDaysNoon(current, extendDays);
        await conn.execute(
          `UPDATE subscribers SET expiration_date = ?, status = 'active' WHERE id = ? AND tenant_id = ?`,
          [nextExpiration, subscriberId, t]
        );
      }

      return {
        kind: "ok" as const,
        paymentId: payId,
        amount,
        subscriberId,
        currency,
        invoiceNo,
        paidAt: paidAt.toISOString(),
        nextExpiration: nextExpiration?.toISOString() ?? null,
      };
    });

    if (tx.kind === "not_found") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (tx.kind === "already_paid") {
      res.status(409).json({ error: "already_paid" });
      return;
    }
    let radiusSync: "ok" | "failed" = "ok";
    let radiusReason: string | null = null;
    try {
      const pr = await pushRadiusForSubscriber(pool, radius, t, tx.subscriberId);
      if (!pr.ok) {
        radiusSync = "failed";
        radiusReason = pr.reason;
      }
    } catch (error) {
      radiusSync = "failed";
      radiusReason = (error as Error).message;
      console.error("push radius after invoice payment failed", error);
    }
    await emitEvent(Events.INVOICE_PAID, {
      tenantId: t,
      invoiceId: req.params.id,
      subscriberId: tx.subscriberId,
      invoiceNo: tx.invoiceNo,
      amount: tx.amount,
      currency: tx.currency,
      paidAt: tx.paidAt,
    });
    res.json({
      ok: true,
      payment_id: tx.paymentId,
      radius_sync: radiusSync,
      radius_reason: radiusReason,
    });
  } catch (error) {
    if (error instanceof ManagerBalanceError && error.code === "insufficient_balance") {
      res.status(400).json({ error: "insufficient_manager_balance" });
      return;
    }
    res.status(500).json({ error: "invoice_mark_paid_failed" });
  }
});

export default router;
