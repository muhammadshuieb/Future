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
import { enqueueWahaNewSubscriber } from "../services/task-queue.service.js";
import {
  assertStaffCanAssignPackage,
  assertSubscriberFitsPackageNas,
  tenantNasDeviceIds,
} from "../lib/package-subscriber-validation.js";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { requestHasIspPermission } from "../lib/isp-permissions.js";
import { formatExpirationForDb, parseSubscriptionExpirationInput } from "../lib/expiration-date.js";
import { loadSubscriberAccessRow } from "../lib/subscriber-access-guard.js";
import { resolveRadiusSyncDenyReason } from "../lib/radius-sync-deny.js";
import { withTransaction } from "../db/transaction.js";
import { logSubscriberManagerAudit } from "../services/subscriber-manager-assignment.service.js";
import { writeAuditLog } from "../services/audit-log.service.js";

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
  simultaneous_use: z.number().int().min(1).max(32).optional(),
  first_name: z.string().max(80).optional(),
  last_name: z.string().max(80).optional(),
  nickname: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  address: z.string().max(255).optional(),
  ip_address: z.string().max(45).optional(),
  mac_address: z.string().max(32).optional(),
  pool: z.string().max(64).optional(),
  notes: z.string().max(2000).optional(),
  region_id: z.string().nullable().optional(),
  whatsapp_opt_out: z.boolean().optional(),
});

type SubscriberProfileBody = Pick<
  z.infer<typeof subscriberBody>,
  | "first_name"
  | "last_name"
  | "nickname"
  | "phone"
  | "address"
  | "ip_address"
  | "mac_address"
  | "pool"
  | "notes"
  | "region_id"
  | "whatsapp_opt_out"
>;

async function subscriberProfileInsertParts(
  body: SubscriberProfileBody
): Promise<{ columns: string[]; placeholders: string[]; values: unknown[] }> {
  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];
  const candidates: Array<[string, unknown | undefined]> = [
    ["first_name", body.first_name !== undefined ? body.first_name.trim() || null : undefined],
    ["last_name", body.last_name !== undefined ? body.last_name.trim() || null : undefined],
    ["nickname", body.nickname !== undefined ? body.nickname.trim() || null : undefined],
    ["phone", body.phone !== undefined ? body.phone.trim() || null : undefined],
    ["address", body.address !== undefined ? body.address.trim() || null : undefined],
    ["ip_address", body.ip_address !== undefined ? body.ip_address.trim() || null : undefined],
    ["mac_address", body.mac_address !== undefined ? body.mac_address.trim() || null : undefined],
    ["pool", body.pool !== undefined ? body.pool.trim() || null : undefined],
    ["notes", body.notes !== undefined ? body.notes.trim() || null : undefined],
    ["region_id", body.region_id !== undefined ? body.region_id : undefined],
    [
      "whatsapp_opt_out",
      body.whatsapp_opt_out === true ? 1 : body.whatsapp_opt_out === false ? 0 : undefined,
    ],
  ];
  for (const [column, value] of candidates) {
    if (value === undefined) continue;
    if (!(await hasColumn(pool, "subscribers", column))) continue;
    columns.push(column);
    placeholders.push("?");
    values.push(value);
  }
  return { columns, placeholders, values };
}

