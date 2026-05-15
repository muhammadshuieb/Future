import type { Request } from "express";
import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requestHasIspPermission } from "../lib/isp-permissions.js";
import { withTransaction } from "../db/transaction.js";
import { writeFinancialAudit } from "../services/financial-audit.service.js";
import { writeAuditLog } from "../services/audit-log.service.js";
import { isExpenseDateLockedForRole, requestCanOverrideFinancialFreeze } from "../lib/financial-day-freeze.js";

const router = Router();
router.use(requireAuth);

function denyUnless(req: Request, key: Parameters<typeof requestHasIspPermission>[1]): boolean {
  if (!requestHasIspPermission(req, key)) {
    return true;
  }
  return false;
}

/** جباية من المدير — reduces manager_obligation_balance */
router.post(
  "/settlements/pay",
  requireRole("admin", "accountant"),
  async (req, res) => {
    if (denyUnless(req, "managers:collect_settlement")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const body = z
      .object({
        manager_id: z.string().min(1),
        amount: z.number().positive(),
        currency: z.enum(["USD", "SYP", "TRY"]).optional(),
        payment_method: z.string().max(64).optional(),
        note: z.string().max(512).optional(),
        settlement_id: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (!(await hasTable(pool, "manager_settlement_payments"))) {
      res.status(503).json({ error: "schema_missing" });
      return;
    }
    const t = req.auth!.tenantId;
    const id = randomUUID();
    const cur = (body.data.currency ?? "USD").slice(0, 8);
    try {
      await withTransaction(async (conn) => {
        await conn.execute(
          `INSERT INTO manager_settlement_payments
            (id, tenant_id, settlement_id, manager_id, amount, currency, payment_method, note, created_by)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            id,
            t,
            body.data.settlement_id ?? null,
            body.data.manager_id,
            body.data.amount,
            cur,
            body.data.payment_method ?? "cash",
            body.data.note ?? null,
            req.auth!.sub,
          ]
        );
        if (await hasColumn(pool, "users", "manager_obligation_balance")) {
          await conn.execute(
            `UPDATE users SET manager_obligation_balance = GREATEST(0, COALESCE(manager_obligation_balance, 0) - ?)
             WHERE id = ? AND tenant_id = ?`,
            [body.data.amount, body.data.manager_id, t]
          );
        }
      });
      await writeFinancialAudit(pool, {
        tenantId: t,
        staffId: req.auth!.sub,
        action: "manager_settlement_payment",
        entityType: "manager_settlement_payments",
        entityId: id,
        payload: body.data,
        ip: req.ip,
      });
      void writeAuditLog(pool, {
        tenantId: t,
        staffId: req.auth!.sub,
        action: "manager_settlement_payment",
        entityType: "manager_settlement_payments",
        entityId: id,
        payload: body.data,
      });
      res.status(201).json({ ok: true, id });
    } catch (e) {
      console.error("[settlements/pay]", e);
      res.status(500).json({ error: "failed" });
    }
  }
);

router.get("/settlements/payments", requireRole("admin", "accountant", "manager"), async (req, res) => {
  if (!requestHasIspPermission(req, "managers:view_statement") && req.auth?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "manager_settlement_payments"))) {
    res.json({ items: [] });
    return;
  }
  const tenantId = req.auth!.tenantId;
  let mid = typeof req.query.manager_id === "string" ? req.query.manager_id : null;
  if (req.auth!.role === "manager") mid = req.auth!.sub;
  const args: unknown[] = [tenantId];
  let sql = `SELECT * FROM manager_settlement_payments WHERE tenant_id = ?`;
  if (mid) {
    sql += ` AND manager_id = ?`;
    args.push(mid);
  }
  sql += ` ORDER BY created_at DESC LIMIT 500`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, args);
  res.json({ items: rows });
});

const expenseCategories = z.enum([
  "network_equipment",
  "routers",
  "cables",
  "servers",
  "switches",
  "internet_upstream",
  "electricity",
  "rent",
  "salaries",
  "maintenance",
  "fuel",
  "transport",
  "miscellaneous",
]);

router.get("/expenses", requireRole("admin", "accountant", "manager"), async (req, res) => {
  if (denyUnless(req, "expenses:view")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "company_expenses"))) {
    res.json({ items: [] });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM company_expenses WHERE tenant_id = ? ORDER BY expense_date DESC, created_at DESC LIMIT 500`,
    [req.auth!.tenantId]
  );
  res.json({ items: rows });
});

router.post("/expenses", requireRole("admin", "accountant"), async (req, res) => {
  if (denyUnless(req, "expenses:create")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const p = z
    .object({
      amount: z.number().positive(),
      currency: z.enum(["USD", "SYP", "TRY"]).optional(),
      category: expenseCategories,
      vendor: z.string().max(160).optional(),
      invoice_number: z.string().max(120).optional(),
      payment_method: z.string().max(64).optional(),
      expense_date: z.string().min(1),
      note: z.string().optional(),
      linked_asset_id: z.string().optional(),
    })
    .safeParse(req.body);
  if (!p.success || !(await hasTable(pool, "company_expenses"))) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const expDate = p.data.expense_date.slice(0, 10);
  if (
    (await isExpenseDateLockedForRole(pool, req.auth!.tenantId, expDate, req.auth?.role)) &&
    !requestCanOverrideFinancialFreeze(req)
  ) {
    res.status(403).json({ error: "financial_day_closed" });
    return;
  }
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO company_expenses (id, tenant_id, amount, currency, category, vendor, invoice_number, payment_method, expense_date, note, linked_asset_id, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      req.auth!.tenantId,
      p.data.amount,
      (p.data.currency ?? "USD").slice(0, 8),
      p.data.category,
      p.data.vendor ?? null,
      p.data.invoice_number ?? null,
      p.data.payment_method ?? "cash",
      p.data.expense_date.slice(0, 10),
      p.data.note ?? null,
      p.data.linked_asset_id ?? null,
      req.auth!.sub,
    ]
  );
  void writeAuditLog(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "company_expense_create",
    entityType: "company_expenses",
    entityId: id,
    payload: p.data,
  });
  res.status(201).json({ id });
});

router.get("/assets", requireRole("admin", "accountant", "manager"), async (req, res) => {
  if (denyUnless(req, "assets:view")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "company_assets"))) {
    res.json({ items: [] });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM company_assets WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 500`,
    [req.auth!.tenantId]
  );
  res.json({ items: rows });
});

router.post("/assets", requireRole("admin", "accountant"), async (req, res) => {
  if (denyUnless(req, "assets:create")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const p = z
    .object({
      name: z.string().min(1).max(200),
      asset_type: z.string().max(64),
      serial_number: z.string().max(120).optional(),
      purchase_price: z.number().optional(),
      currency: z.enum(["USD", "SYP", "TRY"]).optional(),
      purchase_date: z.string().optional(),
      current_location: z.string().max(200).optional(),
      assigned_to: z.string().max(200).optional(),
      status: z.enum(["available", "in_use", "damaged", "sold", "lost"]).optional(),
      notes: z.string().optional(),
      linked_expense_id: z.string().optional(),
      tower_label: z.string().max(120).optional(),
      assigned_manager_id: z.string().uuid().optional().nullable(),
      maintenance_status: z.enum(["ok", "due", "in_repair", "damaged", "retired"]).optional(),
    })
    .safeParse(req.body);
  if (!p.success || !(await hasTable(pool, "company_assets"))) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO company_assets (id, tenant_id, name, asset_type, serial_number, purchase_price, currency, purchase_date, current_location, assigned_to, status, notes, linked_expense_id, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      req.auth!.tenantId,
      p.data.name,
      p.data.asset_type,
      p.data.serial_number ?? null,
      p.data.purchase_price ?? null,
      (p.data.currency ?? "USD").slice(0, 8),
      p.data.purchase_date?.slice(0, 10) ?? null,
      p.data.current_location ?? null,
      p.data.assigned_to ?? null,
      p.data.status ?? "available",
      p.data.notes ?? null,
      p.data.linked_expense_id ?? null,
      req.auth!.sub,
    ]
  );
  if (await hasColumn(pool, "company_assets", "tower_label")) {
    await pool.execute(
      `UPDATE company_assets SET tower_label = ?, assigned_manager_id = ?, maintenance_status = COALESCE(?, maintenance_status)
       WHERE id = ? AND tenant_id = ?`,
      [
        p.data.tower_label ?? null,
        p.data.assigned_manager_id ?? null,
        p.data.maintenance_status ?? null,
        id,
        req.auth!.tenantId,
      ]
    );
  }
  void writeAuditLog(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "company_asset_create",
    entityType: "company_assets",
    entityId: id,
    payload: p.data,
  });
  res.status(201).json({ id });
});

router.post("/cashbox/open", requireRole("admin", "accountant"), async (req, res) => {
  if (denyUnless(req, "cashbox:manage")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "cashbox_shifts"))) {
    res.status(503).json({ error: "schema_missing" });
    return;
  }
  const p = z.object({ opening_balance: z.number().min(0), currency: z.enum(["USD", "SYP", "TRY"]).optional() }).safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO cashbox_shifts (id, tenant_id, opened_by, opening_balance, status, currency)
     VALUES (?,?,?,?, 'open', ?)`,
    [id, req.auth!.tenantId, req.auth!.sub, p.data.opening_balance, (p.data.currency ?? "USD").slice(0, 8)]
  );
  void writeAuditLog(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "cashbox_open",
    entityType: "cashbox_shifts",
    entityId: id,
    payload: p.data,
  });
  res.status(201).json({ id });
});

router.post("/cashbox/:id/close", requireRole("admin", "accountant"), async (req, res) => {
  if (denyUnless(req, "cashbox:manage")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const p = z
    .object({ closing_balance_actual: z.number(), collected_cash: z.number().optional(), expenses_paid: z.number().optional(), note: z.string().optional() })
    .safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const shiftId = req.params.id;
  const [sh] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM cashbox_shifts WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [shiftId, req.auth!.tenantId]
  );
  const row = sh[0];
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const openBal = Number(row.opening_balance ?? 0);
  const coll = Number(p.data.collected_cash ?? 0);
  const exp = Number(p.data.expenses_paid ?? 0);
  const expected = openBal + coll - exp;
  const actual = Number(p.data.closing_balance_actual);
  const diff = actual - expected;
  await pool.execute(
    `UPDATE cashbox_shifts SET closed_by = ?, closed_at = CURRENT_TIMESTAMP(3), status = 'closed',
      closing_balance_actual = ?, collected_cash = ?, expenses_paid = ?, expected_balance = ?, difference_amount = ?, note = COALESCE(?, note)
     WHERE id = ? AND tenant_id = ?`,
    [req.auth!.sub, actual, coll, exp, expected, diff, p.data.note ?? null, shiftId, req.auth!.tenantId]
  );
  void writeAuditLog(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "cashbox_close",
    entityType: "cashbox_shifts",
    entityId: shiftId,
    payload: { ...p.data, expected_balance: expected, difference_amount: diff },
  });
  res.json({ ok: true, expected_balance: expected, difference_amount: diff });
});

router.get("/reports/summary", requireRole("admin", "accountant", "manager"), async (req, res) => {
  if (denyUnless(req, "financial_reports:view")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const out: Record<string, unknown> = {};
  if (await hasTable(pool, "payments")) {
    const [rev] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE tenant_id = ?`,
      [tenantId]
    );
    out.total_revenue = Number(rev[0]?.t ?? 0);
  }
  if (await hasTable(pool, "company_expenses")) {
    const [ex] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM company_expenses WHERE tenant_id = ?`,
      [tenantId]
    );
    out.total_expenses = Number(ex[0]?.t ?? 0);
  }
  if (out.total_revenue != null && out.total_expenses != null) {
    out.net_profit = Number(out.total_revenue) - Number(out.total_expenses);
  }
  res.json(out);
});

router.get("/reports/revenue-by-manager", requireRole("admin", "accountant"), async (req, res) => {
  if (denyUnless(req, "financial_reports:view")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "payments")) || !(await hasColumn(pool, "payments", "subscriber_id"))) {
    res.json({ items: [] });
    return;
  }
  if (!(await hasColumn(pool, "subscribers", "responsible_manager_id"))) {
    res.json({ items: [] });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.responsible_manager_id AS manager_id, COALESCE(SUM(py.amount),0) AS total
     FROM payments py
     INNER JOIN subscribers s ON s.id = py.subscriber_id AND s.tenant_id = py.tenant_id
     WHERE py.tenant_id = ? AND s.responsible_manager_id IS NOT NULL
     GROUP BY s.responsible_manager_id`,
    [tenantId]
  );
  res.json({ items: rows });
});

router.get("/wallet/ledger", requireRole("admin", "manager", "accountant"), async (req, res) => {
  if (!requestHasIspPermission(req, "managers:view_wallet")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "manager_wallet_ledger"))) {
    res.json({ items: [] });
    return;
  }
  const tenantId = req.auth!.tenantId;
  let mgr = typeof req.query.manager_id === "string" ? req.query.manager_id : null;
  if (req.auth!.role === "manager") mgr = req.auth!.sub;
  const args: unknown[] = [tenantId];
  let sql = `SELECT * FROM manager_wallet_ledger WHERE tenant_id = ?`;
  if (mgr) {
    sql += ` AND manager_id = ?`;
    args.push(mgr);
  }
  sql += ` ORDER BY created_at DESC LIMIT 500`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, args);
  res.json({ items: rows });
});

router.get("/commissions", requireRole("admin", "accountant", "manager"), async (req, res) => {
  const can =
    !denyUnless(req, "financial_reports:view") ||
    (req.auth?.role === "manager" && requestHasIspPermission(req, "managers:view_statement"));
  if (!can) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "manager_commission_entries"))) {
    res.json({ items: [] });
    return;
  }
  const tenantId = req.auth!.tenantId;
  let mgr = typeof req.query.manager_id === "string" ? req.query.manager_id : null;
  if (req.auth!.role === "manager") mgr = req.auth!.sub;
  const args: unknown[] = [tenantId];
  let sql = `SELECT * FROM manager_commission_entries WHERE tenant_id = ?`;
  if (mgr) {
    sql += ` AND manager_id = ?`;
    args.push(mgr);
  }
  sql += ` ORDER BY created_at DESC LIMIT 500`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, args);
  res.json({ items: rows });
});

router.get("/managers/balances", requireRole("admin", "accountant", "manager"), async (req, res) => {
  if (!requestHasIspPermission(req, "managers:view_wallet")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "users"))) {
    res.json({ items: [] });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.name, u.email,
            COALESCE(u.wallet_balance, 0) AS wallet_balance,
            COALESCE(u.manager_obligation_balance, 0) AS manager_obligation_balance
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id AND r.name = 'manager'
     WHERE u.tenant_id = ?
     ORDER BY u.name`,
    [tenantId]
  );
  let items = rows.map((x) => ({
    manager_id: String(x.id),
    name: String(x.name ?? ""),
    email: String(x.email ?? ""),
    wallet_balance: Number(x.wallet_balance ?? 0),
    manager_obligation_balance: Number(x.manager_obligation_balance ?? 0),
  }));
  if (req.auth!.role === "manager") {
    items = items.filter((x) => x.manager_id === req.auth!.sub);
  }
  res.json({ items });
});

