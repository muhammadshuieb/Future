import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { hasEnterpriseStaffPermission } from "../lib/enterprise-staff-permissions.js";
import { requireAuth } from "../middleware/auth.js";

const admin = Router();
admin.use(requireAuth);

function gate(key: Parameters<typeof hasEnterpriseStaffPermission>[1]) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (!hasEnterpriseStaffPermission(req, key)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}

admin.get("/", gate("view_resellers"), async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM resellers WHERE tenant_id = ? ORDER BY name`,
      [req.auth!.tenantId]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

admin.post("/", gate("create_reseller"), async (req, res, next) => {
  try {
    const parsed = z.object({ name: z.string().min(1), kind: z.string().optional(), branch_id: z.string().uuid().optional().nullable() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO resellers (id, tenant_id, name, kind, branch_id, status) VALUES (?, ?, ?, ?, ?, 'active')`,
      [id, req.auth!.tenantId, parsed.data.name, parsed.data.kind ?? "reseller", parsed.data.branch_id ?? null]
    );
    await pool.execute(`INSERT INTO reseller_wallets (reseller_id, balance, currency) VALUES (?, 0, 'USD')`, [id]);
    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
});

admin.get("/:id", gate("view_resellers"), async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM resellers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [req.params.id, req.auth!.tenantId]
    );
    if (!rows[0]) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ reseller: rows[0] });
  } catch (e) {
    next(e);
  }
});

