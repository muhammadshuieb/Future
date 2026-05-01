import { Router, type Request, type Response } from "express";
import { createHash } from "crypto";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { normalizeManagerPermissions, requestHasManagerPermission } from "../lib/manager-permissions.js";
import { writeAuditLog } from "../services/audit-log.service.js";
import type { RowDataPacket } from "mysql2";

const router = Router();

router.use(requireAuth);

const roleSchema = z.enum(["admin", "manager", "accountant", "viewer"]);
const editableRoleSchema = z.enum(["manager", "accountant", "viewer"]);

const RM_PERMISSION_COLUMNS = [
  "perm_listusers","perm_createusers","perm_editusers","perm_edituserspriv","perm_deleteusers",
  "perm_listmanagers","perm_createmanagers","perm_editmanagers","perm_deletemanagers",
  "perm_listservices","perm_createservices","perm_editservices","perm_deleteservices",
  "perm_listonlineusers","perm_listinvoices","perm_trafficreport","perm_addcredits","perm_negbalance",
  "perm_listallinvoices","perm_showinvtotals","perm_logout","perm_cardsys","perm_editinvoice",
  "perm_allusers","perm_allowdiscount","perm_enwriteoff","perm_accessap","perm_cts","perm_email","perm_sms",
] as const;

function classifyRoleFromRmRow(row: RowDataPacket): "admin" | "manager" | "accountant" | "viewer" {
  const managerName = String(row.managername ?? "").trim().toLowerCase();
  const isAdmin =
    managerName === "admin" ||
    managerName === "root" ||
    (Number(row.perm_listmanagers ?? 0) === 1 &&
      Number(row.perm_createmanagers ?? 0) === 1 &&
      Number(row.perm_deletemanagers ?? 0) === 1);
  if (isAdmin) return "admin";

  const canManageSubscribers = Number(row.perm_listusers ?? 0) === 1 || Number(row.perm_editusers ?? 0) === 1;
  const canManageManagers = Number(row.perm_listmanagers ?? 0) === 1 || Number(row.perm_createmanagers ?? 0) === 1;
  const canDisconnectUsers = Number(row.perm_logout ?? 0) === 1;
  const canManageInvoices = Number(row.perm_listinvoices ?? 0) === 1 || Number(row.perm_editinvoice ?? 0) === 1;
  const canTraffic = Number(row.perm_trafficreport ?? 0) === 1;
  const anyPrivilege =
    RM_PERMISSION_COLUMNS.some((col) => Number(row[col] ?? 0) === 1) ||
    canManageSubscribers ||
    canManageManagers ||
    canDisconnectUsers ||
    canManageInvoices ||
    canTraffic;
  if (!anyPrivilege) return "viewer";
  if (!canManageSubscribers && !canManageManagers && !canDisconnectUsers && canManageInvoices) return "accountant";
  return "manager";
}

function rmPermissionValueForRole(role: z.infer<typeof roleSchema>, column: string): number {
  if (role === "admin" || role === "manager") return 1;
  if (role === "viewer") return 0;
  // accountant: billing-focused role with minimal non-billing permissions.
  const accountantEnabled = new Set<string>([
    "perm_listinvoices",
    "perm_editinvoice",
    "perm_listallinvoices",
    "perm_showinvtotals",
  ]);
  return accountantEnabled.has(column) ? 1 : 0;
}

function canManageManagers(req: Request): boolean {
  return req.auth?.role === "admin" || requestHasManagerPermission(req, "manage_managers");
}

function canTransferBalance(req: Request): boolean {
  return req.auth?.role === "admin" || requestHasManagerPermission(req, "transfer_balance");
}

function isLegacySelfTarget(req: Request, managerName: string): boolean {
  const target = managerName.trim().toLowerCase();
  if (!target) return false;
  const authSub = String(req.auth?.sub ?? "").trim().toLowerCase();
  const authName = String(req.auth?.name ?? "").trim().toLowerCase();
  const authEmail = String(req.auth?.email ?? "")
    .trim()
    .toLowerCase();
  if (authSub === `rm:${target}`) return true;
  if (authName === target) return true;
  if (authEmail.startsWith(`${target}@`)) return true;
  return false;
}

