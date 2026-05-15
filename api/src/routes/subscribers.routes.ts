import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import { requestHasFinancePermission } from "../lib/finance-permissions.js";
import { requestHasManagerPermission } from "../lib/manager-permissions.js";
import { RadiusSyncService } from "../services/radius-sync.service.js";
import { computeSubscriberStats, querySubscribersList } from "../services/subscriber-list.service.js";
import {
  getBillingContext,
  getFinancialReportJson,
  getSubscriberStatement,
  recordPackagePayment,
} from "../services/subscriber-billing.service.js";
import { writeFinancialAudit } from "../services/financial-audit.service.js";
import { CoaService } from "../services/coa.service.js";
import { AccountingService } from "../services/accounting.service.js";
import { sendSubscriberFinancialReportWhatsApp } from "../services/whatsapp.service.js";
import { assertStaffCanAssignPackage, assertSubscriberFitsPackageNas } from "../lib/package-subscriber-validation.js";
import { hasColumn } from "../db/schemaGuards.js";
import { formatExpirationForDb, parseSubscriptionExpirationInput } from "../lib/expiration-date.js";

const router = Router();
const radiusSync = new RadiusSyncService(pool);
const coa = new CoaService(pool);
const accounting = new AccountingService(pool);

router.use(requireAuth);

const subscriberBody = z.object({
  customer_id: z.string().nullable().optional(),
  package_id: z.string().nullable().optional(),
  nas_server_id: z.string().nullable().optional(),
  username: z.string().min(1),
  password: z.string().min(1).optional(),
  status: z.enum(["active", "disabled", "expired", "suspended"]).optional(),
  expiration_date: z.string().nullable().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).optional().default(1),
  per_page: z.coerce.number().int().positive().max(500).optional().default(25),
  sort_key: z.string().optional().default("username"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("asc"),
  q: z.string().optional(),
  status_filter: z.enum(["all", "active", "expired", "disabled"]).optional().default("all"),
  package_id: z.string().optional(),
  nas_server_id: z.string().optional(),
  region_id: z.string().optional(),
  customer_id: z.string().optional(),
  expiry_from: z.string().optional(),
  expiry_to: z.string().optional(),
  quota_status: z.enum(["all", "ok", "exhausted"]).optional().default("all"),
  debt_status: z.enum(["all", "overdue", "clean"]).optional().default("all"),
});

async function subscriberIdentity(
  tenantId: string,
  id: string
): Promise<{ id: string; username: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, tenantId]
  );
  const r = rows[0];
  if (!r) return null;
  return { id: String(r.id), username: String(r.username ?? "") };
}

async function deleteSubscriberAndRadius(tenantId: string, subscriberId: string, username: string): Promise<void> {
  await pool.execute(`DELETE FROM subscribers WHERE id = ? AND tenant_id = ?`, [subscriberId, tenantId]);
  await pool.execute(`DELETE FROM subscriber_credentials WHERE subscriber_id = ? AND tenant_id = ?`, [
    subscriberId,
    tenantId,
  ]);
  await pool.execute(`DELETE FROM radcheck WHERE username = ?`, [username]);
  await pool.execute(`DELETE FROM radreply WHERE username = ?`, [username]);
  await pool.execute(`DELETE FROM radusergroup WHERE username = ?`, [username]);
}

router.get("/stats", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const stats = await computeSubscriberStats(pool, req.auth!.tenantId);
  res.json(stats);
});

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  const q = parsed.data;
  const { rows, total } = await querySubscribersList(
    pool,
    req.auth!.tenantId,
    {
      q: q.q,
      status_filter: q.status_filter,
      package_id: q.package_id,
      nas_server_id: q.nas_server_id,
      region_id: q.region_id,
      customer_id: q.customer_id,
      expiry_from: q.expiry_from,
      expiry_to: q.expiry_to,
      quota_status: q.quota_status,
      debt_status: q.debt_status,
    },
    {
      sort_key: q.sort_key,
      sort_dir: q.sort_dir,
      page: q.page,
      per_page: q.per_page,
    }
  );
  res.json({ items: rows, meta: { total } });
});

router.post("/bulk-delete", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  if (req.auth!.role === "manager" && !requestHasManagerPermission(req, "manage_subscribers")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const ids = parsed.data.ids;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, username FROM subscribers WHERE tenant_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    [tenantId, ...ids]
  );
  if (rows.length !== ids.length) {
    res.status(400).json({ error: "invalid_ids" });
    return;
  }
  for (const r of rows) {
    await deleteSubscriberAndRadius(tenantId, String(r.id), String(r.username ?? ""));
  }
  res.json({ ok: true, deleted: rows.length });
});