admin.put("/:id", gate("edit_reseller"), async (req, res, next) => {
  try {
    const parsed = z.object({ name: z.string().min(1).optional(), kind: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (parsed.data.name) {
      await pool.execute(`UPDATE resellers SET name = ? WHERE id = ? AND tenant_id = ?`, [parsed.data.name, req.params.id, req.auth!.tenantId]);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

admin.post("/:id/suspend", gate("suspend_reseller"), async (req, res, next) => {
  try {
    await pool.execute(`UPDATE resellers SET status = 'suspended' WHERE id = ? AND tenant_id = ?`, [req.params.id, req.auth!.tenantId]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

admin.post("/:id/activate", gate("suspend_reseller"), async (req, res, next) => {
  try {
    await pool.execute(`UPDATE resellers SET status = 'active' WHERE id = ? AND tenant_id = ?`, [req.params.id, req.auth!.tenantId]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

admin.get("/:id/wallet", gate("view_resellers"), async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT w.* FROM reseller_wallets w JOIN resellers r ON r.id = w.reseller_id WHERE w.reseller_id = ? AND r.tenant_id = ?`,
      [req.params.id, req.auth!.tenantId]
    );
    const [tx] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM reseller_wallet_transactions WHERE reseller_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json({ wallet: rows[0] ?? null, transactions: tx });
  } catch (e) {
    next(e);
  }
});

admin.post("/:id/wallet/topup", gate("manage_reseller_wallet"), async (req, res, next) => {
  try {
    const parsed = z.object({ amount: z.number().positive(), currency: z.string().length(3) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const rid = req.params.id;
    await pool.execute(`UPDATE reseller_wallets SET balance = balance + ? WHERE reseller_id = ?`, [parsed.data.amount, rid]);
    await pool.execute(
      `INSERT INTO reseller_wallet_transactions (id, reseller_id, amount, currency, kind, reference) VALUES (?,?,?,?, 'topup', ?)`,
      [randomUUID(), rid, parsed.data.amount, parsed.data.currency, "admin_topup"]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

admin.post("/:id/wallet/adjust", gate("adjust_reseller_wallet"), async (req, res, next) => {
  try {
    const parsed = z.object({ amount: z.number(), currency: z.string().length(3), note: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const rid = req.params.id;
    await pool.execute(`UPDATE reseller_wallets SET balance = balance + ? WHERE reseller_id = ?`, [parsed.data.amount, rid]);
    await pool.execute(
      `INSERT INTO reseller_wallet_transactions (id, reseller_id, amount, currency, kind, reference, meta) VALUES (?,?,?,?, 'adjust', ?, CAST(? AS JSON))`,
      [randomUUID(), rid, parsed.data.amount, parsed.data.currency, parsed.data.note ?? "adjust", JSON.stringify({ staff: req.auth!.sub })]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

admin.get("/:id/commissions", gate("view_reseller_commissions"), async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM reseller_commissions WHERE reseller_id = ? ORDER BY created_at DESC LIMIT 200`,
      [req.params.id]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

admin.get("/:id/settlements", gate("view_reseller_commissions"), async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM reseller_settlements WHERE reseller_id = ? ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

admin.post("/:id/settlements", gate("approve_reseller_settlements"), async (req, res, next) => {
  try {
    const parsed = z.object({ amount: z.number().positive(), currency: z.string().length(3), note: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO reseller_settlements (id, tenant_id, reseller_id, amount, currency, status, note) VALUES (?,?,?,?,?,'pending',?)`,
      [id, req.auth!.tenantId, req.params.id, parsed.data.amount, parsed.data.currency, parsed.data.note ?? ""]
    );
    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
});

admin.get("/:id/branding", gate("view_resellers"), async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM reseller_branding WHERE reseller_id = ?`, [req.params.id]);
    res.json({ branding: rows[0] ?? {} });
  } catch (e) {
    next(e);
  }
});

admin.put("/:id/branding", gate("manage_reseller_branding"), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        display_name: z.string().optional(),
        logo_url: z.string().optional(),
        primary_color: z.string().optional(),
        accent_color: z.string().optional(),
        support_phone: z.string().optional(),
        support_whatsapp: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    await pool.execute(
      `INSERT INTO reseller_branding (reseller_id, display_name, logo_url, primary_color, accent_color, support_phone, support_whatsapp)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         logo_url = VALUES(logo_url),
         primary_color = VALUES(primary_color),
         accent_color = VALUES(accent_color),
         support_phone = VALUES(support_phone),
         support_whatsapp = VALUES(support_whatsapp)`,
      [
        req.params.id,
        parsed.data.display_name ?? null,
        parsed.data.logo_url ?? null,
        parsed.data.primary_color ?? null,
        parsed.data.accent_color ?? null,
        parsed.data.support_phone ?? null,
        parsed.data.support_whatsapp ?? null,
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

admin.get("/:id/subscribers", gate("view_resellers"), async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.* FROM subscribers s
       JOIN reseller_subscriber_assignments a ON a.subscriber_id = s.id
       WHERE a.reseller_id = ? AND s.tenant_id = ?`,
      [req.params.id, req.auth!.tenantId]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

admin.post("/:id/subscribers", gate("view_resellers"), async (req, res, next) => {
  try {
    if (!hasEnterpriseStaffPermission(req, "create_reseller") && !hasEnterpriseStaffPermission(req, "edit_reseller")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const parsed = z.object({ subscriber_id: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    await pool.execute(
      `INSERT IGNORE INTO reseller_subscriber_assignments (reseller_id, subscriber_id) VALUES (?, ?)`,
      [req.params.id, parsed.data.subscriber_id]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

admin.get("/:id/packages", gate("view_resellers"), async (req, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.* FROM packages p
       JOIN reseller_package_access a ON a.package_id = p.id
       WHERE a.reseller_id = ? AND p.tenant_id = ?`,
      [req.params.id, req.auth!.tenantId]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

admin.put("/:id/packages", gate("edit_reseller"), async (req, res, next) => {
  try {
    const parsed = z.object({ package_ids: z.array(z.string().uuid()) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    await pool.execute(`DELETE FROM reseller_package_access WHERE reseller_id = ?`, [req.params.id]);
    for (const pid of parsed.data.package_ids) {
      await pool.execute(`INSERT IGNORE INTO reseller_package_access (reseller_id, package_id) VALUES (?, ?)`, [req.params.id, pid]);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const router = Router();
router.use("/", admin);

export default router;
