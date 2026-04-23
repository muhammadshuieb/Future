import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin", "manager", "accountant", "viewer"));
router.use(denyViewerWrites);

router.get("/categories", async (req, res) => {
  if (!(await hasTable(pool, "inventory_categories"))) {
    res.json({ items: [] });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM inventory_categories WHERE tenant_id = ? ORDER BY name`,
    [req.auth!.tenantId]
  );
  res.json({ items: rows });
});

const catBody = z.object({ name: z.string().min(1) });

router.post("/categories", requireRole("admin", "manager"), denyAccountant, async (req, res) => {
  if (!(await hasTable(pool, "inventory_categories"))) {
    res.status(503).json({ error: "inventory_not_configured" });
    return;
  }
  const parsed = catBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO inventory_categories (id, tenant_id, name) VALUES (?, ?, ?)`,
    [id, req.auth!.tenantId, parsed.data.name]
  );
  res.status(201).json({ id });
});

router.patch("/categories/:id", requireRole("admin", "manager"), denyAccountant, async (req, res) => {
  if (!(await hasTable(pool, "inventory_categories"))) {
    res.status(503).json({ error: "inventory_not_configured" });
    return;
  }
  const parsed = catBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const [result] = await pool.execute(
    `UPDATE inventory_categories SET name = ? WHERE id = ? AND tenant_id = ?`,
    [parsed.data.name, req.params.id, req.auth!.tenantId]
  );
  const affected = Number((result as { affectedRows?: number }).affectedRows ?? 0);
  if (!affected) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

router.delete("/categories/:id", requireRole("admin", "manager"), denyAccountant, async (req, res) => {
  if (!(await hasTable(pool, "inventory_categories"))) {
    res.status(503).json({ error: "inventory_not_configured" });
    return;
  }
  const [result] = await pool.execute(`DELETE FROM inventory_categories WHERE id = ? AND tenant_id = ?`, [
    req.params.id,
    req.auth!.tenantId,
  ]);
  const affected = Number((result as { affectedRows?: number }).affectedRows ?? 0);
  if (!affected) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

router.get("/products", async (req, res) => {
  if (!(await hasTable(pool, "inventory_products"))) {
    res.json({ items: [] });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM inventory_products WHERE tenant_id = ? ORDER BY name`,
    [req.auth!.tenantId]
  );
  res.json({ items: rows });
});

const prodBody = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  category_id: z.string().uuid().nullable().optional(),
  unit: z.string().optional(),
  unit_cost: z.number().optional(),
  stock_qty: z.number().int().optional(),
});

router.post("/products", requireRole("admin", "manager"), denyAccountant, async (req, res) => {
  if (!(await hasTable(pool, "inventory_products"))) {
    res.status(503).json({ error: "inventory_not_configured" });
    return;
  }
  const parsed = prodBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = randomUUID();
  const b = parsed.data;
  await pool.execute(
    `INSERT INTO inventory_products (id, tenant_id, category_id, sku, name, unit, unit_cost, stock_qty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.auth!.tenantId,
      b.category_id ?? null,
      b.sku,
      b.name,
      b.unit ?? "pcs",
      b.unit_cost ?? 0,
      b.stock_qty ?? 0,
    ]
  );
  res.status(201).json({ id });
});

router.patch("/products/:id", requireRole("admin", "manager"), denyAccountant, async (req, res) => {
  if (!(await hasTable(pool, "inventory_products"))) {
    res.status(503).json({ error: "inventory_not_configured" });
    return;
  }
  const parsed = prodBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  const b = parsed.data;
  const push = (key: string, value: string | number | null | undefined) => {
    if (value === undefined) return;
    sets.push(`${key} = ?`);
    vals.push(value);
  };
  push("sku", b.sku);
  push("name", b.name);
  push("category_id", b.category_id ?? null);
  push("unit", b.unit);
  push("unit_cost", b.unit_cost);
  push("stock_qty", b.stock_qty);
  if (!sets.length) {
    res.json({ ok: true });
    return;
  }
  const [result] = await pool.execute(
    `UPDATE inventory_products SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
    [...vals, req.params.id, req.auth!.tenantId]
  );
  const affected = Number((result as { affectedRows?: number }).affectedRows ?? 0);
  if (!affected) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

router.delete("/products/:id", requireRole("admin", "manager"), denyAccountant, async (req, res) => {
  if (!(await hasTable(pool, "inventory_products"))) {
    res.status(503).json({ error: "inventory_not_configured" });
    return;
  }
  const [result] = await pool.execute(`DELETE FROM inventory_products WHERE id = ? AND tenant_id = ?`, [
    req.params.id,
    req.auth!.tenantId,
  ]);
  const affected = Number((result as { affectedRows?: number }).affectedRows ?? 0);
  if (!affected) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

const movBody = z.object({
  product_id: z.string().uuid(),
  delta_qty: z.number().int(),
  reason: z.string().optional(),
  invoice_id: z.string().uuid().nullable().optional(),
});

router.post("/movements", requireRole("admin", "manager"), denyAccountant, async (req, res) => {
  if (
    !(await hasTable(pool, "inventory_movements")) ||
    !(await hasTable(pool, "inventory_products"))
  ) {
    res.status(503).json({ error: "inventory_not_configured" });
    return;
  }
  const parsed = movBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = randomUUID();
  const t = req.auth!.tenantId;
  const staff = req.auth!.sub;
  const { product_id, delta_qty, reason, invoice_id } = parsed.data;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO inventory_movements (id, tenant_id, product_id, delta_qty, reason, invoice_id, staff_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, t, product_id, delta_qty, reason ?? null, invoice_id ?? null, staff]
    );
    await conn.execute(
      `UPDATE inventory_products SET stock_qty = stock_qty + ? WHERE id = ? AND tenant_id = ?`,
      [delta_qty, product_id, t]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  res.status(201).json({ id });
});

router.get("/movements", async (req, res) => {
  if (!(await hasTable(pool, "inventory_movements"))) {
    res.json({ items: [] });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT m.*, p.name AS product_name, p.sku AS product_sku
     FROM inventory_movements m
     LEFT JOIN inventory_products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
     WHERE m.tenant_id = ?
     ORDER BY m.created_at DESC
     LIMIT 500`,
    [req.auth!.tenantId]
  );
  res.json({ items: rows });
});

router.get("/report/monthly", async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "invalid_month" });
    return;
  }
  const monthStart = `${month}-01`;
  const startDate = new Date(`${monthStart}T00:00:00.000Z`);
  if (Number.isNaN(startDate.getTime())) {
    res.status(400).json({ error: "invalid_month" });
    return;
  }
  const nextMonth = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1));
  const nextMonthStart = nextMonth.toISOString().slice(0, 10);
  const tenantId = req.auth!.tenantId;
  const [expenseRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       ROUND(SUM(CASE WHEN m.delta_qty < 0 THEN ABS(m.delta_qty) * COALESCE(p.unit_cost, 0) ELSE 0 END), 2) AS expense_cost,
       ROUND(SUM(CASE WHEN m.delta_qty > 0 THEN m.delta_qty * COALESCE(p.unit_cost, 0) ELSE 0 END), 2) AS stock_added_cost
     FROM inventory_movements m
     LEFT JOIN inventory_products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
     WHERE m.tenant_id = ? AND m.created_at >= ? AND m.created_at < ?`,
    [tenantId, monthStart, nextMonthStart]
  );
  const [paymentRows] = await pool.query<RowDataPacket[]>(
    `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS payments_total
     FROM payments
     WHERE tenant_id = ? AND paid_at >= ? AND paid_at < ?`,
    [tenantId, monthStart, nextMonthStart]
  );
  const [invoiceRows] = await pool.query<RowDataPacket[]>(
    `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS invoices_total
     FROM invoices
     WHERE tenant_id = ? AND issue_date >= ? AND issue_date < ?`,
    [tenantId, monthStart, nextMonthStart]
  );
  res.json({
    month,
    expense_cost: Number(expenseRows[0]?.expense_cost ?? 0),
    stock_added_cost: Number(expenseRows[0]?.stock_added_cost ?? 0),
    payments_total: Number(paymentRows[0]?.payments_total ?? 0),
    invoices_total: Number(invoiceRows[0]?.invoices_total ?? 0),
  });
});

export default router;
