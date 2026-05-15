import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  requestHasManagerPermission,
  normalizeManagerPermissions,
  parsePermissionsObject,
} from "../lib/manager-permissions.js";
import {
  defaultSpeedProfilePermissionsAllOff,
  defaultSpeedProfilePermissionsAllOn,
  normalizeSpeedProfilePermissions,
} from "../lib/speed-profile-permissions.js";
import { hashStaffPassword } from "../lib/staff-password.js";
import { writeAuditLog } from "../services/audit-log.service.js";
import type { RowDataPacket } from "mysql2";
import { withTransaction } from "../db/transaction.js";
import { applyManagerWalletLedgerWithConnection } from "../services/manager-wallet-ledger.service.js";

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

function isSelfTarget(req: Request, userId: string): boolean {
  return String(req.auth?.sub ?? "") === String(userId);
}

async function getRoleId(tenantId: string, name: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM roles WHERE tenant_id = ? AND name = ? LIMIT 1`,
    [tenantId, name]
  );
  return rows[0] ? String(rows[0].id) : null;
}

router.get("/", async (req: Request, res: Response) => {
  if (!canManageManagers(req) && !canTransferBalance(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  if (!(await hasTable(pool, "users"))) {
    res.status(503).json({ error: "staff_schema_missing" });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.email, u.name, u.status, u.wallet_balance, u.allowed_negative_balance, u.permissions_json, u.created_at,
            (
              SELECT r2.name FROM user_roles ur2
              JOIN roles r2 ON r2.id = ur2.role_id
              WHERE ur2.user_id = u.id
              ORDER BY CASE r2.name
                WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'accountant' THEN 3 WHEN 'viewer' THEN 4 ELSE 5 END
              LIMIT 1
            ) AS role
     FROM users u
     WHERE u.tenant_id = ?
     ORDER BY u.email`,
    [tenantId]
  );
  const items = rows.map((m) => ({
    id: String(m.id),
    name: String(m.name ?? ""),
    email: String(m.email ?? ""),
    role: String(m.role ?? "viewer"),
    active: String(m.status ?? "active") === "active",
    created_at: m.created_at ?? null,
    wallet_balance: Number(m.wallet_balance ?? 0),
    opening_balance: Number(m.wallet_balance ?? 0),
    allowed_negative_balance: Number(m.allowed_negative_balance ?? 0),
    parent_staff_id: null,
    permissions_json: m.permissions_json ?? null,
  }));
  res.json({ items });
});

const createStaffBody = z.object({
  name: z.string().min(1).max(160),
  email: z.string().trim().email(),
  password: z.string().min(6),
  role: roleSchema,
  active: z.boolean().optional(),
  opening_balance: z.number().min(0).max(100000000).optional(),
  allowed_negative_balance: z.number().min(0).max(100000000).optional(),
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
  const { name, email, password, role, active, opening_balance, allowed_negative_balance, permissions } = parsed.data;
  const tenantId = req.auth!.tenantId;
  if (req.auth!.role === "manager" && role !== "manager") {
    res.status(403).json({ error: "forbidden", detail: "manager_can_create_manager_only" });
    return;
  }
  const roleId = await getRoleId(tenantId, role);
  if (!roleId) {
    res.status(503).json({ error: "roles_not_bootstrapped" });
    return;
  }
  const [exists] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM users WHERE tenant_id = ? AND LOWER(email) = LOWER(?) LIMIT 1`,
    [tenantId, email]
  );
  if (exists[0]) {
    res.status(409).json({ error: "user_exists" });
    return;
  }
  const uid = randomUUID();
  const bcryptPw = await hashStaffPassword(password);
  const permJson =
    role === "manager" && permissions ? JSON.stringify(permissions) : null;
  await pool.execute(
    `INSERT INTO users (id, tenant_id, email, name, password_hash, status, wallet_balance, allowed_negative_balance, permissions_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid,
      tenantId,
      email,
      name,
      bcryptPw,
      active === false ? "disabled" : "active",
      Number(opening_balance ?? 0),
      Number(allowed_negative_balance ?? 0),
      permJson,
    ]
  );
  await pool.execute(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [uid, roleId]);
  await writeAuditLog(pool, {
    tenantId,
    staffId: req.auth!.sub,
    action: "create",
    entityType: "staff_user",
    entityId: uid,
    payload: { role, email },
  });
  res.status(201).json({ id: uid });
});

