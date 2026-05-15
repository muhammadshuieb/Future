import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requestHasIspPermission } from "../lib/isp-permissions.js";
import { writeAuditLog } from "../services/audit-log.service.js";
import { writeFinancialAudit } from "../services/financial-audit.service.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin", "manager", "accountant", "viewer"));

function canViewFinancial(req: import("express").Request): boolean {
  return requestHasIspPermission(req, "financial_reports:view");
}

router.get("/dashboard", async (req, res) => {
  if (!canViewFinancial(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  try {
    const payload = await buildDashboardPayload(tenantId);
    res.json(payload);
  } catch (e) {
    console.error("[financial-analytics/dashboard]", e);
    res.status(500).json({ error: "failed" });
  }
});

router.get("/kpis", async (req, res) => {
  if (!canViewFinancial(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const k = await buildKpis(req.auth!.tenantId);
    res.json(k);
  } catch (e) {
    console.error("[financial-analytics/kpis]", e);
    res.status(500).json({ error: "failed" });
  }
});

router.get("/alerts", async (req, res) => {
  if (!canViewFinancial(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const items = await computeFinancialAlerts(req.auth!.tenantId, req.auth!.sub);
    res.json({ items });
  } catch (e) {
    console.error("[financial-analytics/alerts]", e);
    res.status(500).json({ error: "failed" });
  }
});

router.post("/alerts/dismiss", async (req, res) => {
  if (!canViewFinancial(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const p = z.object({ alert_key: z.string().min(1).max(160) }).safeParse(req.body);
  if (!p.success || !(await hasTable(pool, "financial_alert_dismissals"))) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO financial_alert_dismissals (id, tenant_id, staff_id, alert_key)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE dismissed_at = CURRENT_TIMESTAMP(3)`,
    [id, req.auth!.tenantId, req.auth!.sub, p.data.alert_key]
  );
  res.json({ ok: true });
});

router.get("/closings", requireRole("admin", "accountant"), async (req, res) => {
  if (!requestHasIspPermission(req, "cashbox:manage") && req.auth?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "financial_day_closings"))) {
    res.json({ items: [] });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM financial_day_closings WHERE tenant_id = ? ORDER BY business_date DESC LIMIT 90`,
    [req.auth!.tenantId]
  );
  res.json({ items: rows });
});

router.post("/closings", requireRole("admin", "accountant"), async (req, res) => {
  if (!requestHasIspPermission(req, "cashbox:manage") && req.auth?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!(await hasTable(pool, "financial_day_closings"))) {
    res.status(503).json({ error: "schema_missing" });
    return;
  }
  const p = z
    .object({
      business_date: z.string().min(10).max(10),
      expected_cash: z.number().optional(),
      actual_cash: z.number(),
      notes: z.string().max(2000).optional(),
      signature_name: z.string().max(160).optional(),
    })
    .safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const bd = p.data.business_date.slice(0, 10);
  const expected = Number(p.data.expected_cash ?? p.data.actual_cash);
  const actual = Number(p.data.actual_cash);
  const variance = actual - expected;
  const id = randomUUID();
  try {
    await pool.execute(
      `INSERT INTO financial_day_closings
        (id, tenant_id, business_date, status, expected_cash, actual_cash, variance_amount, notes, signature_name, closed_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        req.auth!.tenantId,
        bd,
        "closed",
        expected,
        actual,
        variance,
        p.data.notes ?? null,
        p.data.signature_name ?? null,
        req.auth!.sub,
      ]
    );
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "day_already_closed" });
      return;
    }
    throw e;
  }
  await writeFinancialAudit(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "financial_day_close",
    entityType: "financial_day_closings",
    entityId: id,
    payload: { business_date: bd, variance_amount: variance },
    ip: req.ip,
  });
  void writeAuditLog(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    action: "financial_day_close",
    entityType: "financial_day_closings",
    entityId: id,
    payload: { business_date: bd },
  });
  res.status(201).json({ ok: true, id, variance_amount: variance });
});

router.get("/closings/:businessDate/report", requireRole("admin", "accountant", "manager", "viewer"), async (req, res) => {
  if (!canViewFinancial(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const bd = req.params.businessDate.slice(0, 10);
  if (!(await hasTable(pool, "financial_day_closings"))) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [cl] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM financial_day_closings WHERE tenant_id = ? AND business_date = ? LIMIT 1`,
    [req.auth!.tenantId, bd]
  );
  if (!cl[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const summary = await buildDaySummary(req.auth!.tenantId, bd);
  res.json({ closing: cl[0], summary });
});

async function buildDaySummary(tenantId: string, businessDate: string) {
  const out: Record<string, unknown> = { business_date: businessDate };
  if (await hasTable(pool, "payments")) {
    const [py] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE tenant_id = ? AND DATE(paid_at) = ?`,
      [tenantId, businessDate]
    );
    out.payments_total = Number(py[0]?.t ?? 0);
  }
  if (await hasTable(pool, "company_expenses")) {
    const [ex] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM company_expenses WHERE tenant_id = ? AND expense_date = ?`,
      [tenantId, businessDate]
    );
    out.expenses_total = Number(ex[0]?.t ?? 0);
  }
  if (await hasTable(pool, "prepaid_card_batches")) {
    const [pb] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(batch_total_amount),0) AS t FROM prepaid_card_batches WHERE tenant_id = ? AND DATE(created_at) = ?`,
      [tenantId, businessDate]
    );
    out.prepaid_batches_total = Number(pb[0]?.t ?? 0);
  }
  return out;
}

async function buildKpis(tenantId: string) {
  const monthStart = `DATE_FORMAT(NOW(), '%Y-%m-01')`;
  let active = 0;
  let expired30 = 0;
  let revenueMonth = 0;
  let invoicedMonth = 0;
  let paidMonth = 0;

  if (await hasTable(pool, "subscribers")) {
    const [a] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ? AND status = 'active'
       AND (expiration_date IS NULL OR DATE(expiration_date) > CURDATE())`,
      [tenantId]
    );
    active = Number(a[0]?.c ?? 0);
    const [e] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ?
       AND (status = 'expired' OR (expiration_date IS NOT NULL AND DATE(expiration_date) <= CURDATE()))
       AND updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [tenantId]
    );
    expired30 = Number(e[0]?.c ?? 0);
  }

  if (await hasTable(pool, "payments")) {
    const [r] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE tenant_id = ? AND paid_at >= ${monthStart}`,
      [tenantId]
    );
    revenueMonth = paidMonth = Number(r[0]?.t ?? 0);
  }

  if (await hasTable(pool, "invoices")) {
    const [inv] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM invoices WHERE tenant_id = ? AND issue_date >= ${monthStart}`,
      [tenantId]
    );
    invoicedMonth = Number(inv[0]?.t ?? 0);
  }

  const arpu = active > 0 ? Math.round((revenueMonth / active) * 100) / 100 : 0;
  const base = active + expired30;
  const churnPct = base > 0 ? Math.round((expired30 / base) * 10000) / 100 : 0;
  const collectionRate = invoicedMonth > 0 ? Math.round((paidMonth / invoicedMonth) * 10000) / 100 : 100;

  let overduePct = 0;
  if (await hasTable(pool, "invoices")) {
    const [ov] = await pool.query<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN LOWER(status) <> 'paid' AND due_date < CURDATE() THEN amount ELSE 0 END),0) AS overdue,
         COALESCE(SUM(amount),0) AS total
       FROM invoices WHERE tenant_id = ?`,
      [tenantId]
    );
    const tot = Number(ov[0]?.total ?? 0);
    const od = Number(ov[0]?.overdue ?? 0);
    overduePct = tot > 0 ? Math.round((od / tot) * 10000) / 100 : 0;
  }

  return {
    arpu,
    churn_rate_percent: churnPct,
    collection_rate_percent: collectionRate,
    active_subscribers: active,
    expired_last_30: expired30,
    revenue_this_month: revenueMonth,
    invoiced_this_month: invoicedMonth,
    overdue_share_of_invoiced_percent: overduePct,
  };
}

async function buildDashboardPayload(tenantId: string) {
  const widgets: Record<string, unknown> = {};
  const charts: Record<string, unknown[]> = {};

  if (await hasTable(pool, "payments")) {
    const [rt] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE tenant_id = ? AND DATE(paid_at) = CURDATE()`,
      [tenantId]
    );
    widgets.revenue_today = Number(rt[0]?.t ?? 0);
    const [rm] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM payments
       WHERE tenant_id = ? AND paid_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
      [tenantId]
    );
    widgets.revenue_this_month = Number(rm[0]?.t ?? 0);

    const [mr] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS m, COALESCE(SUM(amount),0) AS total
       FROM payments WHERE tenant_id = ? AND paid_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY DATE_FORMAT(paid_at, '%Y-%m') ORDER BY m ASC`,
      [tenantId]
    );
    charts.monthly_revenue = mr.map((r) => ({ month: String(r.m), amount: Number(r.total ?? 0) }));

    const [tm] = await pool.query<RowDataPacket[]>(
      `SELECT s.responsible_manager_id AS manager_id, u.name AS manager_name,
              COALESCE(SUM(py.amount),0) AS total
       FROM payments py
       INNER JOIN invoices i ON i.id = py.invoice_id AND i.tenant_id = py.tenant_id
       INNER JOIN subscribers s ON s.id = i.subscriber_id AND s.tenant_id = py.tenant_id
       LEFT JOIN users u ON u.id = s.responsible_manager_id AND u.tenant_id = py.tenant_id
       WHERE py.tenant_id = ? AND py.paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND s.responsible_manager_id IS NOT NULL
       GROUP BY s.responsible_manager_id, u.name
       ORDER BY total DESC LIMIT 8`,
      [tenantId]
    );
    charts.collections_by_manager = tm.map((r) => ({
      manager_id: r.manager_id ? String(r.manager_id) : "",
      manager_name: String(r.manager_name ?? ""),
      amount: Number(r.total ?? 0),
    }));

    const [tmc] = await pool.query<RowDataPacket[]>(
      `SELECT s.responsible_manager_id AS manager_id, u.name AS manager_name,
              COALESCE(SUM(py.amount),0) AS total
       FROM payments py
       INNER JOIN invoices i ON i.id = py.invoice_id AND i.tenant_id = py.tenant_id
       INNER JOIN subscribers s ON s.id = i.subscriber_id AND s.tenant_id = py.tenant_id
       LEFT JOIN users u ON u.id = s.responsible_manager_id AND u.tenant_id = py.tenant_id
       WHERE py.tenant_id = ? AND py.paid_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
         AND s.responsible_manager_id IS NOT NULL
       GROUP BY s.responsible_manager_id, u.name
       ORDER BY total DESC LIMIT 8`,
      [tenantId]
    );
    widgets.top_managers_collections = tmc.map((r) => ({
      manager_id: r.manager_id ? String(r.manager_id) : "",
      name: String(r.manager_name ?? ""),
      total: Number(r.total ?? 0),
    }));
  } else {
    widgets.revenue_today = 0;
    widgets.revenue_this_month = 0;
    charts.monthly_revenue = [];
    charts.collections_by_manager = [];
    widgets.top_managers_collections = [];
  }

  if (await hasTable(pool, "subscribers")) {
    const [ac] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ?
       AND status = 'active' AND (expiration_date IS NULL OR DATE(expiration_date) > CURDATE())`,
      [tenantId]
    );
    widgets.active_subscribers = Number(ac[0]?.c ?? 0);
  } else {
    widgets.active_subscribers = 0;
  }

  if (await hasTable(pool, "invoices")) {
    const [un] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS amt
       FROM invoices WHERE tenant_id = ? AND LOWER(status) <> 'paid'`,
      [tenantId]
    );
    widgets.unpaid_invoices = Number(un[0]?.c ?? 0);
    const [ov] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS amt
       FROM invoices WHERE tenant_id = ? AND LOWER(status) = 'sent' AND due_date < CURDATE()`,
      [tenantId]
    );
    widgets.overdue_invoices = Number(ov[0]?.c ?? 0);
    widgets.overdue_amount = Number(ov[0]?.amt ?? 0);
  } else {
    widgets.unpaid_invoices = 0;
    widgets.overdue_invoices = 0;
    widgets.overdue_amount = 0;
  }

  if (await hasColumn(pool, "users", "manager_obligation_balance")) {
    const [ob] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(u.manager_obligation_balance),0) AS t
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id AND r.name = 'manager'
       WHERE u.tenant_id = ?`,
      [tenantId]
    );
    widgets.manager_obligations_total = Number(ob[0]?.t ?? 0);
  } else {
    widgets.manager_obligations_total = 0;
  }

  if (await hasColumn(pool, "users", "wallet_balance")) {
    const [wb] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(u.wallet_balance),0) AS t
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id AND r.name = 'manager'
       WHERE u.tenant_id = ?`,
      [tenantId]
    );
    widgets.manager_wallet_balances_total = Number(wb[0]?.t ?? 0);
  } else {
    widgets.manager_wallet_balances_total = 0;
  }

  if (await hasTable(pool, "prepaid_card_batches")) {
    const [pt] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(batch_total_amount),0) AS t FROM prepaid_card_batches
       WHERE tenant_id = ? AND DATE(created_at) = CURDATE()`,
      [tenantId]
    );
    widgets.prepaid_sales_today = Number(pt[0]?.t ?? 0);
    const [ptr] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS m, COALESCE(SUM(batch_total_amount),0) AS total
       FROM prepaid_card_batches WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY m ASC`,
      [tenantId]
    );
    charts.prepaid_sales_trend = ptr.map((r) => ({ month: String(r.m), amount: Number(r.total ?? 0) }));
  } else {
    widgets.prepaid_sales_today = 0;
    charts.prepaid_sales_trend = [];
  }

  if (await hasTable(pool, "company_expenses")) {
    const [et] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM company_expenses
       WHERE tenant_id = ? AND expense_date = CURDATE()`,
      [tenantId]
    );
    widgets.expenses_today = Number(et[0]?.t ?? 0);
    const [em] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM company_expenses
       WHERE tenant_id = ? AND expense_date >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
      [tenantId]
    );
    widgets.expenses_this_month = Number(em[0]?.t ?? 0);
    const [ec] = await pool.query<RowDataPacket[]>(
      `SELECT category, COALESCE(SUM(amount),0) AS total
       FROM company_expenses
       WHERE tenant_id = ? AND expense_date >= DATE_FORMAT(NOW(), '%Y-%m-01')
       GROUP BY category ORDER BY total DESC`,
      [tenantId]
    );
    charts.expenses_by_category = ec.map((r) => ({
      category: String(r.category),
      amount: Number(r.total ?? 0),
    }));
  } else {
    widgets.expenses_today = 0;
    widgets.expenses_this_month = 0;
    charts.expenses_by_category = [];
  }

  const rev = Number(widgets.revenue_this_month ?? 0);
  const ex = Number(widgets.expenses_this_month ?? 0);
  widgets.net_profit_month = Math.round((rev - ex) * 100) / 100;

  if ((await hasTable(pool, "payments")) && (await hasTable(pool, "invoices")) && (await hasTable(pool, "packages"))) {
    const [tpr] = await pool.query<RowDataPacket[]>(
      `SELECT pkg.id AS package_id, pkg.name AS package_name, COALESCE(SUM(py.amount),0) AS total
       FROM payments py
       INNER JOIN invoices i ON i.id = py.invoice_id AND i.tenant_id = py.tenant_id
       INNER JOIN subscribers s ON s.id = i.subscriber_id AND s.tenant_id = py.tenant_id
       INNER JOIN packages pkg ON pkg.id = s.package_id AND pkg.tenant_id = s.tenant_id
       WHERE py.tenant_id = ? AND py.paid_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
       GROUP BY pkg.id, pkg.name
       ORDER BY total DESC LIMIT 8`,
      [tenantId]
    );
    widgets.top_packages_revenue = tpr.map((r) => ({
      package_id: r.package_id != null ? String(r.package_id) : "",
      name: String(r.package_name ?? "—"),
      total: Number(r.total ?? 0),
    }));
  } else {
    widgets.top_packages_revenue = [];
  }

  const pl: { month: string; revenue: number; expenses: number; profit: number }[] = [];
  if (await hasTable(pool, "payments")) {
    const [pm] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS m, COALESCE(SUM(amount),0) AS total
       FROM payments WHERE tenant_id = ? AND paid_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY DATE_FORMAT(paid_at, '%Y-%m')`,
      [tenantId]
    );
    const revMap = new Map(pm.map((r) => [String(r.m), Number(r.total ?? 0)]));
    const exMap = new Map<string, number>();
    if (await hasTable(pool, "company_expenses")) {
      const [xm] = await pool.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(expense_date, '%Y-%m') AS m, COALESCE(SUM(amount),0) AS total
         FROM company_expenses WHERE tenant_id = ? AND expense_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
         GROUP BY DATE_FORMAT(expense_date, '%Y-%m')`,
        [tenantId]
      );
      for (const r of xm) exMap.set(String(r.m), Number(r.total ?? 0));
    }
    const months = new Set([...revMap.keys(), ...exMap.keys()]);
    for (const m of [...months].sort()) {
      const r = revMap.get(m) ?? 0;
      const x = exMap.get(m) ?? 0;
      pl.push({ month: m, revenue: r, expenses: x, profit: Math.round((r - x) * 100) / 100 });
    }
    pl.sort((a, b) => a.month.localeCompare(b.month));
  }
  charts.profit_loss_trend = pl;

  const kpis = await buildKpis(tenantId);

  let packageProfitability: { package_id: string; name: string; revenue: number; subscribers: number }[] = [];
  if (await hasTable(pool, "subscribers") && await hasTable(pool, "packages")) {
    const [pp] = await pool.query<RowDataPacket[]>(
      `SELECT s.package_id AS package_id, p.name AS package_name,
              COUNT(*) AS subs,
              COALESCE(p.price,0) AS price
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
       WHERE s.tenant_id = ? AND s.package_id IS NOT NULL
       GROUP BY s.package_id, p.name, p.price
       ORDER BY subs DESC LIMIT 10`,
      [tenantId]
    );
    packageProfitability = pp.map((r) => ({
      package_id: r.package_id != null ? String(r.package_id) : "",
      name: String(r.package_name ?? "—"),
      revenue: Number(r.price ?? 0) * Number(r.subs ?? 0),
      subscribers: Number(r.subs ?? 0),
    }));
  }

  return {
    widgets,
    charts,
    kpis,
    package_profitability: packageProfitability,
  };
}

type AlertItem = {
  id: string;
  key: string;
  severity: "info" | "warning" | "danger";
  title_ar: string;
  detail_ar: string;
};

async function computeFinancialAlerts(tenantId: string, staffId: string): Promise<AlertItem[]> {
  const out: AlertItem[] = [];
  let dismiss = new Set<string>();
  if (await hasTable(pool, "financial_alert_dismissals")) {
    const [dr] = await pool.query<RowDataPacket[]>(
      `SELECT alert_key FROM financial_alert_dismissals WHERE tenant_id = ? AND staff_id = ?`,
      [tenantId, staffId]
    );
    dismiss = new Set(dr.map((r) => String(r.alert_key)));
  }

  const push = (key: string, severity: AlertItem["severity"], title_ar: string, detail_ar: string) => {
    if (dismiss.has(key)) return;
    out.push({ id: key, key, severity, title_ar, detail_ar });
  };

  if (await hasColumn(pool, "users", "wallet_balance")) {
    const hasLim = await hasColumn(pool, "users", "allowed_negative_balance");
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.wallet_balance${hasLim ? ", COALESCE(u.allowed_negative_balance,0) AS lim" : ", 0 AS lim"}
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id AND r.name = 'manager'
       WHERE u.tenant_id = ?`,
      [tenantId]
    );
    for (const u of rows) {
      const bal = Number(u.wallet_balance ?? 0);
      const lim = hasLim ? Number(u.lim ?? 0) : 0;
      if (lim <= 0 && bal < 0) {
        push(
          `wallet_negative_no_limit_${u.id}`,
          "danger",
          "رصيد محفظة سالب",
          `${String(u.name ?? "")}: الرصيد ${bal}`
        );
      } else if (lim > 0 && bal <= -lim) {
        push(
          `wallet_limit_${u.id}`,
          "danger",
          bal < -lim ? "تجاوز الحد المسموح للرصيد السالب" : "رصيد محفظة مدير عند الحد السالب",
          `${String(u.name ?? "")}: الرصيد ${bal} والحد المسموح -${lim}`
        );
      } else if (lim > 0 && bal < 0 && bal > -lim && bal <= -lim * 0.9) {
        push(
          `wallet_near_limit_${u.id}`,
          "warning",
          "اقتراب رصيد المحفظة من الحد السالب",
          `${String(u.name ?? "")}: الرصيد ${bal}`
        );
      }
    }
  }

  if (await hasTable(pool, "invoices")) {
    const [ov] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS amt
       FROM invoices WHERE tenant_id = ? AND LOWER(status) = 'sent' AND due_date < CURDATE()`,
      [tenantId]
    );
    const c = Number(ov[0]?.c ?? 0);
    if (c > 0) {
      push("overdue_invoices", "warning", "فواتير متأخرة غير المسددة", `${c} فاتورة، إجمالي ${Number(ov[0]?.amt ?? 0).toFixed(2)}`);
    }
  }

  if (await hasTable(pool, "prepaid_card_batches")) {
    const [pb] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(batch_total_amount),0) AS t, COUNT(*) AS n
       FROM prepaid_card_batches WHERE tenant_id = ? AND DATE(created_at) = CURDATE()`,
      [tenantId]
    );
    const amt = Number(pb[0]?.t ?? 0);
    const n = Number(pb[0]?.n ?? 0);
    if (amt > 50000 || n > 200) {
      push("prepaid_high_volume", "info", "حجم طباعة بطاقات مرتفع اليوم", `${n} دفعة، قيمة ${amt}`);
    }
  }

  if (await hasTable(pool, "cashbox_shifts")) {
    const [cs] = await pool.query<RowDataPacket[]>(
      `SELECT difference_amount, closed_at FROM cashbox_shifts
       WHERE tenant_id = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT 1`,
      [tenantId]
    );
    const diff = Number(cs[0]?.difference_amount ?? 0);
    if (cs[0] && diff < -500) {
      push("cashbox_variance", "warning", "فرق صندوق كبير في آخر إغلاق", `الفرق ${diff}`);
    }
    const [open] = await pool.query<RowDataPacket[]>(
      `SELECT opening_balance, currency FROM cashbox_shifts
       WHERE tenant_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    );
    if (open[0]) {
      const ob = Number(open[0].opening_balance ?? 0);
      if (ob >= 0 && ob < 300) {
        push("cashbox_low_opening", "warning", "رصيد افتتاح الصندوق منخفض", `الرصيد الافتتاحي ${ob} ${String(open[0].currency ?? "")}`);
      }
    }
  }

  if (await hasTable(pool, "company_expenses")) {
    const [td] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount),0) AS t FROM company_expenses WHERE tenant_id = ? AND expense_date = CURDATE()`,
      [tenantId]
    );
    const [avg] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(AVG(daily_sum),0) AS a FROM (
         SELECT expense_date, SUM(amount) AS daily_sum FROM company_expenses
         WHERE tenant_id = ? AND expense_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY expense_date
       ) x`,
      [tenantId]
    );
    const today = Number(td[0]?.t ?? 0);
    const av = Number(avg[0]?.a ?? 0);
    if (av > 0 && today > av * 4) {
      push("high_expenses_today", "warning", "مصاريف اليوم أعلى من المعتاد", `اليوم ${today} مقابل متوسط يومي ~${av.toFixed(0)}`);
    }
  }

  if (await hasTable(pool, "financial_audit_logs")) {
    const [fa] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM financial_audit_logs
       WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         AND action = 'finance_permission_denied'`,
      [tenantId]
    );
    const c = Number(fa[0]?.c ?? 0);
    if (c > 0) {
      push(
        "finance_permission_denied_recent",
        "warning",
        "محاولات مالية مرفوضة",
        `${c} حدث مسجّل خلال آخر 7 أيام (صلاحية/قيود تشغيل).`
      );
    }
  }

  if (await hasTable(pool, "manager_settlements")) {
    const [ms] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM manager_settlements
       WHERE tenant_id = ? AND status IN ('failed','rejected','void') AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)`,
      [tenantId]
    );
    const c = Number(ms[0]?.c ?? 0);
    if (c > 0) {
      push("settlement_failed_recent", "danger", "تسويات غير مكتملة", `${c} تسوية بحالة فشل/إلغاء خلال 14 يوماً`);
    }
  }

  return out;
}

export default router;
