import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { loginRateLimiter } from "../middleware/rate-limit.js";
import { requireResellerPortalAuth } from "../middleware/reseller-portal-auth.js";
import { calculateCommissionAmount } from "../services/reseller-franchise.service.js";
import { RadiusSyncService } from "../services/radius-sync.service.js";

const router = Router();
const radiusSync = new RadiusSyncService(pool);

router.post("/auth/login", loginRateLimiter, async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.*, r.tenant_id, r.id AS reseller_id
       FROM reseller_users u
       JOIN resellers r ON r.id = u.reseller_id
       WHERE LOWER(TRIM(u.email)) = LOWER(?) AND u.status = 'active' AND r.status = 'active'`,
      [parsed.data.email]
    );
    const u = rows[0];
    if (!u || !(await bcrypt.compare(parsed.data.password, String(u.password_hash ?? "")))) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    const token = jwt.sign(
      {
        kind: "reseller_user" as const,
        sub: String(u.id),
        resellerId: String(u.reseller_id),
        tenantId: String(u.tenant_id),
        email: String(u.email),
      },
      config.jwtSecret,
      { expiresIn: (process.env.RESELLER_JWT_EXPIRES_IN ?? "8h") as SignOptions["expiresIn"] }
    );
    res.json({ token, reseller_id: u.reseller_id });
  } catch (e) {
    next(e);
  }
});

router.get("/dashboard", requireResellerPortalAuth, async (req, res, next) => {
  try {
    const r = req.resellerUser!;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM reseller_subscriber_assignments WHERE reseller_id = ?`,
      [r.resellerId]
    );
    const [w] = await pool.query<RowDataPacket[]>(`SELECT * FROM reseller_wallets WHERE reseller_id = ?`, [r.resellerId]);
    res.json({ subscriber_count: Number(rows[0]?.c ?? 0), wallet: w[0] ?? null });
  } catch (e) {
    next(e);
  }
});

router.get("/subscribers", requireResellerPortalAuth, async (req, res, next) => {
  try {
    const r = req.resellerUser!;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.* FROM subscribers s
       JOIN reseller_subscriber_assignments a ON a.subscriber_id = s.id
       WHERE a.reseller_id = ? AND s.tenant_id = ?`,
      [r.resellerId, r.tenantId]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/subscribers", requireResellerPortalAuth, async (req, res, next) => {
  try {
    const r = req.resellerUser!;
    const parsed = z.object({ username: z.string().min(1), package_id: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const [allowed] = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM reseller_package_access WHERE reseller_id = ? AND package_id = ? LIMIT 1`,
      [r.resellerId, parsed.data.package_id]
    );
    if (!allowed[0]) {
      res.status(403).json({ error: "package_not_allowed" });
      return;
    }
    const [resellerRow] = await pool.query<RowDataPacket[]>(
      `SELECT prepaid_mode_enabled, prepaid_min_balance FROM resellers WHERE id = ? LIMIT 1`,
      [r.resellerId]
    );
    if (Number(resellerRow[0]?.prepaid_mode_enabled ?? 0) === 1) {
      const [w] = await pool.query<RowDataPacket[]>(`SELECT balance FROM reseller_wallets WHERE reseller_id = ?`, [r.resellerId]);
      const bal = Number(w[0]?.balance ?? 0);
      const minB = Number(resellerRow[0]?.prepaid_min_balance ?? 0);
      if (bal < minB) {
        res.status(402).json({ error: "insufficient_reseller_balance" });
        return;
      }
    }
    const id = randomUUID();
    const tempPass = randomUUID().replace(/-/g, "").slice(0, 12);
    await pool.execute(
      `INSERT INTO subscribers (id, tenant_id, username, package_id, status, expiration_date)
       VALUES (?, ?, ?, ?, 'expired', CURDATE())`,
      [id, r.tenantId, parsed.data.username, parsed.data.package_id]
    );
    await pool.execute(
      `INSERT INTO subscriber_credentials (subscriber_id, tenant_id, password) VALUES (?, ?, ?)`,
      [id, r.tenantId, tempPass]
    );
    await pool.execute(`INSERT INTO reseller_subscriber_assignments (reseller_id, subscriber_id) VALUES (?, ?)`, [r.resellerId, id]);
    await radiusSync.syncSubscriber(id, r.tenantId);
    const [p] = await pool.query<RowDataPacket[]>(`SELECT price FROM packages WHERE id = ? LIMIT 1`, [parsed.data.package_id]);
    const base = Number(p[0]?.price ?? 0);
    const [rules] = await pool.query<RowDataPacket[]>(
      `SELECT rule_type, value FROM reseller_commission_rules WHERE reseller_id = ? AND (package_id IS NULL OR package_id = ?) ORDER BY package_id IS NULL ASC LIMIT 1`,
      [r.resellerId, parsed.data.package_id]
    );
    const rule = rules[0];
    const rt = String(rule?.rule_type ?? "");
    const comm =
      rule && (rt === "percent" || rt === "fixed") ? calculateCommissionAmount(rt as "percent" | "fixed", Number(rule.value), base) : 0;
    if (comm > 0) {
      const cid = randomUUID();
      await pool.execute(
        `INSERT INTO reseller_commissions (id, tenant_id, reseller_id, subscriber_id, amount, currency, status, meta)
         VALUES (?, ?, ?, ?, ?, 'USD', 'accrued', JSON_OBJECT('source','subscriber_create'))`,
        [cid, r.tenantId, r.resellerId, id, comm]
      );
      await pool.execute(
        `INSERT INTO reseller_wallet_transactions (id, reseller_id, amount, currency, kind, reference, meta)
         VALUES (?, ?, ?, ?, 'commission_accrual', ?, CAST(? AS JSON))`,
        [randomUUID(), r.resellerId, comm, "USD", cid, JSON.stringify({ subscriber_id: id })]
      );
    }
    res.status(201).json({ id, generated_password: tempPass });
  } catch (e) {
    next(e);
  }
});

