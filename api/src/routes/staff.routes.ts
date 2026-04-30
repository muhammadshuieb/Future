import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";
import { requireAuth, requireRole, type Role } from "../middleware/auth.js";
import { normalizeManagerPermissions, requestHasManagerPermission } from "../lib/manager-permissions.js";
import { writeAuditLog } from "../services/audit-log.service.js";
import type { RowDataPacket } from "mysql2";

const router = Router();

router.use(requireAuth);

const roleSchema = z.enum(["admin", "manager", "accountant", "viewer"]);
const editableRoleSchema = z.enum(["manager", "accountant", "viewer"]);

function canManageManagers(req: Request): boolean {
  return req.auth?.role === "admin" || requestHasManagerPermission(req, "manage_managers");
}

function canTransferBalance(req: Request): boolean {
  return req.auth?.role === "admin" || requestHasManagerPermission(req, "transfer_balance");
}

router.get("/", async (req: Request, res: Response) => {
  if (!canManageManagers(req) && !canTransferBalance(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const cols = await getTableColumns(pool, "staff_users");
  const hasStaffUsers = cols.has("name");
  const isManager = req.auth!.role === "manager";
  const items: Array<Record<string, unknown>> = [];
  if (hasStaffUsers) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, email, role, active, created_at,
              ${cols.has("wallet_balance") ? "wallet_balance" : "0"} AS wallet_balance,
              ${cols.has("opening_balance") ? "opening_balance" : "0"} AS opening_balance,
              ${cols.has("parent_staff_id") ? "parent_staff_id" : "NULL"} AS parent_staff_id,
              ${cols.has("permissions_json") ? "permissions_json" : "NULL"} AS permissions_json
       FROM staff_users
       WHERE tenant_id = ? ${isManager ? "AND (id = ? OR parent_staff_id = ?)" : ""}
       ORDER BY created_at DESC`,
      isManager ? [req.auth!.tenantId, req.auth!.sub, req.auth!.sub] : [req.auth!.tenantId]
    );
    items.push(...rows.map((row) => ({ ...row })));
  }
  if (await hasTable(pool, "rm_managers")) {
    const [rmManagers] = await pool.query<RowDataPacket[]>(
      `SELECT managername, firstname, lastname, email, balance, enablemanager
       FROM rm_managers
       ORDER BY managername`
    );
    for (const m of rmManagers) {
      const managerName = String(m.managername ?? "").trim();
      if (!managerName) continue;
      if (
        String(m.email ?? "").trim() &&
        items.some((row) => String(row.email ?? "").toLowerCase() === String(m.email ?? "").toLowerCase())
      ) {
        continue;
      }
      const fullName = `${String(m.firstname ?? "").trim()} ${String(m.lastname ?? "").trim()}`.trim();
      items.push({
        id: `rm:${managerName}`,
        name: fullName || managerName,
        email: String(m.email ?? `${managerName}@rm.local`),
        role: "manager",
        active: Number(m.enablemanager ?? 0) === 1,
        created_at: null,
        wallet_balance: Number(m.balance ?? 0),
        opening_balance: Number(m.balance ?? 0),
        parent_staff_id: null,
        permissions_json: null,
        legacy_source: "rm_managers",
      });
    }
  }
  if (!hasStaffUsers && items.length === 0) {
    res.status(503).json({ error: "staff_schema_missing", detail: "rm_managers_table_missing_or_empty" });
    return;
  }
  res.json({ items });
});

const createStaffBody = z.object({
  name: z.string().min(1).max(128),
  email: z.string().email(),
  password: z.string().min(6),
  role: roleSchema,
  active: z.boolean().optional(),
  opening_balance: z.number().min(0).max(100000000).optional(),
  parent_staff_id: z.string().uuid().nullable().optional(),
  permissions: z.record(z.boolean()).optional(),
});

router.post("/", async (req: Request, res: Response) => {
  if (!canManageManagers(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = createStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { name, email, password, role, active, opening_balance, parent_staff_id } = parsed.data;
  const tenantId = req.auth!.tenantId;
  if (req.auth!.role === "manager" && role !== "manager") {
    res.status(403).json({ error: "forbidden", detail: "manager_can_create_manager_only" });
    return;
  }
  const cols = await getTableColumns(pool, "staff_users");
  if (!cols.has("name")) {
    res.status(503).json({ error: "staff_schema_missing", detail: "Apply migration 008_staff_and_subscriber_profile_fields.sql" });
    return;
  }
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM staff_users WHERE tenant_id = ? AND email = ? LIMIT 1`,
    [tenantId, email]
  );
  if (existing[0]) {
    res.status(409).json({ error: "email_exists" });
    return;
  }
  const id = randomUUID();
  const hash = await bcrypt.hash(password, 12);
  const opening = role === "manager" ? Number(opening_balance ?? 0) : 0;
  const normalizedPermissions = role === "manager" ? normalizeManagerPermissions(parsed.data.permissions ?? {}) : null;
  const fields = ["id", "tenant_id", "name", "email", "password_hash", "role", "active"];
  const values: Array<string | number | boolean | null> = [id, tenantId, name, email, hash, role, active ?? true];
  if (cols.has("opening_balance")) {
    fields.push("opening_balance");
    values.push(opening);
  }
  if (cols.has("wallet_balance")) {
    fields.push("wallet_balance");
    values.push(opening);
  }
  if (cols.has("parent_staff_id")) {
    fields.push("parent_staff_id");
    values.push(req.auth!.role === "manager" ? req.auth!.sub : (parent_staff_id ?? null));
  }
  if (cols.has("permissions_json")) {
    fields.push("permissions_json");
    values.push(normalizedPermissions ? JSON.stringify(normalizedPermissions) : null);
  }
  await pool.execute(
    `INSERT INTO staff_users (${fields.join(", ")})
     VALUES (${fields.map(() => "?").join(", ")})`,
    values
  );
  await writeAuditLog(pool, {
    tenantId,
    staffId: req.auth!.sub,
    action: "create",
    entityType: "staff_user",
    entityId: id,
    payload: { role, email },
  });
  res.status(201).json({ id });
});

const patchStaffBody = z.object({
  name: z.string().min(1).max(128).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  opening_balance: z.number().min(0).max(100000000).optional(),
  wallet_balance: z.number().min(0).max(100000000).optional(),
  parent_staff_id: z.string().uuid().nullable().optional(),
  permissions: z.record(z.boolean()).optional(),
});

router.patch("/:id", async (req: Request, res: Response) => {
  if (!canManageManagers(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = patchStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const cols = await getTableColumns(pool, "staff_users");
  if (!cols.has("name")) {
    res.status(503).json({ error: "staff_schema_missing", detail: "Apply migration 008_staff_and_subscriber_profile_fields.sql" });
    return;
  }
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, role, parent_staff_id FROM staff_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [req.params.id, tenantId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (req.auth!.role === "manager") {
    if (String(existing[0].role) !== "manager" || String(existing[0].parent_staff_id ?? "") !== req.auth!.sub) {
      res.status(403).json({ error: "forbidden", detail: "manager_scope_violation" });
      return;
    }
    if (parsed.data.role !== undefined && parsed.data.role !== "manager") {
      res.status(403).json({ error: "forbidden", detail: "manager_role_change_forbidden" });
      return;
    }
  }
  if (parsed.data.email && parsed.data.email !== existing[0].email) {
    const [dup] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM staff_users WHERE tenant_id = ? AND email = ? AND id <> ? LIMIT 1`,
      [tenantId, parsed.data.email, req.params.id]
    );
    if (dup[0]) {
      res.status(409).json({ error: "email_exists" });
      return;
    }
  }
  if (parsed.data.active === false && req.params.id === req.auth!.sub) {
    res.status(400).json({ error: "cannot_deactivate_self" });
    return;
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (sql: string, value: unknown) => {
    sets.push(sql);
    vals.push(value);
  };
  if (parsed.data.name !== undefined) set("name = ?", parsed.data.name);
  if (parsed.data.email !== undefined) set("email = ?", parsed.data.email);
  if (parsed.data.role !== undefined) set("role = ?", parsed.data.role as Role);
  if (parsed.data.active !== undefined) set("active = ?", parsed.data.active);
  if (parsed.data.parent_staff_id !== undefined && cols.has("parent_staff_id")) {
    set("parent_staff_id = ?", parsed.data.parent_staff_id);
  }
  if (parsed.data.permissions !== undefined && cols.has("permissions_json")) {
    set("permissions_json = ?", JSON.stringify(normalizeManagerPermissions(parsed.data.permissions)));
  }
  if (parsed.data.opening_balance !== undefined && cols.has("opening_balance")) {
    set("opening_balance = ?", parsed.data.opening_balance);
  }
  if (parsed.data.wallet_balance !== undefined && cols.has("wallet_balance")) {
    set("wallet_balance = ?", parsed.data.wallet_balance);
  }
  if (parsed.data.password) {
    const hash = await bcrypt.hash(parsed.data.password, 12);
    set("password_hash = ?", hash);
  }
  if (!sets.length) {
    res.json({ ok: true });
    return;
  }
  await pool.query(`UPDATE staff_users SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, [
    ...vals,
    req.params.id,
    tenantId,
  ]);
  await writeAuditLog(pool, {
    tenantId,
    staffId: req.auth!.sub,
    action: "update",
    entityType: "staff_user",
    entityId: req.params.id,
    payload: parsed.data,
  });
  res.json({ ok: true });
});

router.delete("/:id", async (req: Request, res: Response) => {
  if (!canManageManagers(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const targetId = String(req.params.id ?? "");
  if (!targetId) {
    res.status(400).json({ error: "invalid_staff_id" });
    return;
  }
  if (targetId.startsWith("rm:")) {
    if (req.auth!.role !== "admin") {
      res.status(403).json({ error: "forbidden", detail: "legacy_rm_delete_admin_only" });
      return;
    }
    const managerName = targetId.slice(3).trim();
    if (!managerName) {
      res.status(400).json({ error: "invalid_staff_id" });
      return;
    }
    if (!(await hasTable(pool, "rm_managers"))) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const [legacyRows] = await pool.query<RowDataPacket[]>(
      `SELECT managername FROM rm_managers WHERE managername = ? LIMIT 1`,
      [managerName]
    );
    if (!legacyRows[0]) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await pool.execute(`DELETE FROM rm_managers WHERE managername = ?`, [managerName]);
    await writeAuditLog(pool, {
      tenantId,
      staffId: req.auth!.sub,
      action: "delete",
      entityType: "rm_manager",
      entityId: targetId,
      payload: null,
    });
    res.json({ ok: true, legacy_rm_manager: true });
    return;
  }
  if (targetId === req.auth!.sub) {
    res.status(400).json({ error: "cannot_delete_self" });
    return;
  }
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id, role, parent_staff_id FROM staff_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [targetId, tenantId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (req.auth!.role === "manager") {
    if (String(existing[0].role) !== "manager" || String(existing[0].parent_staff_id ?? "") !== req.auth!.sub) {
      res.status(403).json({ error: "forbidden", detail: "manager_scope_violation" });
      return;
    }
  }
  await pool.execute(`DELETE FROM staff_users WHERE id = ? AND tenant_id = ?`, [targetId, tenantId]);
  await writeAuditLog(pool, {
    tenantId,
    staffId: req.auth!.sub,
    action: "delete",
    entityType: "staff_user",
    entityId: targetId,
    payload: null,
  });
  res.json({ ok: true });
});

const topupBody = z.object({
  amount: z.number().positive().max(100000000),
  note: z.string().max(255).optional(),
});

const rolePermissionsBody = z.object({
  permissions: z.record(z.boolean()),
});

router.get("/roles-permissions", requireRole("admin"), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT role, permissions_json, updated_at
     FROM staff_role_permissions
     WHERE tenant_id = ?`,
    [tenantId]
  );
  const byRole = new Map<string, RowDataPacket>();
  for (const row of rows) byRole.set(String(row.role), row);
  const roles = ["manager", "accountant", "viewer"] as const;
  const items = roles.map((role) => ({
    role,
    permissions: normalizeManagerPermissions(byRole.get(role)?.permissions_json ?? {}),
    updated_at: byRole.get(role)?.updated_at ?? null,
  }));
  res.json({ items });
});

router.put("/roles-permissions/:role", requireRole("admin"), async (req: Request, res: Response) => {
  const roleParsed = editableRoleSchema.safeParse(req.params.role);
  if (!roleParsed.success) {
    res.status(400).json({ error: "invalid_role" });
    return;
  }
  const parsed = rolePermissionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const role = roleParsed.data;
  const tenantId = req.auth!.tenantId;
  const id = randomUUID();
  const permissions = JSON.stringify(normalizeManagerPermissions(parsed.data.permissions));
  await pool.execute(
    `INSERT INTO staff_role_permissions (id, tenant_id, role, permissions_json)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE permissions_json = VALUES(permissions_json), updated_at = CURRENT_TIMESTAMP(3)`,
    [id, tenantId, role, permissions]
  );
  await writeAuditLog(pool, {
    tenantId,
    staffId: req.auth!.sub,
    action: "update",
    entityType: "role_permissions",
    entityId: role,
    payload: normalizeManagerPermissions(parsed.data.permissions),
  });
  res.json({ ok: true });
});

router.post("/:id/topup", requireRole("admin", "manager"), async (req: Request, res: Response) => {
  if (!canTransferBalance(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = topupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const targetId = req.params.id;
  const actorId = req.auth!.sub;
  const amount = Number(parsed.data.amount);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [targetRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, role, parent_staff_id, wallet_balance
       FROM staff_users
       WHERE id = ? AND tenant_id = ?
       LIMIT 1 FOR UPDATE`,
      [targetId, tenantId]
    );
    const target = targetRows[0];
    if (!target || String(target.role) !== "manager") {
      await conn.rollback();
      res.status(404).json({ error: "manager_not_found" });
      return;
    }
    if (req.auth!.role === "manager") {
      if (String(target.parent_staff_id ?? "") !== actorId) {
        await conn.rollback();
        res.status(403).json({ error: "forbidden", detail: "not_parent_manager" });
        return;
      }
      const [actorRows] = await conn.query<RowDataPacket[]>(
        `SELECT wallet_balance FROM staff_users WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [actorId, tenantId]
      );
      const actorBalance = Number(actorRows[0]?.wallet_balance ?? 0);
      if (actorBalance < amount) {
        await conn.rollback();
        res.status(400).json({ error: "insufficient_manager_balance" });
        return;
      }
      await conn.execute(`UPDATE staff_users SET wallet_balance = ? WHERE id = ?`, [actorBalance - amount, actorId]);
      await conn.execute(
        `INSERT INTO manager_wallet_transactions
         (id, tenant_id, staff_id, actor_staff_id, amount, tx_type, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), tenantId, actorId, actorId, -amount, "transfer_out", parsed.data.note ?? null]
      );
    }
    const targetBalance = Number(target.wallet_balance ?? 0);
    await conn.execute(`UPDATE staff_users SET wallet_balance = ? WHERE id = ?`, [targetBalance + amount, targetId]);
    await conn.execute(
      `INSERT INTO manager_wallet_transactions
       (id, tenant_id, staff_id, actor_staff_id, amount, tx_type, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        tenantId,
        targetId,
        req.auth!.sub,
        amount,
        req.auth!.role === "admin" ? "admin_topup" : "transfer_in",
        parsed.data.note ?? null,
      ]
    );
    await conn.commit();
    await writeAuditLog(pool, {
      tenantId,
      staffId: actorId,
      action: "topup",
      entityType: "manager_wallet",
      entityId: targetId,
      payload: { amount, note: parsed.data.note ?? null },
    });
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: "topup_failed", detail: e instanceof Error ? e.message : String(e) });
  } finally {
    conn.release();
  }
});

export default router;
