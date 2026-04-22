import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin", "manager", "accountant", "viewer"));

router.get("/", async (req, res) => {
  const t = req.auth!.tenantId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100`,
    [t]
  );
  res.json({ items: rows });
});

router.post("/:id/read", async (req, res) => {
  await pool.execute(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND tenant_id = ?`,
    [req.params.id, req.auth!.tenantId]
  );
  res.json({ ok: true });
});

export default router;