router.get("/cashbox/shifts", requireRole("admin", "accountant", "manager"), async (req, res) => {
  if (denyUnless(req, "cashbox:manage") && denyUnless(req, "financial_reports:view")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "cashbox_shifts"))) {
    res.json({ items: [] });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM cashbox_shifts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`,
    [req.auth!.tenantId]
  );
  res.json({ items: rows });
});

function canExportReports(req: Request): boolean {
  return req.auth?.role === "admin" || requestHasIspPermission(req, "financial_reports:export");
}

router.get("/reports/wallet-statement", requireRole("admin", "accountant", "manager"), async (req, res) => {
  if (!requestHasIspPermission(req, "managers:view_statement")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "manager_wallet_ledger"))) {
    res.json({ items: [] });
    return;
  }
  const tenantId = req.auth!.tenantId;
  let mgr = typeof req.query.manager_id === "string" ? req.query.manager_id : null;
  if (req.auth!.role === "manager") mgr = req.auth!.sub;
  if (!mgr) {
    res.status(400).json({ error: "manager_id_required" });
    return;
  }
  const from =
    typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.slice(0, 10) : null;
  const to =
    typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.slice(0, 10) : null;
  const args: unknown[] = [tenantId, mgr];
  let sql = `SELECT * FROM manager_wallet_ledger WHERE tenant_id = ? AND manager_id = ?`;
  if (from) {
    sql += ` AND created_at >= ?`;
    args.push(`${from} 00:00:00`);
  }
  if (to) {
    sql += ` AND created_at < ?`;
    args.push(`${to} 23:59:59.999`);
  }
  sql += ` ORDER BY created_at ASC LIMIT 2000`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, args);

  const wantCsv = String(req.query.format ?? "") === "csv";
  if (wantCsv && !canExportReports(req)) {
    res.status(403).json({ error: "forbidden", detail: "financial_reports:export" });
    return;
  }
  if (wantCsv) {
    const header = ["id", "type", "amount", "balance_before", "balance_after", "currency", "created_at", "description"];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.id,
          r.type,
          r.amount,
          r.balance_before,
          r.balance_after,
          r.currency,
          r.created_at,
          (r.description ?? "").toString().replace(/,/g, " "),
        ].join(",")
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(lines.join("\n"));
    return;
  }
  res.json({ items: rows });
});

router.get("/reports/manager-obligations", requireRole("admin", "accountant", "manager"), async (req, res) => {
  if (denyUnless(req, "financial_reports:view")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasColumn(pool, "users", "manager_obligation_balance"))) {
    res.json({ items: [] });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id AS manager_id, u.name, u.email,
            COALESCE(u.manager_obligation_balance, 0) AS obligation_balance,
            COALESCE(u.wallet_balance, 0) AS wallet_balance
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id AND r.name = 'manager'
     WHERE u.tenant_id = ?`,
    [tenantId]
  );
  let items = rows.map((x) => ({
    manager_id: String(x.manager_id),
    name: String(x.name ?? ""),
    email: String(x.email ?? ""),
    obligation_balance: Number(x.obligation_balance ?? 0),
    wallet_balance: Number(x.wallet_balance ?? 0),
  }));
  if (req.auth!.role === "manager") {
    items = items.filter((x) => x.manager_id === req.auth!.sub);
  }
  res.json({ items });
});

