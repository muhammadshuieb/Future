import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { config } from "../config.js";

const router = Router();

router.use(requireAuth);

function periodStartExpr(period: string): string {
  switch (period) {
    case "week":
      return "DATE_SUB(NOW(), INTERVAL 7 DAY)";
    case "quarter":
      return "DATE_SUB(NOW(), INTERVAL 90 DAY)";
    case "year":
      return "DATE_SUB(NOW(), INTERVAL 365 DAY)";
    case "month":
    default:
      return "DATE_SUB(NOW(), INTERVAL 30 DAY)";
  }
}

const periodQuerySchema = z.enum(["week", "month", "quarter", "year"]);

router.get("/stats", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const parsedPeriod = periodQuerySchema.safeParse(
    typeof req.query.period === "string" ? req.query.period : "month"
  );
  const period = parsedPeriod.success ? parsedPeriod.data : "month";
  const since = periodStartExpr(period);

  const empty = {
    totalRevenue: 0,
    monthlyRevenue: 0,
    periodRevenue: 0,
    activeSubscribers: 0,
    pendingInvoices: 0,
    overdueAmount: 0,
    paymentLifetimeByCurrency: [] as { currency: string; amount: number }[],
    paymentPeriodByCurrency: [] as { currency: string; amount: number }[],
    overdueByCurrency: [] as { currency: string; amount: number }[],
    period,
  };

  if (!(await hasTable(pool, "invoices"))) {
    res.json(empty);
    return;
  }

  const conn = await pool.getConnection();
  try {
    const invCols = await getTableColumns(pool, "invoices");
    const currencyExpr = invCols.has("currency")
      ? "COALESCE(NULLIF(UPPER(TRIM(i.currency)), ''), 'USD')"
      : "'USD'";

    let totalRevenue = 0;
    let periodRevenue = 0;
    let paymentLifetimeByCurrency: { currency: string; amount: number }[] = [];
    let paymentPeriodByCurrency: { currency: string; amount: number }[] = [];
    if (await hasTable(pool, "payments")) {
      const [totalRev] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(py.amount), 0) AS total
         FROM payments py
         WHERE py.tenant_id = ?`,
        [tenantId]
      );
      totalRevenue = Number(totalRev[0]?.total ?? 0);
      const [periodRev] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(py.amount), 0) AS total
         FROM payments py
         WHERE py.tenant_id = ? AND py.paid_at >= ${since}`,
        [tenantId]
      );
      periodRevenue = Number(periodRev[0]?.total ?? 0);

      if (await hasTable(pool, "invoices")) {
        const [lifeRows] = await conn.query<RowDataPacket[]>(
          `SELECT ${currencyExpr} AS currency, COALESCE(SUM(py.amount), 0) AS amount
           FROM payments py
           INNER JOIN invoices i ON i.id = py.invoice_id AND i.tenant_id = py.tenant_id
           WHERE py.tenant_id = ?
           GROUP BY ${currencyExpr}`,
          [tenantId]
        );
        paymentLifetimeByCurrency = (lifeRows as RowDataPacket[]).map((r) => ({
          currency: String(r.currency ?? "USD").toUpperCase(),
          amount: Number(r.amount ?? 0),
        }));
        const [periodRows] = await conn.query<RowDataPacket[]>(
          `SELECT ${currencyExpr} AS currency, COALESCE(SUM(py.amount), 0) AS amount
           FROM payments py
           INNER JOIN invoices i ON i.id = py.invoice_id AND i.tenant_id = py.tenant_id
           WHERE py.tenant_id = ? AND py.paid_at >= ${since}
           GROUP BY ${currencyExpr}`,
          [tenantId]
        );
        paymentPeriodByCurrency = (periodRows as RowDataPacket[]).map((r) => ({
          currency: String(r.currency ?? "USD").toUpperCase(),
          amount: Number(r.amount ?? 0),
        }));
      }
    }

    let activeSubscribers = 0;
    if (await hasTable(pool, "radacct")) {
      if (!config.dmaMode && (await hasTable(pool, "subscribers"))) {
        const [activeRows] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(DISTINCT r.username) AS c
           FROM radacct r
           INNER JOIN subscribers s
             ON BINARY s.username = BINARY r.username AND s.tenant_id = ?
           WHERE r.acctstoptime IS NULL
             AND r.username <> ''`,
          [tenantId]
        );
        activeSubscribers = Number(activeRows[0]?.c ?? 0);
      } else if (await hasTable(pool, "rm_users")) {
        const [activeRows] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(DISTINCT r.username) AS c
           FROM radacct r
           INNER JOIN rm_users u ON BINARY u.username = BINARY r.username
           WHERE r.acctstoptime IS NULL
             AND r.username <> ''`
        );
        activeSubscribers = Number(activeRows[0]?.c ?? 0);
      } else {
        const [activeRows] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(DISTINCT username) AS c
           FROM radacct
           WHERE acctstoptime IS NULL
             AND username <> ''`
        );
        activeSubscribers = Number(activeRows[0]?.c ?? 0);
      }
    }

    const [pendingRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c
       FROM invoices
       WHERE tenant_id = ?
         AND LOWER(status) IN ('sent', 'draft', 'pending')`,
      [tenantId]
    );
    const pendingInvoices = Number(pendingRows[0]?.c ?? 0);

    const overdueCurExpr = invCols.has("currency")
      ? "COALESCE(NULLIF(UPPER(TRIM(currency)), ''), 'USD')"
      : "'USD'";
    const [overdueRows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM invoices
       WHERE tenant_id = ?
         AND due_date < CURDATE()
         AND LOWER(COALESCE(status, '')) NOT IN ('paid', 'cancelled', 'void')`,
      [tenantId]
    );
    const overdueAmount = Number(overdueRows[0]?.total ?? 0);

    const [overdueByCurRows] = await conn.query<RowDataPacket[]>(
      `SELECT ${overdueCurExpr} AS currency, COALESCE(SUM(amount), 0) AS amount
       FROM invoices
       WHERE tenant_id = ?
         AND due_date < CURDATE()
         AND LOWER(COALESCE(status, '')) NOT IN ('paid', 'cancelled', 'void')
       GROUP BY ${overdueCurExpr}`,
      [tenantId]
    );
    const overdueByCurrency = (overdueByCurRows as RowDataPacket[]).map((r) => ({
      currency: String(r.currency ?? "USD").toUpperCase(),
      amount: Number(r.amount ?? 0),
    }));

    res.json({
      totalRevenue,
      monthlyRevenue: periodRevenue,
      periodRevenue,
      activeSubscribers,
      pendingInvoices,
      overdueAmount,
      paymentLifetimeByCurrency,
      paymentPeriodByCurrency,
      overdueByCurrency,
      period,
    });
  } finally {
    conn.release();
  }
});

export default router;