const patchStaffBody = z.object({
  name: z.string().min(1).max(160).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  opening_balance: z.number().min(0).max(100000000).optional(),
  wallet_balance: z.number().min(0).max(100000000).optional(),
  allowed_negative_balance: z.number().min(0).max(100000000).optional(),
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
  const targetId = String(req.params.id ?? "");
  const tenantId = req.auth!.tenantId;
  const [targetRows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [targetId, tenantId]
  );
  if (!targetRows[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (req.auth!.role !== "admin" && targetId !== req.auth!.sub) {
    res.status(403).json({ error: "forbidden", detail: "admin_or_self_only" });
    return;
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  const d = parsed.data;
  if (d.name !== undefined) {
    sets.push("name = ?");
    vals.push(d.name);
  }
  if (d.email !== undefined) {
    sets.push("email = ?");
    vals.push(d.email);
  }
  if (d.password) {
    sets.push("password_hash = ?");
    vals.push(await hashStaffPassword(d.password));
  }
  if (d.active !== undefined) {
    sets.push("status = ?");
    vals.push(d.active ? "active" : "disabled");
  }
  if (d.opening_balance !== undefined || d.wallet_balance !== undefined) {
    sets.push("wallet_balance = ?");
    vals.push(Number(d.wallet_balance ?? d.opening_balance ?? 0));
  }
  if (d.allowed_negative_balance !== undefined) {
    sets.push("allowed_negative_balance = ?");
    vals.push(Number(d.allowed_negative_balance));
  }
  if (d.permissions !== undefined) {
    sets.push("permissions_json = ?");
    vals.push(JSON.stringify(d.permissions));
  }
  if (sets.length) {
    await pool.query(`UPDATE users SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`, [
      ...vals,
      targetId,
      tenantId,
    ]);
  }
  if (d.role !== undefined) {
    const rid = await getRoleId(tenantId, d.role);
    if (rid) {
      await pool.execute(`DELETE FROM user_roles WHERE user_id = ?`, [targetId]);
      await pool.execute(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [targetId, rid]);
    }
  }
  await writeAuditLog(pool, {
    tenantId,
    staffId: req.auth!.sub,
    action: "update",
    entityType: "staff_user",
    entityId: targetId,
    payload: parsed.data,
  });
  res.json({ ok: true });
});

router.delete("/:id", async (req: Request, res: Response) => {
  if (!canManageManagers(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (req.auth!.role !== "admin") {
    res.status(403).json({ error: "forbidden", detail: "admin_only_delete" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const targetId = String(req.params.id ?? "");
  if (isSelfTarget(req, targetId)) {
    res.status(400).json({ error: "cannot_delete_self" });
    return;
  }
  const [r] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [targetId, tenantId]
  );
  if (!r[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await pool.execute(`DELETE FROM user_roles WHERE user_id = ?`, [targetId]);
  await pool.execute(`DELETE FROM users WHERE id = ? AND tenant_id = ?`, [targetId, tenantId]);
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
  const items = roles.map((role) => {
    const raw = byRole.get(role)?.permissions_json ?? {};
    const parsed = parsePermissionsObject(raw);
    const manager = normalizeManagerPermissions(parsed);
    const speedBase =
      role === "manager" ? defaultSpeedProfilePermissionsAllOn() : defaultSpeedProfilePermissionsAllOff();
    const speed = { ...speedBase, ...normalizeSpeedProfilePermissions(parsed) };
    return {
      role,
      permissions: { ...manager, ...speed },
      updated_at: byRole.get(role)?.updated_at ?? null,
    };
  });
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
  const merged = {
    ...normalizeManagerPermissions(parsed.data.permissions),
    ...normalizeSpeedProfilePermissions(parsed.data.permissions),
  };
  const permissions = JSON.stringify(merged);
  await pool.execute(
    `INSERT INTO staff_role_permissions (tenant_id, role, permissions_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE permissions_json = VALUES(permissions_json), updated_at = CURRENT_TIMESTAMP(3)`,
    [tenantId, role, permissions]
  );
  await writeAuditLog(pool, {
    tenantId,
    staffId: req.auth!.sub,
    action: "update",
    entityType: "role_permissions",
    entityId: role,
    payload: merged,
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
  if (req.auth!.role === "manager" && targetId !== actorId) {
    res.status(403).json({ error: "forbidden", detail: "manager_self_topup_only" });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT wallet_balance FROM users WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [targetId, tenantId]
  );
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    const out = await withTransaction(async (conn) => {
      const r = await applyManagerWalletLedgerWithConnection(conn, {
        tenantId,
        managerId: targetId,
        delta: amount,
        type: "topup",
        currency: "USD",
        referenceType: "staff_topup",
        referenceId: actorId,
        description: parsed.data.note ?? "wallet_topup",
        createdBy: actorId,
        meta: { note: parsed.data.note ?? null, actor_id: actorId },
      });
      return r;
    });
    await writeAuditLog(pool, {
      tenantId,
      staffId: actorId,
      action: "topup",
      entityType: "staff_wallet",
      entityId: targetId,
      payload: { amount, note: parsed.data.note ?? null, ledger_id: out.ledger_id },
    });
    res.json({ ok: true, wallet_balance: out.balance_after });
  } catch (e) {
    console.error("[staff topup]", e);
    res.status(500).json({ error: "topup_failed" });
  }
});

export default router;