router.get("/reports/unpaid-by-manager", requireRole("admin", "accountant", "manager"), async (req, res) => {
  if (denyUnless(req, "financial_reports:view")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "invoices")) || !(await hasColumn(pool, "subscribers", "responsible_manager_id"))) {
    res.json({ items: [] });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.responsible_manager_id AS manager_id,
            COUNT(DISTINCT i.id) AS unpaid_invoices,
            COALESCE(SUM(GREATEST(0,
              CAST(i.amount AS DECIMAL(14,2)) - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.tenant_id = i.tenant_id), 0)
            )), 0) AS outstanding
     FROM invoices i
     INNER JOIN subscribers s ON s.id = i.subscriber_id AND s.tenant_id = i.tenant_id
     WHERE i.tenant_id = ? AND LOWER(i.status) <> 'paid' AND s.responsible_manager_id IS NOT NULL
     GROUP BY s.responsible_manager_id`,
    [tenantId]
  );
  let items = rows.map((x) => ({
    manager_id: String(x.manager_id),
    unpaid_invoices: Number(x.unpaid_invoices ?? 0),
    outstanding: Number(x.outstanding ?? 0),
  }));
  if (req.auth!.role === "manager") {
    items = items.filter((x) => x.manager_id === req.auth!.sub);
  }
  res.json({ items });
});

router.get("/reports/prepaid-sales-by-manager", requireRole("admin", "accountant", "manager"), async (req, res) => {
  if (denyUnless(req, "financial_reports:view")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "prepaid_card_batches"))) {
    res.json({ items: [] });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT printed_by AS manager_id,
            COALESCE(SUM(batch_total_amount), 0) AS total_amount,
            COUNT(*) AS batch_count
     FROM prepaid_card_batches
     WHERE tenant_id = ?
     GROUP BY printed_by`,
    [tenantId]
  );
  let items = rows.map((x) => ({
    manager_id: x.manager_id != null ? String(x.manager_id) : null,
    total_amount: Number(x.total_amount ?? 0),
    batch_count: Number(x.batch_count ?? 0),
  }));
  if (req.auth!.role === "manager") {
    items = items.filter((x) => x.manager_id === req.auth!.sub);
  }
  res.json({ items });
});

