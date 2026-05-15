import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  billingDaysFromInvoiceMeta,
  resolveExpirationAfterPayment,
} from "../lib/billing.js";
import { formatExpirationForDb } from "../lib/expiration-date.js";
import { writeFinancialAudit } from "../services/financial-audit.service.js";
import { CoaService } from "../services/coa.service.js";
import { getSystemSettings } from "../services/system-settings.service.js";
import { RadiusSyncService } from "../services/radius-sync.service.js";
import { loadSubscriberAccessRow } from "../lib/subscriber-access-guard.js";
import { resolveRadiusSyncDenyReason } from "../lib/radius-sync-deny.js";
import { tenantNasDeviceIds } from "../lib/package-subscriber-validation.js";
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
const radiusSync = new RadiusSyncService(pool);
const coa = new CoaService(pool);
const currencySchema = z.enum(["USD", "SYP", "TRY"]);

router.use(requireAuth);

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const query = z.object({ subscriber_id: z.string().min(1).max(128).optional() }).safeParse(req.query);
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
  subscriber_id: z.string().min(1).max(128),
  period: z.enum(["monthly", "yearly", "one_time"]).optional(),
  amount: z.number(),
  currency: currencySchema.optional(),
});

router.post("/generate-monthly", requireRole("admin", "manager", "accountant"), async (req, res) => {
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
  let packageRows: RowDataPacket[];
  const [p] = await pool.query<RowDataPacket[]>(
    `SELECT billing_period_days, p.currency
     FROM subscribers s
     JOIN packages p ON p.id = s.package_id
     WHERE s.id = ? AND s.tenant_id = ?`,
    [parsed.data.subscriber_id, t]
  );
  packageRows = p;
  if (!packageRows[0]) {
    res.status(404).json({ error: "subscriber_not_found" });
    return;
  }
  const days = (packageRows[0]?.billing_period_days as number) ?? 30;
  const currency = parsed.data.currency ?? String(packageRows[0]?.currency ?? "USD");
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
  subscription_expires_at: z.string().min(1).optional(),
});

router.post("/:id/mark-paid", requireRole("admin", "manager", "accountant"), async (req, res) => {
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
      const invCurrency = String(inv.currency ?? "USD").slice(0, 8);
      await conn.execute(
        `INSERT INTO payments (id, tenant_id, invoice_id, subscriber_id, amount, currency, method, status, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?)`,
        [payId, t, req.params.id, subscriberId, amount, invCurrency, parsed.data.payment_method ?? "manual", paidAt]
      );

      let extendDays = parsed.data.extend_days ?? billingDaysFromInvoiceMeta(inv.meta);
      if (extendDays == null || extendDays < 1) {
        const [pkgRows] = await conn.query<RowDataPacket[]>(
          `SELECT p.billing_period_days
           FROM packages p
           JOIN subscribers s ON s.package_id = p.id AND s.tenant_id = p.tenant_id
           WHERE s.id = ? AND s.tenant_id = ?
           LIMIT 1`,
          [subscriberId, t]
        );
        extendDays = Number(pkgRows[0]?.billing_period_days ?? 30);
      }
      let subRows: RowDataPacket[];
      const [sub] = await conn.query<RowDataPacket[]>(
        `SELECT expiration_date FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [subscriberId, t]
      );
      subRows = sub;
      let nextExpiration: Date | null = null;
      let previousExpiration: string | null = null;
      if (subRows[0] && sub[0]) {
        previousExpiration =
          subRows[0].expiration_date != null ? String(subRows[0].expiration_date) : null;
        try {
          nextExpiration = resolveExpirationAfterPayment(
            parsed.data.subscription_expires_at,
            previousExpiration,
            extendDays
          ).next;
        } catch {
          return { kind: "invalid_expiration" as const };
        }
        await conn.execute(
          `UPDATE subscribers SET expiration_date = ?, status = 'active' WHERE id = ? AND tenant_id = ?`,
          [formatExpirationForDb(nextExpiration), subscriberId, t]
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
        nextExpiration: nextExpiration ? formatExpirationForDb(nextExpiration) : null,
        previousExpiration,
        usedExplicitExpiry: Boolean(parsed.data.subscription_expires_at?.trim()),
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
    if (tx.kind === "invalid_expiration") {
      res.status(400).json({ error: "invalid_expiration" });
      return;
    }
    if (tx.previousExpiration != null || tx.nextExpiration) {
      await writeFinancialAudit(pool, {
        tenantId: t,
        staffId: req.auth?.sub ?? null,
        action: "invoice_paid_update_expiry",
        entityType: "subscriber",
        entityId: tx.subscriberId,
        payload: {
          invoice_id: req.params.id,
          payment_id: tx.paymentId,
          previous_expiration_date: tx.previousExpiration,
          new_expiration_date: tx.nextExpiration,
          used_explicit_date: tx.usedExplicitExpiry,
        },
        ip: req.ip ?? null,
      });
    }
    let radiusSyncStatus: "ok" | "failed" = "ok";
    let radiusReason: string | null = null;
    try {
      await radiusSync.syncSubscriber(tx.subscriberId, t);
      const tenantNasIds = await tenantNasDeviceIds(pool, t);
      const access = await loadSubscriberAccessRow(pool, { tenantId: t, subscriberId: tx.subscriberId });
      radiusReason = access ? resolveRadiusSyncDenyReason(access, tenantNasIds) : "not_found";
      if (radiusReason) {
        radiusSyncStatus = "failed";
      } else {
        let username: string | null = null;
        const [subRows] = await pool.query<RowDataPacket[]>(
          `SELECT username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [tx.subscriberId, t]
        );
        username = subRows[0]?.username != null ? String(subRows[0].username) : null;
        if (username) {
          let shouldDisconnect = true;
          try {
            const settings = await getSystemSettings(t);
            shouldDisconnect = settings.disconnect_on_activation;
          } catch (error) {
            console.warn("[invoices] settings read failed, using default disconnect=true", error);
          }
          if (shouldDisconnect) {
            await coa.disconnectAllSessions(username, t).catch((error) => {
              console.error(`[invoices] activation disconnect failed for ${username}`, error);
            });
          }
        }
      }
    } catch (error) {
      radiusSyncStatus = "failed";
      radiusReason = (error as Error).message;
      console.error("radius sync after invoice payment failed", error);
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
      radius_sync: radiusSyncStatus,
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
