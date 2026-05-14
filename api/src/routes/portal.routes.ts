import { Router } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { loginRateLimiter } from "../middleware/rate-limit.js";
import { requireSubscriberAuth } from "../middleware/subscriber-auth.js";
import { AccountingService } from "../services/accounting.service.js";
import { buildInvoicePdfBytes, buildReceiptPdfBytes } from "../services/portal-pdf.service.js";
import {
  changePortalPassword,
  createPaymentRequest,
  findPortalLoginCandidates,
  getPortalDashboard,
  getPortalMePayload,
  getSupportLinks,
  insertSpeedTest,
  listPaymentMethods,
  listPaymentRequests,
  listPortalDevices,
  listPortalInvoices,
  listPortalSessions,
  portalAudit,
  portalRenew,
  sendStatementWhatsApp,
  upsertDevicesFromRadacct,
  verifyPortalCredentials,
} from "../services/portal-subscriber.service.js";
import { RadiusSyncService } from "../services/radius-sync.service.js";

const router = Router();
const radiusSync = new RadiusSyncService(pool);
const accounting = new AccountingService(pool);

function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string | undefined {
  const xf = req.headers["x-forwarded-for"];
  const first = Array.isArray(xf) ? xf[0] : typeof xf === "string" ? xf.split(",")[0]?.trim() : "";
  return first || req.ip;
}

router.post("/auth/login", loginRateLimiter, async (req, res, next) => {
  try {
    const parsed = z
      .object({
        username: z.string().min(1),
        password: z.string().min(1),
        otp: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const candidates = await findPortalLoginCandidates(pool, parsed.data.username);
    if (candidates.length === 0) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    if (candidates.length > 1) {
      res.status(400).json({ error: "ambiguous_username" });
      return;
    }
    const row = candidates[0];
    const v = await verifyPortalCredentials(pool, row, parsed.data.password, parsed.data.otp);
    if (!v.ok) {
      res.status(v.reason === "otp_expired" ? 401 : 401).json({ error: v.reason });
      return;
    }
    const payload = {
      kind: "subscriber" as const,
      sub: String(row.id),
      tenantId: String(row.tenant_id),
      username: String(row.username),
    };
    const token = jwt.sign(payload, config.jwtSecret, {
      expiresIn: (process.env.PORTAL_JWT_EXPIRES_IN ?? "7d") as SignOptions["expiresIn"],
    });
    await portalAudit(pool, payload.tenantId, payload.sub, "portal_login", {}, clientIp(req));
    res.json({ token, subscriber: { id: payload.sub, tenantId: payload.tenantId, username: payload.username } });
  } catch (e) {
    next(e);
  }
});

router.post("/auth/logout", requireSubscriberAuth, async (req, res) => {
  await portalAudit(pool, req.subscriber!.tenantId, req.subscriber!.sub, "portal_logout", {}, clientIp(req));
  res.json({ ok: true });
});

router.get("/me", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const me = await getPortalMePayload(pool, s.tenantId, s.sub, s.username);
    if (!me) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(me);
  } catch (e) {
    next(e);
  }
});

router.get("/dashboard", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const dash = await getPortalDashboard(pool, s.tenantId, s.sub, s.username);
    if (!dash) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(dash);
  } catch (e) {
    next(e);
  }
});

router.get("/usage", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const q = z.object({ from: z.string().optional(), to: z.string().optional() }).safeParse(req.query);
    const report = await accounting.buildSubscriberTrafficReport(s.tenantId, s.username, {
      from: q.success ? q.data.from : undefined,
      to: q.success ? q.data.to : undefined,
    });
    res.json(report);
  } catch (e) {
    next(e);
  }
});