router.get("/", async (req: Request, res: Response) => {
  if (!canManageManagers(req) && !canTransferBalance(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const items: Array<Record<string, unknown>> = [];
  if (await hasTable(pool, "rm_managers")) {
    const rmCols = await getTableColumns(pool, "rm_managers");
    const permsSelect = RM_PERMISSION_COLUMNS.filter((c) => rmCols.has(c))
      .map((c) => `${c}`)
      .join(", ");
    const selectPerms = permsSelect ? `, ${permsSelect}` : "";
    const [rmManagers] = await pool.query<RowDataPacket[]>(
      `SELECT managername, firstname, lastname, email, balance, enablemanager,
              ${rmCols.has("allowed_negative_balance") ? "allowed_negative_balance" : "0"} AS allowed_negative_balance
              ${selectPerms}
       FROM rm_managers
       ORDER BY managername`
    );
    for (const m of rmManagers) {
      const managerName = String(m.managername ?? "").trim();
      if (!managerName) continue;
      items.push({
        id: `rm:${managerName}`,
        name: managerName,
        managername: managerName,
        firstname: String(m.firstname ?? "").trim(),
        lastname: String(m.lastname ?? "").trim(),
        email: String(m.email ?? `${managerName}@rm.local`),
        role: classifyRoleFromRmRow(m),
        active: Number(m.enablemanager ?? 0) === 1,
        created_at: null,
        wallet_balance: Number(m.balance ?? 0),
        opening_balance: Number(m.balance ?? 0),
        allowed_negative_balance: Number(m.allowed_negative_balance ?? 0),
        parent_staff_id: null,
        permissions_json: null,
        legacy_source: "rm_managers",
      });
    }
  }
  if (items.length === 0) {
    res.status(503).json({ error: "staff_schema_missing", detail: "rm_managers_table_missing_or_empty" });
    return;
  }
  res.json({ items });
});

const createStaffBody = z.object({
  name: z.string().min(1).max(128),
  email: z.string().trim().email().optional().or(z.literal("")),
  password: z.string().min(6),
  role: roleSchema,
  active: z.boolean().optional(),
  opening_balance: z.number().min(0).max(100000000).optional(),
  allowed_negative_balance: z.number().min(0).max(100000000).optional(),
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
  const { name, email, password, role, active, opening_balance, allowed_negative_balance } = parsed.data;
  const tenantId = req.auth!.tenantId;
  if (!(await hasTable(pool, "rm_managers"))) {
    res.status(503).json({ error: "rm_managers_missing" });
    return;
  }
  if (req.auth!.role === "manager" && role !== "manager") {
    res.status(403).json({ error: "forbidden", detail: "manager_can_create_manager_only" });
    return;
  }
  const managerName = String(name ?? "").trim();
  if (!managerName) {
    res.status(400).json({ error: "invalid_manager_name" });
    return;
  }
  const [exists] = await pool.query<RowDataPacket[]>(
    `SELECT managername FROM rm_managers WHERE managername = ? LIMIT 1`,
    [managerName]
  );
  if (exists[0]) {
    res.status(409).json({ error: "manager_exists" });
    return;
  }
  const rmCols = await getTableColumns(pool, "rm_managers");
  const perms = RM_PERMISSION_COLUMNS.filter((c) => rmCols.has(c));
  const cols = [
    "managername","password","firstname","lastname","phone","mobile","address","city","zip","country","state","comment","company","vatid","email","balance",
    ...perms,
    ...(rmCols.has("allowed_negative_balance") ? ["allowed_negative_balance"] : []),
    ...(rmCols.has("enablemanager") ? ["enablemanager"] : []),
    ...(rmCols.has("lang") ? ["lang"] : []),
  ];
  const md5 = createHash("md5").update(password, "utf8").digest("hex");
  const values: Array<string | number> = [
    managerName, md5, managerName, "", "", "", "", "", "", "", "", "Future Radius staff create", "", "", String(email ?? "").trim(), Number(opening_balance ?? 0),
    ...perms.map((permCol) => rmPermissionValueForRole(role, permCol)),
    ...(rmCols.has("allowed_negative_balance") ? [Number(allowed_negative_balance ?? 0)] : []),
    ...(rmCols.has("enablemanager") ? [active === false ? 0 : 1] : []),
    ...(rmCols.has("lang") ? ["English"] : []),
  ];
  await pool.execute(`INSERT INTO rm_managers (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, values);
  await writeAuditLog(pool, {
    tenantId,
    staffId: req.auth!.sub,
    action: "create",
    entityType: "rm_manager",
    entityId: `rm:${managerName}`,
    payload: { role, email: String(email ?? "").trim() },
  });
  res.status(201).json({ id: `rm:${managerName}` });
});

const patchStaffBody = z.object({
  name: z.string().min(1).max(128).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  opening_balance: z.number().min(0).max(100000000).optional(),
  wallet_balance: z.number().min(0).max(100000000).optional(),
  allowed_negative_balance: z.number().min(0).max(100000000).optional(),
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
  const targetId = String(req.params.id ?? "");
  if (targetId.startsWith("rm:")) {
    if (req.auth!.role !== "admin") {
      res.status(403).json({ error: "forbidden", detail: "legacy_rm_update_admin_only" });
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
    const legacySets: string[] = [];
    const legacyVals: unknown[] = [];
    const setLegacy = (sql: string, value: unknown) => {
      legacySets.push(sql);
      legacyVals.push(value);
    };
    if (parsed.data.name !== undefined) {
      const tokens = String(parsed.data.name ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const firstName = tokens[0] ?? managerName;
      const lastName = tokens.length > 1 ? tokens.slice(1).join(" ") : "";
      setLegacy("firstname = ?", firstName);
      setLegacy("lastname = ?", lastName);
    }
    if (parsed.data.email !== undefined) {
      setLegacy("email = ?", String(parsed.data.email ?? "").trim());
    }
    if (parsed.data.allowed_negative_balance !== undefined) {
      const rmCols = await getTableColumns(pool, "rm_managers");
      if (rmCols.has("allowed_negative_balance")) {
        setLegacy("allowed_negative_balance = ?", Number(parsed.data.allowed_negative_balance));
      }
    }
    if (parsed.data.active !== undefined) {
      setLegacy("enablemanager = ?", parsed.data.active ? 1 : 0);
    }
    if (parsed.data.password) {
      const md5 = createHash("md5").update(parsed.data.password, "utf8").digest("hex");
      setLegacy("password = ?", md5);
    }
    if (parsed.data.role !== undefined) {
      const rmCols = await getTableColumns(pool, "rm_managers");
      const perms = RM_PERMISSION_COLUMNS.filter((c) => rmCols.has(c));
      for (const permCol of perms) {
        setLegacy(`${permCol} = ?`, rmPermissionValueForRole(parsed.data.role, permCol));
      }
    }
    if (!legacySets.length) {
      res.json({ ok: true, legacy_rm_manager: true });
      return;
    }
    await pool.query(`UPDATE rm_managers SET ${legacySets.join(", ")} WHERE managername = ?`, [...legacyVals, managerName]);
    await writeAuditLog(pool, {
      tenantId: req.auth!.tenantId,
      staffId: req.auth!.sub,
      action: "update",
      entityType: "rm_manager",
      entityId: targetId,
      payload: parsed.data,
    });
    res.json({ ok: true, legacy_rm_manager: true });
    return;
  }
  res.status(400).json({ error: "rm_manager_id_required", detail: "Use id format rm:<managername>" });
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
    if (isLegacySelfTarget(req, managerName)) {
      res.status(400).json({ error: "cannot_delete_self" });
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
  res.status(400).json({ error: "rm_manager_id_required", detail: "Use id format rm:<managername>" });
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
  if (targetId.startsWith("rm:")) {
    if (req.auth!.role !== "admin") {
      res.status(403).json({ error: "forbidden", detail: "legacy_rm_topup_admin_only" });
      return;
    }
    const managerName = targetId.slice(3).trim();
    if (!managerName || !(await hasTable(pool, "rm_managers"))) {
      res.status(404).json({ error: "manager_not_found" });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT managername, balance FROM rm_managers WHERE managername = ? LIMIT 1`,
      [managerName]
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "manager_not_found" });
      return;
    }
    const nextBalance = Number(row.balance ?? 0) + amount;
    await pool.execute(`UPDATE rm_managers SET balance = ? WHERE managername = ?`, [nextBalance, managerName]);
    await writeAuditLog(pool, {
      tenantId,
      staffId: actorId,
      action: "topup",
      entityType: "rm_manager_wallet",
      entityId: targetId,
      payload: { amount, note: parsed.data.note ?? null },
    });
    res.json({ ok: true, legacy_rm_manager: true });
    return;
  }
  res.status(400).json({ error: "rm_manager_id_required", detail: "Use id format rm:<managername>" });
});

export default router;