router.patch("/expenses/:id", requireRole("admin", "accountant"), async (req, res) => {
  if (denyUnless(req, "expenses:update")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "company_expenses"))) {
    res.status(503).json({ error: "schema_missing" });
    return;
  }
  const p = z
    .object({
      amount: z.number().positive().optional(),
      currency: z.enum(["USD", "SYP", "TRY"]).optional(),
      category: expenseCategories.optional(),
      vendor: z.string().max(160).optional().nullable(),
      invoice_number: z.string().max(120).optional().nullable(),
      payment_method: z.string().max(64).optional(),
      expense_date: z.string().optional(),
      note: z.string().optional().nullable(),
      linked_asset_id: z.string().optional().nullable(),
    })
    .safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = req.params.id;
  const [ex] = await pool.query<RowDataPacket[]>(
    `SELECT id, expense_date FROM company_expenses WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, req.auth!.tenantId]
  );
  if (!ex[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const priorDate = String(ex[0].expense_date ?? "").slice(0, 10);
  const newDate = p.data.expense_date != null ? p.data.expense_date.slice(0, 10) : priorDate;
  if (
    (await isExpenseDateLockedForRole(pool, req.auth!.tenantId, newDate, req.auth?.role)) &&
    !requestCanOverrideFinancialFreeze(req)
  ) {
    res.status(403).json({ error: "financial_day_closed" });
    return;
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  const d = p.data;
  if (d.amount !== undefined) {
    sets.push("amount = ?");
    vals.push(d.amount);
  }
  if (d.currency !== undefined) {
    sets.push("currency = ?");
    vals.push(d.currency.slice(0, 8));
  }
  if (d.category !== undefined) {
    sets.push("category = ?");
    vals.push(d.category);
  }
  if (d.vendor !== undefined) {
    sets.push("vendor = ?");
    vals.push(d.vendor);
  }
  if (d.invoice_number !== undefined) {
    sets.push("invoice_number = ?");
    vals.push(d.invoice_number);
  }
  if (d.payment_method !== undefined) {
    sets.push("payment_method = ?");
    vals.push(d.payment_method);
  }
  if (d.expense_date !== undefined) {
    sets.push("expense_date = ?");
    vals.push(d.expense_date.slice(0, 10));
  }
  if (d.note !== undefined) {
    sets.push("note = ?");
    vals.push(d.note);
  }
  if (d.linked_asset_id !== undefined) {
    sets.push("linked_asset_id = ?");
    vals.push(d.linked_asset_id);
  }
  if (!sets.length) {
    res.json({ ok: true });
    return;
  }
  await pool.query(`UPDATE company_expenses SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, [
    ...vals,
    id,
    req.auth!.tenantId,
  ]);
  void writeFinancialAudit(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "company_expense_update",
    entityType: "company_expenses",
    entityId: id,
    payload: p.data,
    ip: req.ip,
  });
  void writeAuditLog(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "company_expense_update",
    entityType: "company_expenses",
    entityId: id,
    payload: p.data,
  });
  res.json({ ok: true });
});

