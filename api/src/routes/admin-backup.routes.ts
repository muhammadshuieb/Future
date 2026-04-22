import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin"));

const TABLES = [
  "tenants",
  "packages",
  "subscribers",
  "invoices",
  "payments",
  "nas_servers",
  "user_usage_live",
  "user_usage_daily",
  "staff_users",
  "audit_logs",
  "inventory_categories",
  "inventory_products",
  "inventory_movements",
  "notifications",
] as const;

router.get("/extension-export", async (req, res) => {
  const t = req.auth!.tenantId;
  const out: Record<string, RowDataPacket[]> = {};
  for (const table of TABLES) {
    let rows: RowDataPacket[] = [];
    if (table === "tenants") {
      const [r] = await pool.query<RowDataPacket[]>(`SELECT * FROM tenants WHERE id = ?`, [t]);
      rows = r;
    } else {
      const [r] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM \`${table}\` WHERE tenant_id = ?`,
        [t]
      );
      rows = r;
    }
    out[table] = rows;
  }
  res.json({ exported_at: new Date().toISOString(), tenant_id: t, tables: out });
});

export default router;