router.post("/", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  const parsed = subscriberBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.password) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const assignCheck = await assertStaffCanAssignPackage(
    pool,
    tenantId,
    req.auth!.role,
    req.auth!.sub,
    parsed.data.package_id ?? null
  );
  if (!assignCheck.ok) {
    res.status(403).json({ error: assignCheck.error });
    return;
  }
  const nasCheck = await assertSubscriberFitsPackageNas(
    pool,
    tenantId,
    parsed.data.package_id ?? null,
    parsed.data.nas_server_id ?? null
  );
  if (!nasCheck.ok) {
    res.status(400).json({ error: nasCheck.error });
    return;
  }
  const id = randomUUID();
  const body = parsed.data;
  const exp = body.expiration_date;
  const expFragment =
    exp === null ? "NULL" : exp === undefined ? "CURDATE()" : "?";
  const insertArgs: (string | null)[] = [
    id,
    tenantId,
    body.customer_id ?? null,
    body.package_id ?? null,
    body.username,
    body.status ?? "active",
  ];
  if (exp !== null && exp !== undefined) {
    insertArgs.push(exp);
  }
  const withNas = await hasColumn(pool, "subscribers", "nas_server_id");
  if (withNas) {
    insertArgs.splice(4, 0, body.nas_server_id ?? null);
    await pool.execute(
      `INSERT INTO subscribers (id, tenant_id, customer_id, package_id, nas_server_id, username, status, expiration_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${expFragment})`,
      insertArgs
    );
  } else {
    await pool.execute(
      `INSERT INTO subscribers (id, tenant_id, customer_id, package_id, username, status, expiration_date)
     VALUES (?, ?, ?, ?, ?, ?, ${expFragment})`,
      insertArgs
    );
  }
  await pool.execute(
    `INSERT INTO subscriber_credentials (subscriber_id, tenant_id, password) VALUES (?, ?, ?)`,
    [id, tenantId, body.password as string]
  );
  await radiusSync.syncSubscriber(id, tenantId);
  res.status(201).json({ id });
});

router.get(
  "/:id/billing-context",
  requireRole("admin", "manager", "accountant", "viewer"),
  async (req, res) => {
    const ctx = await getBillingContext(pool, req.auth!.tenantId, req.params.id);
    if (!ctx) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(ctx);
  }
);

router.get(
  "/:id/financial-report",
  requireRole("admin", "manager", "accountant", "viewer"),
  async (req, res) => {
    const data = await getFinancialReportJson(pool, req.auth!.tenantId, req.params.id);
    if (!data) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(data);
  }
);

router.get(
  "/:id/traffic-report",
  requireRole("admin", "manager", "accountant", "viewer"),
  async (req, res, next) => {
    try {
      const q = z.object({ from: z.string().optional(), to: z.string().optional() }).safeParse(req.query);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [req.params.id, req.auth!.tenantId]
      );
      if (!rows[0]) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const username = String((rows[0] as RowDataPacket).username ?? "");
      const report = await accounting.buildSubscriberTrafficReport(req.auth!.tenantId, username, {
        from: q.success ? q.data.from : undefined,
        to: q.success ? q.data.to : undefined,
      });
      res.json(report);
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/:id/statement",
  requireRole("admin", "manager", "accountant", "viewer"),
  async (req, res) => {
    const q = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }
    const data = await getSubscriberStatement(
      pool,
      req.auth!.tenantId,
      req.params.id,
      q.data.from ?? null,
      q.data.to ?? null
    );
    if (!data) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(data);
  }
);

router.get("/:id/password", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  if (req.auth!.role === "manager" && !requestHasManagerPermission(req, "manage_subscribers")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.password
     FROM subscriber_credentials c
     INNER JOIN subscribers s ON s.id = c.subscriber_id AND s.tenant_id = c.tenant_id
     WHERE c.subscriber_id = ? AND c.tenant_id = ?
     LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ password: String(rows[0].password ?? "") });
});

