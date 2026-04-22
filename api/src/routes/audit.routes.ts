import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import { hasTable } from "../db/schemaGuards.js";

const router = Router();
router.use(requireAuth);

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(25),
  action: z.string().trim().max(64).optional(),
  entity_type: z.string().trim().max(64).optional(),
  staff_id: z.string().uuid().optional(),
});

router.get("/", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req: Request, res: Response) => {
  if (!(await hasTable(pool, "audit_logs"))) {
    res.json({ items: [], meta: { total: 0, page: 1, per_page: 25 } });
    return;
  }
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const page = parsed.data.page;
  const perPage = parsed.data.per_page;
  const offset = (page - 1) * perPage;

  const where: string[] = ["a.tenant_id = ?"];
  const params: Array<string | number> = [tenantId];
  if (parsed.data.action) {
    where.push("a.action = ?");
    params.push(parsed.data.action);
  }
  if (parsed.data.entity_type) {
    where.push("a.entity_type = ?");
    params.push(parsed.data.entity_type);
  }
  if (parsed.data.staff_id) {
    where.push("a.staff_id = ?");
    params.push(parsed.data.staff_id);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM audit_logs a ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.c ?? 0);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.id, a.staff_id, a.action, a.entity_type, a.entity_id, a.payload, a.created_at,
            su.name AS staff_name, su.email AS staff_email
     FROM audit_logs a
     LEFT JOIN staff_users su ON su.id = a.staff_id AND su.tenant_id = a.tenant_id
     ${whereSql}
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  );
  res.json({ items: rows, meta: { total, page, per_page: perPage } });
});

router.delete("/", routePolicy({ allow: ["admin"] }), async (req: Request, res: Response) => {
  if (!(await hasTable(pool, "audit_logs"))) {
    res.json({ ok: true });
    return;
  }
  const tenantId = req.auth!.tenantId;
  await pool.execute(`DELETE FROM audit_logs WHERE tenant_id = ?`, [tenantId]);
  res.json({ ok: true });
});

export default router;
