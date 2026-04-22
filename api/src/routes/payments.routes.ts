import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { RowDataPacket } from "mysql2";

const router = Router();

router.use(requireAuth);

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT py.*, i.invoice_no, i.currency FROM payments py
     JOIN invoices i ON i.id = py.invoice_id
     WHERE py.tenant_id = ? ORDER BY py.paid_at DESC LIMIT 500`,
    [req.auth!.tenantId]
  );
  res.json({ items: rows });
});

export default router;