router.post(
  "/:id/record-package-payment",
  requireRole("admin", "manager", "accountant"),
  denyViewerWrites,
  async (req, res) => {
    if (!requestHasFinancePermission(req, "collect_payment")) {
      await writeFinancialAudit(pool, {
        tenantId: req.auth!.tenantId,
        staffId: req.auth?.sub ?? null,
        action: "finance_permission_denied",
        entityType: "subscriber",
        entityId: req.params.id,
        payload: { permission: "collect_payment", route: "record-package-payment" },
        ip: req.ip ?? null,
      });
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const out = await recordPackagePayment(pool, req.auth!.tenantId, req.params.id, req.body, {
      role: req.auth!.role,
      sub: req.auth!.sub,
    });
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    await writeFinancialAudit(pool, {
      tenantId: req.auth!.tenantId,
      staffId: req.auth?.sub ?? null,
      action: out.expiration_audit ? "record_package_payment_update_expiry" : "record_package_payment",
      entityType: "subscriber",
      entityId: req.params.id,
      payload: {
        result: out,
        ...(out.expiration_audit
          ? {
              payment_id: out.payment_id,
              invoice_id: out.invoice_id,
              ...out.expiration_audit,
            }
          : {}),
      },
      ip: req.ip ?? null,
    });
    res.json(out);
  }
);

router.post(
  "/:id/disconnect-sessions",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    if (req.auth!.role === "manager" && !requestHasManagerPermission(req, "disconnect_users")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const sub = await subscriberIdentity(req.auth!.tenantId, req.params.id);
    if (!sub) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const rep = await coa.disconnectAllSessions(sub.username, req.auth!.tenantId);
    res.json({ ok: rep.anyOk, results: rep.results });
  }
);

router.patch(
  "/:id/disable",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    if (req.auth!.role === "manager" && !requestHasManagerPermission(req, "manage_subscribers")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const [r] = await pool.execute(
      `UPDATE subscribers SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      [req.params.id, req.auth!.tenantId]
    );
    const affected = (r as { affectedRows?: number }).affectedRows ?? 0;
    if (!affected) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await radiusSync.syncSubscriber(req.params.id, req.auth!.tenantId);
    res.json({ ok: true });
  }
);

router.post(
  "/:id/enable",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    if (req.auth!.role === "manager" && !requestHasManagerPermission(req, "manage_subscribers")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const [r] = await pool.execute(
      `UPDATE subscribers SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      [req.params.id, req.auth!.tenantId]
    );
    const affected = (r as { affectedRows?: number }).affectedRows ?? 0;
    if (!affected) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await radiusSync.syncSubscriber(req.params.id, req.auth!.tenantId);
    res.json({ ok: true });
  }
);

router.post(
  "/:id/whatsapp-financial-report",
  requireRole("admin", "manager", "accountant"),
  denyViewerWrites,
  async (req, res) => {
    if (!requestHasFinancePermission(req, "send_financial_whatsapp_reports")) {
      await writeFinancialAudit(pool, {
        tenantId: req.auth!.tenantId,
        staffId: req.auth?.sub ?? null,
        action: "finance_permission_denied",
        entityType: "subscriber",
        entityId: req.params.id,
        payload: { permission: "send_financial_whatsapp_reports" },
        ip: req.ip ?? null,
      });
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const body = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const data = await getSubscriberStatement(
      pool,
      req.auth!.tenantId,
      req.params.id,
      body.data.from ?? null,
      body.data.to ?? null
    );
    if (!data) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const sub = data.subscriber as {
      username?: string;
      subscription_since?: string | null;
      expiration_date?: string | null;
      current_package?: string | null;
    };
    const totals = data.totals as { outstanding_balance?: number; total_invoiced?: number; total_recorded_payments?: number };
    const sessions = Array.isArray(data.sessions) ? data.sessions.slice(0, 5) : [];
    const sessLines = sessions.map((s: RowDataPacket) => {
      const start = s.acctstarttime != null ? String(s.acctstarttime).slice(0, 16) : "—";
      const ip = s.framedipaddress != null ? String(s.framedipaddress) : "—";
      const nas = s.nasipaddress != null ? String(s.nasipaddress) : "—";
      return `• ${start} | IP ${ip} | NAS ${nas}`;
    });
    const msg = [
      `تقرير مالي — ${sub.username ?? ""}`,
      `الباقة: ${sub.current_package ?? "—"}`,
      `منذ: ${sub.subscription_since ?? "—"} | الانتهاء: ${sub.expiration_date ?? "—"}`,
      `إجمالي الفواتير: ${Number(totals?.total_invoiced ?? 0).toFixed(2)}`,
      `إجمالي المدفوع: ${Number(totals?.total_recorded_payments ?? 0).toFixed(2)}`,
      `الرصيد المستحق: ${Number(totals?.outstanding_balance ?? 0).toFixed(2)}`,
      sessLines.length ? `آخر الجلسات:\n${sessLines.join("\n")}` : `آخر الجلسات: لا يوجد`,
    ].join("\n");
    const sent = await sendSubscriberFinancialReportWhatsApp({
      tenantId: req.auth!.tenantId,
      subscriberId: req.params.id,
      messageBody: msg,
    });
    await writeFinancialAudit(pool, {
      tenantId: req.auth!.tenantId,
      staffId: req.auth?.sub ?? null,
      action: "whatsapp_financial_report",
      entityType: "subscriber",
      entityId: req.params.id,
      payload: { sent: sent.sent, reason: sent.reason ?? null },
      ip: req.ip ?? null,
    });
    if (!sent.sent) {
      res.status(400).json({ error: sent.reason ?? "send_failed" });
      return;
    }
    res.json({ ok: true });
  }
);

router.patch("/:id", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  if (req.auth!.role === "manager" && !requestHasManagerPermission(req, "manage_subscribers")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = subscriberBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const body = parsed.data;
  const tenantId = req.auth!.tenantId;

  let previousExpiration: string | null = null;
  if (body.expiration_date !== undefined) {
    if (
      req.auth!.role === "manager" &&
      !requestHasManagerPermission(req, "manage_subscribers") &&
      !requestHasManagerPermission(req, "renew_subscriptions")
    ) {
      res.status(403).json({ error: "forbidden", detail: "missing_permission_update_expiry" });
      return;
    }
    const [expRows] = await pool.query<RowDataPacket[]>(
      `SELECT expiration_date FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [req.params.id, tenantId]
    );
    if (!expRows[0]) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    previousExpiration = expRows[0].expiration_date != null ? String(expRows[0].expiration_date) : null;
    if (body.expiration_date !== null) {
      const parsedExp = parseSubscriptionExpirationInput(String(body.expiration_date));
      if (!parsedExp) {
        res.status(400).json({ error: "invalid_expiration" });
        return;
      }
      body.expiration_date = formatExpirationForDb(parsedExp);
    }
  }

  if (body.package_id !== undefined || body.nas_server_id !== undefined) {
    const [curRows] = await pool.query<RowDataPacket[]>(
      `SELECT package_id, nas_server_id FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [req.params.id, tenantId]
    );
    const cur = curRows[0];
    if (!cur) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const nextPkg = body.package_id !== undefined ? body.package_id : cur.package_id != null ? String(cur.package_id) : null;
    const nextNas =
      body.nas_server_id !== undefined
        ? body.nas_server_id
        : cur.nas_server_id != null
          ? String(cur.nas_server_id)
          : null;
    const assignCheck = await assertStaffCanAssignPackage(
      pool,
      tenantId,
      req.auth!.role,
      req.auth!.sub,
      nextPkg
    );
    if (!assignCheck.ok) {
      res.status(403).json({ error: assignCheck.error });
      return;
    }
    const nasCheck = await assertSubscriberFitsPackageNas(pool, tenantId, nextPkg, nextNas);
    if (!nasCheck.ok) {
      res.status(400).json({ error: nasCheck.error });
      return;
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (body.customer_id !== undefined) set("customer_id", body.customer_id);
  if (body.package_id !== undefined) set("package_id", body.package_id);
  if (body.nas_server_id !== undefined && (await hasColumn(pool, "subscribers", "nas_server_id"))) {
    set("nas_server_id", body.nas_server_id);
  }
  if (body.username !== undefined) set("username", body.username);
  if (body.status !== undefined) set("status", body.status);
  if (body.expiration_date !== undefined) set("expiration_date", body.expiration_date);
  if (sets.length) {
    await pool.execute(
      `UPDATE subscribers SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      [...values, req.params.id, tenantId] as Array<string | number | null>
    );
  }
  if (body.expiration_date !== undefined) {
    await writeFinancialAudit(pool, {
      tenantId,
      staffId: req.auth?.sub ?? null,
      action: "subscriber_update_expiry",
      entityType: "subscriber",
      entityId: req.params.id,
      payload: {
        previous_expiration_date: previousExpiration,
        new_expiration_date: body.expiration_date,
      },
      ip: req.ip ?? null,
    });
  }
  if (body.password !== undefined) {
    await pool.execute(
      `INSERT INTO subscriber_credentials (subscriber_id, tenant_id, password)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE password = VALUES(password), updated_at = CURRENT_TIMESTAMP`,
      [req.params.id, tenantId, body.password]
    );
  }
  await radiusSync.syncSubscriber(req.params.id, tenantId);
  res.json({ ok: true });
});

router.delete("/:id", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  if (req.auth!.role === "manager" && !requestHasManagerPermission(req, "manage_subscribers")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const username = String(rows[0].username);
  await deleteSubscriberAndRadius(req.auth!.tenantId, req.params.id, username);
  res.json({ ok: true });
});

export default router;