router.get("/invoices", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const items = await listPortalInvoices(pool, s.tenantId, s.sub);
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

router.get("/invoices/:id/pdf", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM invoices WHERE id = ? AND tenant_id = ? AND subscriber_id = ? LIMIT 1`,
      [req.params.id, s.tenantId, s.sub]
    );
    const inv = rows[0];
    if (!inv) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const bytes = await buildInvoicePdfBytes({
      invoiceNo: String(inv.invoice_no),
      amount: String(inv.amount),
      currency: String(inv.currency),
      status: String(inv.status),
      issueDate: String(inv.issue_date),
      subscriberUsername: s.username,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${inv.invoice_no}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (e) {
    next(e);
  }
});

router.get("/receipts/:id/pdf", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.*, i.invoice_no
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.id = ? AND p.tenant_id = ? AND p.subscriber_id = ? LIMIT 1`,
      [req.params.id, s.tenantId, s.sub]
    );
    const pay = rows[0];
    if (!pay) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const bytes = await buildReceiptPdfBytes({
      paymentId: String(pay.id),
      invoiceNo: pay.invoice_no ? String(pay.invoice_no) : null,
      amount: String(pay.amount),
      currency: String(pay.currency),
      paidAt: pay.paid_at ? new Date(pay.paid_at as Date).toISOString() : "",
      method: String(pay.method ?? ""),
      subscriberUsername: s.username,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="receipt-${pay.id}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (e) {
    next(e);
  }
});

router.get("/payment-requests", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const items = await listPaymentRequests(pool, s.tenantId, s.sub);
    res.json({ items, methods: await listPaymentMethods(pool, s.tenantId) });
  } catch (e) {
    next(e);
  }
});

router.post("/payment-requests", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const parsed = z
      .object({
        amount: z.number().positive(),
        currency: z.string().length(3),
        method: z.string().min(1).max(64),
        invoice_id: z.string().uuid().optional().nullable(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const id = await createPaymentRequest(pool, s.tenantId, s.sub, parsed.data);
    await portalAudit(pool, s.tenantId, s.sub, "payment_request_created", { id }, clientIp(req));
    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
});

router.post("/renew", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const parsed = z.object({ package_id: z.string().uuid().optional().nullable() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const out = await portalRenew(pool, s.tenantId, s.sub, parsed.data.package_id ?? null, radiusSync);
    await portalAudit(pool, s.tenantId, s.sub, "portal_renew", out, clientIp(req));
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "no_package") {
      res.status(400).json({ error: "no_package" });
      return;
    }
    next(e);
  }
});

router.post("/password", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const parsed = z
      .object({
        new_password: z.string().min(6).max(128),
        sync_radius: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const [allowRows] = await pool.query<RowDataPacket[]>(
      `SELECT allow_change_radius_password FROM subscriber_portal_accounts WHERE tenant_id = ? AND subscriber_id = ? LIMIT 1`,
      [s.tenantId, s.sub]
    );
    const allow = allowRows[0];
    const canSync = allow == null || Number(allow.allow_change_radius_password ?? 1) === 1;
    const sync = Boolean(parsed.data.sync_radius) && canSync;
    await changePortalPassword(pool, s.tenantId, s.sub, parsed.data.new_password, sync, radiusSync);
    await portalAudit(pool, s.tenantId, s.sub, "portal_password_changed", { sync_radius: sync }, clientIp(req));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/sessions", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const q = z.enum(["active", "closed"]).safeParse(req.query.mode ?? "active");
    const mode = q.success ? q.data : "active";
    const rows = await listPortalSessions(pool, s.tenantId, s.sub, s.username, mode);
    res.json({ mode, items: rows });
  } catch (e) {
    next(e);
  }
});

router.get("/devices", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    await upsertDevicesFromRadacct(pool, s.tenantId, s.sub, s.username);
    const items = await listPortalDevices(pool, s.tenantId, s.sub);
    res.json({ items, count: items.length });
  } catch (e) {
    next(e);
  }
});

router.post("/speed-test", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const parsed = z
      .object({
        latency_ms: z.number().optional(),
        download_bps: z.number().optional(),
        upload_bps: z.number().optional(),
        client_meta: z.record(z.unknown()).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const id = await insertSpeedTest(pool, s.tenantId, s.sub, parsed.data);
    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
});

router.post("/whatsapp/statement", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const r = await sendStatementWhatsApp(pool, s.tenantId, s.sub);
    if (!r.ok) {
      res.status(400).json(r);
      return;
    }
    await portalAudit(pool, s.tenantId, s.sub, "whatsapp_statement", {}, clientIp(req));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/support", requireSubscriberAuth, async (req, res, next) => {
  try {
    const s = req.subscriber!;
    const links = await getSupportLinks(pool, s.tenantId);
    res.json(links);
  } catch (e) {
    next(e);
  }
});

export default router;