function subscriberProfilePatchSets(body: SubscriberProfileBody): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (body.first_name !== undefined) assign("first_name", body.first_name?.trim() || null);
  if (body.last_name !== undefined) assign("last_name", body.last_name?.trim() || null);
  if (body.nickname !== undefined) assign("nickname", body.nickname?.trim() || null);
  if (body.phone !== undefined) assign("phone", body.phone?.trim() || null);
  if (body.address !== undefined) assign("address", body.address?.trim() || null);
  if (body.ip_address !== undefined) assign("ip_address", body.ip_address?.trim() || null);
  if (body.mac_address !== undefined) assign("mac_address", body.mac_address?.trim() || null);
  if (body.pool !== undefined) assign("pool", body.pool?.trim() || null);
  if (body.notes !== undefined) assign("notes", body.notes?.trim() || null);
  if (body.region_id !== undefined) assign("region_id", body.region_id);
  if (body.whatsapp_opt_out !== undefined) assign("whatsapp_opt_out", body.whatsapp_opt_out ? 1 : 0);
  return { sets, values };
}

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
  const listFilters = {
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
    ...(req.auth!.role === "manager" && !requestHasIspPermission(req, "subscribers:view_all")
      ? { responsible_manager_id: req.auth!.sub }
      : {}),
  };
  const { rows, total } = await querySubscribersList(
    pool,
    req.auth!.tenantId,
    listFilters,
    {
      sort_key: q.sort_key,
      sort_dir: q.sort_dir,
      page: q.page,
      per_page: q.per_page,
    }
  );
  res.json({ items: rows, meta: { total } });
});