router.post("/renew", requireResellerPortalAuth, async (req, res, next) => {
  try {
    const r = req.resellerUser!;
    const parsed = z.object({ subscriber_id: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const [a] = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM reseller_subscriber_assignments WHERE reseller_id = ? AND subscriber_id = ?`,
      [r.resellerId, parsed.data.subscriber_id]
    );
    if (!a[0]) {
      res.status(403).json({ error: "not_assigned" });
      return;
    }
    const [subRows] = await pool.query<RowDataPacket[]>(
      `SELECT package_id FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [parsed.data.subscriber_id, r.tenantId]
    );
    const pkg = String(subRows[0]?.package_id ?? "");
    if (!pkg) {
      res.status(400).json({ error: "no_package" });
      return;
    }
    const [pRows] = await pool.query<RowDataPacket[]>(
      `SELECT price, currency FROM packages WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [pkg, r.tenantId]
    );
    const price = Number(pRows[0]?.price ?? 0);
    const currency = String(pRows[0]?.currency ?? "USD");
    if (price <= 0) {
      res.json({ invoice_id: null, payment_request_id: null });
      return;
    }
    const invoiceId = randomUUID();
    const invNo = `RESELLER-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);
    await pool.execute(
      `INSERT INTO invoices (id, tenant_id, subscriber_id, period, invoice_no, issue_date, due_date, amount, currency, status, meta)
       VALUES (?, ?, ?, 'one_time', ?, ?, ?, ?, ?, 'sent', JSON_OBJECT('source','reseller_portal_renew'))`,
      [invoiceId, r.tenantId, parsed.data.subscriber_id, invNo, today, today, price, currency]
    );
    const payId = randomUUID();
    await pool.execute(
      `INSERT INTO subscriber_payment_requests (id, tenant_id, subscriber_id, invoice_id, amount, currency, method, status)
       VALUES (?, ?, ?, ?, ?, ?, 'reseller_renew', 'pending')`,
      [payId, r.tenantId, parsed.data.subscriber_id, invoiceId, price, currency]
    );
    res.json({ invoice_id: invoiceId, payment_request_id: payId });
  } catch (e) {
    next(e);
  }
});

router.get("/wallet", requireResellerPortalAuth, async (req, res, next) => {
  try {
    const [w] = await pool.query<RowDataPacket[]>(`SELECT * FROM reseller_wallets WHERE reseller_id = ?`, [req.resellerUser!.resellerId]);
    res.json({ wallet: w[0] ?? null });
  } catch (e) {
    next(e);
  }
});

router.get("/commissions", requireResellerPortalAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM reseller_commissions WHERE reseller_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.resellerUser!.resellerId]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

export default router;