router.delete("/expenses/:id", requireRole("admin", "accountant"), async (req, res) => {
  if (denyUnless(req, "expenses:delete")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "company_expenses"))) {
    res.status(503).json({ error: "schema_missing" });
    return;
  }
  const id = req.params.id;
  const [r] = await pool.execute(`DELETE FROM company_expenses WHERE id = ? AND tenant_id = ?`, [
    id,
    req.auth!.tenantId,
  ]);
  const n = (r as { affectedRows?: number }).affectedRows ?? 0;
  if (!n) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  void writeFinancialAudit(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "company_expense_delete",
    entityType: "company_expenses",
    entityId: id,
    payload: {},
    ip: req.ip,
  });
  void writeAuditLog(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "company_expense_delete",
    entityType: "company_expenses",
    entityId: id,
    payload: {},
  });
  res.json({ ok: true });
});

router.patch("/assets/:id", requireRole("admin", "accountant"), async (req, res) => {
  if (denyUnless(req, "assets:update")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "company_assets"))) {
    res.status(503).json({ error: "schema_missing" });
    return;
  }
  const p = z
    .object({
      name: z.string().min(1).max(200).optional(),
      asset_type: z.string().max(64).optional(),
      serial_number: z.string().max(120).optional().nullable(),
      purchase_price: z.number().optional().nullable(),
      currency: z.enum(["USD", "SYP", "TRY"]).optional(),
      purchase_date: z.string().optional().nullable(),
      current_location: z.string().max(200).optional().nullable(),
      assigned_to: z.string().max(200).optional().nullable(),
      status: z.enum(["available", "in_use", "damaged", "sold", "lost"]).optional(),
      notes: z.string().optional().nullable(),
      linked_expense_id: z.string().optional().nullable(),
      tower_label: z.string().max(120).optional().nullable(),
      assigned_manager_id: z.string().uuid().optional().nullable(),
      maintenance_status: z.enum(["ok", "due", "in_repair", "damaged", "retired"]).optional(),
    })
    .safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = req.params.id;
  const [ex] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM company_assets WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, req.auth!.tenantId]
  );
  if (!ex[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  const d = p.data;
  if (d.name !== undefined) {
    sets.push("name = ?");
    vals.push(d.name);
  }
  if (d.asset_type !== undefined) {
    sets.push("asset_type = ?");
    vals.push(d.asset_type);
  }
  if (d.serial_number !== undefined) {
    sets.push("serial_number = ?");
    vals.push(d.serial_number);
  }
  if (d.purchase_price !== undefined) {
    sets.push("purchase_price = ?");
    vals.push(d.purchase_price);
  }
  if (d.currency !== undefined) {
    sets.push("currency = ?");
    vals.push(d.currency.slice(0, 8));
  }
  if (d.purchase_date !== undefined) {
    sets.push("purchase_date = ?");
    vals.push(d.purchase_date?.slice(0, 10) ?? null);
  }
  if (d.current_location !== undefined) {
    sets.push("current_location = ?");
    vals.push(d.current_location);
  }
  if (d.assigned_to !== undefined) {
    sets.push("assigned_to = ?");
    vals.push(d.assigned_to);
  }
  if (d.status !== undefined) {
    sets.push("status = ?");
    vals.push(d.status);
  }
  if (d.notes !== undefined) {
    sets.push("notes = ?");
    vals.push(d.notes);
  }
  if (d.linked_expense_id !== undefined) {
    sets.push("linked_expense_id = ?");
    vals.push(d.linked_expense_id);
  }
  if (d.tower_label !== undefined && (await hasColumn(pool, "company_assets", "tower_label"))) {
    sets.push("tower_label = ?");
    vals.push(d.tower_label);
  }
  if (d.assigned_manager_id !== undefined && (await hasColumn(pool, "company_assets", "assigned_manager_id"))) {
    sets.push("assigned_manager_id = ?");
    vals.push(d.assigned_manager_id);
  }
  if (d.maintenance_status !== undefined && (await hasColumn(pool, "company_assets", "maintenance_status"))) {
    sets.push("maintenance_status = ?");
    vals.push(d.maintenance_status);
  }
  if (!sets.length) {
    res.json({ ok: true });
    return;
  }
  await pool.query(`UPDATE company_assets SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, [
    ...vals,
    id,
    req.auth!.tenantId,
  ]);
  void writeFinancialAudit(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "company_asset_update",
    entityType: "company_assets",
    entityId: id,
    payload: p.data,
    ip: req.ip,
  });
  void writeAuditLog(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "company_asset_update",
    entityType: "company_assets",
    entityId: id,
    payload: p.data,
  });
  res.json({ ok: true });
});

export default router;