router.post("/sync-radius-all", requireRole("admin"), denyViewerWrites, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const tenantNasIds = await tenantNasDeviceIds(pool, tenantId);
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM subscribers WHERE tenant_id = ?`, [tenantId]);
  let synced = 0;
  let allowed = 0;
  let rejected = 0;
  for (const row of rows) {
    const id = String(row.id);
    await radiusSync.syncSubscriber(id, tenantId);
    synced += 1;
    const access = await loadSubscriberAccessRow(pool, { tenantId, subscriberId: id });
    if (access && resolveRadiusSyncDenyReason(access, tenantNasIds) == null) {
      allowed += 1;
    } else {
      rejected += 1;
    }
  }
  res.json({ ok: true, synced, allowed, rejected });
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
  /** New subscribers start expired until a package payment / paid invoice extends expiry. */
  const pendingPayment = exp === undefined;
  const expFragment = exp === null ? "NULL" : exp === undefined ? "CURDATE()" : "?";
  const profileParts = await subscriberProfileInsertParts(body);
  const mgrFragment: { columns: string[]; values: unknown[]; placeholders: string[] } = {
    columns: [],
    values: [],
    placeholders: [],
  };
  if ((await hasColumn(pool, "subscribers", "created_by_manager_id")) && req.auth?.role === "manager") {
    mgrFragment.columns.push(
      "created_by_manager_id",
      "responsible_manager_id",
      "assigned_manager_id",
      "last_renewed_by_manager_id",
      "manager_assigned_at",
      "manager_assignment_source"
    );
    mgrFragment.placeholders.push("?", "?", "?", "?", "?", "?");
    const sid = req.auth!.sub;
    mgrFragment.values.push(sid, sid, sid, sid, new Date(), "created");
  }
  const baseColumns = ["id", "tenant_id", "customer_id", "package_id"];
  const baseValues: unknown[] = [id, tenantId, body.customer_id ?? null, body.package_id ?? null];
  const withNas = await hasColumn(pool, "subscribers", "nas_server_id");
  if (withNas) {
    baseColumns.push("nas_server_id");
    baseValues.push(body.nas_server_id ?? null);
  }
  baseColumns.push("username", "status", "expiration_date");
  baseValues.push(body.username, body.status ?? (pendingPayment ? "expired" : "active"));
  if (exp !== null && exp !== undefined) {
    baseValues.push(exp);
  }
  const allColumns = [...baseColumns, ...profileParts.columns, ...mgrFragment.columns];
  const allPlaceholders = [
    ...baseColumns.map((c) => (c === "expiration_date" ? expFragment : "?")),
    ...profileParts.placeholders,
    ...mgrFragment.placeholders,
  ];
  await pool.execute(
    `INSERT INTO subscribers (${allColumns.join(", ")}) VALUES (${allPlaceholders.join(", ")})`,
    [...baseValues, ...profileParts.values, ...mgrFragment.values] as Array<string | number | null>
  );
  if (mgrFragment.columns.length && (await hasTable(pool, "subscriber_manager_audit"))) {
    await pool.execute(
      `INSERT INTO subscriber_manager_audit (id, tenant_id, subscriber_id, old_manager_id, new_manager_id, reason, source, changed_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(), tenantId, id, null, req.auth!.sub, null, "created", req.auth!.sub]
    );
  }
  await pool.execute(
    `INSERT INTO subscriber_credentials (subscriber_id, tenant_id, password) VALUES (?, ?, ?)`,
    [id, tenantId, body.password as string]
  );

  let packageName = "-";
  let speed = "-";
  if (body.package_id) {
    const [pkgRows] = await pool.query<RowDataPacket[]>(
      `SELECT name, mikrotik_rate_limit FROM packages WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [body.package_id, tenantId]
    );
    if (pkgRows[0]) {
      packageName = String(pkgRows[0].name ?? "-");
      speed = String(pkgRows[0].mikrotik_rate_limit ?? "-");
    }
  }
  const fullName =
    [body.first_name?.trim(), body.last_name?.trim()].filter(Boolean).join(" ").trim() || body.username;
  const expirationForWhatsApp =
    exp === undefined ? new Date().toISOString().slice(0, 10) : exp === null ? null : exp;

  res.status(201).json({ id });

  void (async () => {
    try {
      await radiusSync.syncSubscriber(id, tenantId, {
        simultaneousUse: body.simultaneous_use,
      });
    } catch (err) {
      console.error("[subscribers] radius sync after create failed", err);
    }
    try {
      await enqueueWahaNewSubscriber({
        tenantId,
        subscriberId: id,
        phone: body.phone ?? null,
        username: body.username,
        fullName,
        password: body.password as string,
        packageName,
        speed,
        expirationDate: expirationForWhatsApp,
      });
    } catch (err) {
      console.error("[subscribers] welcome WhatsApp enqueue failed", err);
    }
  })();
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
    let radius_allowed = true;
    let radius_reason: string | null = null;
    try {
      const tenantId = req.auth!.tenantId;
      const tenantNasIds = await tenantNasDeviceIds(pool, tenantId);
      await radiusSync.syncSubscriber(req.params.id, tenantId);
      const access = await loadSubscriberAccessRow(pool, {
        tenantId,
        subscriberId: req.params.id,
      });
      radius_reason = access ? resolveRadiusSyncDenyReason(access, tenantNasIds) : "not_found";
      radius_allowed = radius_reason == null;
    } catch (error) {
      radius_allowed = false;
      radius_reason = error instanceof Error ? error.message : "sync_failed";
      console.error("[record-package-payment] radius sync failed", error);
    }
    res.json({ ...out, radius_allowed, radius_reason });
  }
);

router.post(
  "/:id/resync-radius",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const access = await loadSubscriberAccessRow(pool, { tenantId, subscriberId: req.params.id });
    if (!access) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    try {
      await radiusSync.syncSubscriber(req.params.id, tenantId);
    } catch (error) {
      console.error("[resync-radius]", error);
      res.status(500).json({ error: "radius_sync_failed" });
      return;
    }
    const tenantNasIds = await tenantNasDeviceIds(pool, tenantId);
    const refreshed = await loadSubscriberAccessRow(pool, { tenantId, subscriberId: req.params.id });
    const radius_reason = refreshed ? resolveRadiusSyncDenyReason(refreshed, tenantNasIds) : "not_found";
    res.json({
      ok: true,
      username: access.username,
      radius_allowed: radius_reason == null,
      radius_reason,
    });
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

router.patch(
  "/:id/responsible-manager",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res, next) => {
    try {
      if (!requestHasIspPermission(req, "subscribers:assign_manager")) {
        res.status(403).json({ error: "forbidden", detail: "subscribers:assign_manager" });
        return;
      }
      const body = z
        .object({
          responsible_manager_id: z.string().uuid(),
          reason: z.string().min(1).max(500),
        })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "invalid_body" });
        return;
      }
      if (!(await hasColumn(pool, "subscribers", "responsible_manager_id"))) {
        res.status(503).json({ error: "schema_missing" });
        return;
      }
      const tenantId = req.auth!.tenantId;
      const subscriberId = req.params.id;
      const newMgrId = body.data.responsible_manager_id;
      const actorId = req.auth!.sub;

      const [mgrRows] = await pool.query<RowDataPacket[]>(
        `SELECT u.id
         FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         INNER JOIN roles r ON r.id = ur.role_id AND r.name = 'manager'
         WHERE u.id = ? AND u.tenant_id = ?
         LIMIT 1`,
        [newMgrId, tenantId]
      );
      if (!mgrRows[0]) {
        res.status(400).json({ error: "invalid_manager" });
        return;
      }

      await withTransaction(async (conn) => {
        const [subRows] = await conn.query<RowDataPacket[]>(
          `SELECT id, responsible_manager_id, created_by_manager_id
           FROM subscribers
           WHERE id = ? AND tenant_id = ?
           LIMIT 1 FOR UPDATE`,
          [subscriberId, tenantId]
        );
        const sub = subRows[0];
        if (!sub) {
          throw Object.assign(new Error("not_found"), { code: 404 });
        }
        const oldResp =
          sub.responsible_manager_id != null ? String(sub.responsible_manager_id) : null;
        const createdBy =
          (await hasColumn(pool, "subscribers", "created_by_manager_id")) &&
          sub.created_by_manager_id != null
            ? String(sub.created_by_manager_id)
            : null;

        if (req.auth!.role === "manager" && !requestHasIspPermission(req, "subscribers:view_all")) {
          const owns =
            (oldResp != null && oldResp === actorId) || (createdBy != null && createdBy === actorId);
          if (!owns) {
            throw Object.assign(new Error("forbidden_scope"), { code: 403 });
          }
        }

        await conn.execute(
          `UPDATE subscribers SET
             responsible_manager_id = ?,
             manager_assigned_at = CURRENT_TIMESTAMP(3),
             manager_assignment_source = 'manual_admin',
             updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND tenant_id = ?`,
          [newMgrId, subscriberId, tenantId]
        );

        await logSubscriberManagerAudit(conn, {
          tenantId,
          subscriberId,
          oldManagerId: oldResp,
          newManagerId: newMgrId,
          source: "manual_admin",
          reason: body.data.reason,
          changedBy: actorId,
        });
      });

      await writeFinancialAudit(pool, {
        tenantId,
        staffId: actorId,
        action: "subscriber_responsible_manager_transfer",
        entityType: "subscribers",
        entityId: subscriberId,
        payload: { new_manager_id: newMgrId, reason: body.data.reason },
        ip: req.ip,
      });
      await writeAuditLog(pool, {
        tenantId,
        staffId: actorId,
        action: "subscriber_responsible_manager_transfer",
        entityType: "subscribers",
        entityId: subscriberId,
        payload: { new_manager_id: newMgrId, reason: body.data.reason },
      });
      res.json({ ok: true });
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as { code?: number }).code === 404) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (e && typeof e === "object" && "code" in e && (e as { code?: number }).code === 403) {
        res.status(403).json({ error: "forbidden", detail: "subscriber_scope" });
        return;
      }
      next(e);
    }
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
  const profilePatch = subscriberProfilePatchSets(body);
  for (let i = 0; i < profilePatch.sets.length; i++) {
    const column = profilePatch.sets[i]?.split(" = ")[0];
    if (!column || !(await hasColumn(pool, "subscribers", column))) continue;
    sets.push(profilePatch.sets[i]!);
    values.push(profilePatch.values[i]);
  }
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
  await radiusSync.syncSubscriber(req.params.id, tenantId, {
    simultaneousUse: body.simultaneous_use,
  });
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
