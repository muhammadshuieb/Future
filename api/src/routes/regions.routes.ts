import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { hasTable, invalidateColumnCache } from "../db/schemaGuards.js";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import type { RowDataPacket } from "mysql2";

const router = Router();

router.use(requireAuth);

router.get("/", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req, res) => {
  const tenant = req.auth!.tenantId;
  if (!(await hasTable(pool, "subscriber_regions"))) {
    res.json({ items: [] });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, parent_id, name, sort_order, created_at
     FROM subscriber_regions
     WHERE tenant_id = ?
     ORDER BY parent_id IS NOT NULL, sort_order ASC, name ASC`,
    [tenant]
  );
  res.json({ items: rows });
});

const regionBody = z.object({
  name: z.string().min(1).max(128),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional(),
});

router.post(
  "/",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsed = regionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (!(await hasTable(pool, "subscriber_regions"))) {
      res.status(503).json({ error: "regions_table_missing" });
      return;
    }
    const tenant = req.auth!.tenantId;
    const { name, parent_id, sort_order } = parsed.data;
    if (parent_id) {
      const [p] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM subscriber_regions WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [parent_id, tenant]
      );
      if (!p[0]) {
        res.status(400).json({ error: "invalid_parent" });
        return;
      }
    }
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO subscriber_regions (id, tenant_id, parent_id, name, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [id, tenant, parent_id ?? null, name.trim(), sort_order ?? 0]
    );
    invalidateColumnCache();
    res.status(201).json({ id });
  }
);

const patchBody = z.object({
  name: z.string().min(1).max(128).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional(),
});

router.patch(
  "/:id",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const tenant = req.auth!.tenantId;
    const id = req.params.id;
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM subscriber_regions WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, tenant]
    );
    if (!existing[0]) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const b = parsed.data;
    if (b.parent_id !== undefined && b.parent_id !== null) {
      if (b.parent_id === id) {
        res.status(400).json({ error: "invalid_parent", detail: "self" });
        return;
      }
      const [p] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM subscriber_regions WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [b.parent_id, tenant]
      );
      if (!p[0]) {
        res.status(400).json({ error: "invalid_parent" });
        return;
      }
      let walk: string | null = b.parent_id;
      for (let i = 0; i < 64 && walk; i++) {
        if (walk === id) {
          res.status(400).json({ error: "invalid_parent", detail: "cycle" });
          return;
        }
        const parentQueryResult = await pool.query<RowDataPacket[]>(
          `SELECT parent_id FROM subscriber_regions WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [walk, tenant]
        );
        const parentRows: RowDataPacket[] = parentQueryResult[0];
        walk = parentRows[0]?.parent_id ? String(parentRows[0].parent_id) : null;
      }
    }
    const sets: string[] = [];
    const vals: Array<string | number | null> = [];
    if (b.name !== undefined) {
      sets.push("name = ?");
      vals.push(b.name.trim());
    }
    if (b.parent_id !== undefined) {
      sets.push("parent_id = ?");
      vals.push(b.parent_id);
    }
    if (b.sort_order !== undefined) {
      sets.push("sort_order = ?");
      vals.push(b.sort_order);
    }
    if (!sets.length) {
      res.json({ ok: true });
      return;
    }
    await pool.execute(
      `UPDATE subscriber_regions SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
      [...vals, id, tenant]
    );
    invalidateColumnCache();
    res.json({ ok: true });
  }
);

router.delete(
  "/:id",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const tenant = req.auth!.tenantId;
    const id = req.params.id;
    const [r] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM subscriber_regions WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, tenant]
    );
    if (!r[0]) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await pool.execute(`DELETE FROM subscriber_regions WHERE id = ? AND tenant_id = ?`, [id, tenant]);
    invalidateColumnCache();
    res.json({ ok: true });
  }
);

export default router;
