import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { RowDataPacket } from "mysql2";

const router = Router();

router.use(requireAuth);

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const q = z.object({ subscriber_id: z.string().min(1).max(128).optional() }).safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  const tenant = req.auth!.tenantId;
  const args: unknown[] = [tenant];
  let sql = `SELECT py.*, i.invoice_no, i.currency, i.subscriber_id
     FROM payments py
     JOIN invoices i ON i.id = py.invoice_id AND i.tenant_id = py.tenant_id
     WHERE py.tenant_id = ?`;
  if (q.data.subscriber_id) {
    sql += ` AND i.subscriber_id = ?`;
    args.push(q.data.subscriber_id);
  }
  sql += ` ORDER BY py.paid_at DESC LIMIT 500`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, args);
  res.json({ items: rows });
});

export default router;
