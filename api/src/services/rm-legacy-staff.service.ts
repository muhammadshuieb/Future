import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";
import type { Role } from "../middleware/auth.js";
import { defaultManagerPermissions, type ManagerPermissions } from "../lib/manager-permissions.js";

const ROLES: ReadonlySet<Role> = new Set(["admin", "manager", "accountant", "viewer"]);

function normalizeStaffRole(raw: unknown): Role {
  const r = String(raw ?? "").trim().toLowerCase();
  if (ROLES.has(r as Role)) return r as Role;
  return "manager";
}

function md5Hex(plain: string): string {
  return createHash("md5").update(plain, "utf8").digest("hex");
}

function mapRmToRoleAndPerms(m: RowDataPacket): { role: Role; permissions: ManagerPermissions } {
  const name = String(m.managername ?? "").toLowerCase();
  const isAdmin =
    name === "admin" ||
    name === "root" ||
    (Number(m.perm_listmanagers) === 1 &&
      Number(m.perm_createmanagers) === 1 &&
      Number(m.perm_deletemanagers) === 1);
  let role: Role = isAdmin ? "admin" : "manager";
  const base = defaultManagerPermissions();
  if (role === "admin") return { role, permissions: base };
  const permissions: ManagerPermissions = {
    ...base,
    manage_subscribers: Number(m.perm_listusers) === 1 || Number(m.perm_editusers) === 1,
    renew_subscriptions: Number(m.perm_addcredits) === 1,
    manage_invoices: Number(m.perm_listinvoices) === 1 || Number(m.perm_editinvoice) === 1,
    manage_managers: Number(m.perm_listmanagers) === 1,
    transfer_balance: Number(m.perm_addcredits) === 1 || Number(m.perm_negbalance) === 1,
    disconnect_users: Number(m.perm_logout) === 1,
  };
  const hasAnyPermission = Object.values(permissions).some(Boolean);
  if (!hasAnyPermission) role = "viewer";
  else if (
    permissions.manage_invoices &&
    !permissions.manage_subscribers &&
    !permissions.manage_managers &&
    !permissions.disconnect_users
  ) {
    role = "accountant";
  } else {
    role = "manager";
  }
  return { role, permissions };
}

function normalizeRmManagerEmail(m: RowDataPacket, hasEmail: boolean): string {
  if (hasEmail && String(m.email ?? "").trim()) {
    return String(m.email).trim();
  }
  return "";
}

function readRmManagerBalance(m: RowDataPacket): number {
  const n = Number(m.balance ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function readRmAllowedNegative(m: RowDataPacket, hasAllowedNegative: boolean): number {
  if (!hasAllowedNegative) return 0;
  const n = Number(m.allowed_negative_balance ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * Primary auth: `rm_managers` (Radius Manager / DMA MD5). See also `tryLoginViaStaffUsers` for legacy bcrypt rows.
 */
export async function tryLoginViaRmManagers(
  pool: Pool,
  tenantId: string,
  managerNameOrEmail: string,
  password: string
): Promise<RowDataPacket | null> {
  if (!(await hasTable(pool, "rm_managers"))) return null;
  const cols = await getTableColumns(pool, "rm_managers");
  if (!cols.has("managername") || !cols.has("password")) return null;
  const ident = managerNameOrEmail.trim();
  if (!ident) return null;
  const hasEmail = cols.has("email");
  const identLower = ident.toLowerCase();
  let rmWhere = `LOWER(TRIM(managername)) = ?`;
  const rmParams: unknown[] = [identLower];
  if (hasEmail && ident.includes("@")) {
    rmWhere += ` OR (TRIM(COALESCE(email,'')) <> '' AND LOWER(TRIM(email)) = ?)`;
    rmParams.push(identLower);
  }
  const [mRows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM rm_managers WHERE ${rmWhere} LIMIT 2`,
    rmParams
  );
  if (mRows.length !== 1) return null;
  const m = mRows[0];
  if (cols.has("enablemanager") && m.enablemanager != null && Number(m.enablemanager) !== 1) return null;
  const stored = String(m.password ?? "").trim();
  if (!/^[a-f0-9]{32}$/i.test(stored)) return null;
  if (md5Hex(password) !== stored.toLowerCase()) return null;

  const { role, permissions } = mapRmToRoleAndPerms(m);
  const email = normalizeRmManagerEmail(m, hasEmail);
  const name = String(m.managername ?? "manager");
  const allowedNegative = readRmAllowedNegative(m, cols.has("allowed_negative_balance"));
  return {
    id: `rm:${name}`,
    tenant_id: tenantId,
    email,
    password_hash: "",
    role,
    active: 1,
    name,
    permissions_json: JSON.stringify(permissions),
    wallet_balance: readRmManagerBalance(m),
    allowed_negative_balance: allowedNegative,
  } as RowDataPacket;
}

/**
 * Fallback when `rm_managers` row is missing, password is not MD5-32, or bcrypt-only `staff_users` (legacy dumps).
 */
export async function tryLoginViaStaffUsers(
  pool: Pool,
  tenantId: string,
  loginIdent: string,
  password: string
): Promise<RowDataPacket | null> {
  if (!(await hasTable(pool, "staff_users"))) return null;
  const cols = await getTableColumns(pool, "staff_users");
  if (!cols.has("password_hash")) return null;
  const ident = loginIdent.trim();
  if (!ident) return null;
  const identLower = ident.toLowerCase();

  const parts: string[] = [];
  const params: unknown[] = [];
  if (cols.has("tenant_id")) {
    parts.push("tenant_id = ?");
    params.push(tenantId);
  }
  const ors: string[] = ["id = ?", "id = ?"];
  params.push(ident, `rm:${ident}`);
  if (cols.has("email")) {
    ors.push(`(TRIM(COALESCE(email,'')) <> '' AND LOWER(TRIM(email)) = ?)`);
    params.push(identLower);
  }
  if (cols.has("name")) {
    ors.push(`LOWER(TRIM(COALESCE(name,''))) = ?`);
    params.push(identLower);
  }
  if (cols.has("rm_managername")) {
    ors.push(`LOWER(TRIM(COALESCE(rm_managername,''))) = ?`);
    params.push(identLower);
  }
  const activeClause = cols.has("active") ? " AND active = 1" : "";
  const whereCore = parts.length ? `${parts.join(" AND ")} AND (${ors.join(" OR ")})` : `(${ors.join(" OR ")})`;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM staff_users WHERE ${whereCore}${activeClause} LIMIT 2`,
    params
  );
  if (rows.length !== 1) return null;
  const u = rows[0];
  const hash = String(u.password_hash ?? "").trim();
  let ok = false;
  if (/^\$2[aby]?\$\d{2}\$/.test(hash)) {
    ok = await bcrypt.compare(password, hash);
  } else if (/^[a-f0-9]{32}$/i.test(hash)) {
    ok = md5Hex(password) === hash.toLowerCase();
  }
  if (!ok) return null;

  const role = normalizeStaffRole(u.role);
  const wallet = cols.has("wallet_balance") ? Number(u.wallet_balance ?? 0) : 0;
  const allowedNegative = cols.has("allowed_negative_balance") ? Number(u.allowed_negative_balance ?? 0) : 0;
  const name = String(u.name ?? u.email ?? "staff").trim() || "staff";
  const email = cols.has("email") ? String(u.email ?? "").trim() : "";
  const perms =
    cols.has("permissions_json") && u.permissions_json != null
      ? String(u.permissions_json)
      : JSON.stringify(defaultManagerPermissions());

  return {
    id: String(u.id),
    tenant_id: tenantId,
    email,
    password_hash: "",
    role,
    active: 1,
    name,
    permissions_json: perms,
    wallet_balance: wallet,
    allowed_negative_balance: allowedNegative,
  } as RowDataPacket;
}

export async function syncStaffUsersFromRmManagers(pool: Pool, tenantId: string): Promise<{ synced: number }> {
  if (!(await hasTable(pool, "rm_managers"))) return { synced: 0 };
  if (!(await hasTable(pool, "staff_users"))) return { synced: 0 };

  const rmCols = await getTableColumns(pool, "rm_managers");
  const staffCols = await getTableColumns(pool, "staff_users");
  if (!rmCols.has("managername") || !rmCols.has("password")) return { synced: 0 };

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM rm_managers
     WHERE COALESCE(TRIM(managername), '') <> ''`
  );
  let synced = 0;

  for (const m of rows) {
    const name = String(m.managername ?? "").trim();
    if (!name) continue;
    const { role, permissions } = mapRmToRoleAndPerms(m);
    const email = normalizeRmManagerEmail(m, rmCols.has("email"));
    const walletBalance = readRmManagerBalance(m);
    const allowedNegative = readRmAllowedNegative(m, rmCols.has("allowed_negative_balance"));
    const passwordHash = String(m.password ?? "").trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(passwordHash)) continue;

    const updates: Array<{ column: string; value: unknown }> = [];
    if (staffCols.has("tenant_id")) updates.push({ column: "tenant_id", value: tenantId });
    if (staffCols.has("name")) updates.push({ column: "name", value: name });
    if (staffCols.has("email")) updates.push({ column: "email", value: email });
    if (staffCols.has("password_hash")) updates.push({ column: "password_hash", value: passwordHash });
    if (staffCols.has("role")) updates.push({ column: "role", value: role });
    if (staffCols.has("active")) updates.push({ column: "active", value: 1 });
    if (staffCols.has("permissions_json")) {
      updates.push({ column: "permissions_json", value: JSON.stringify(permissions) });
    }
    if (staffCols.has("wallet_balance")) updates.push({ column: "wallet_balance", value: walletBalance });
    if (staffCols.has("allowed_negative_balance")) {
      updates.push({ column: "allowed_negative_balance", value: allowedNegative });
    }
    if (staffCols.has("rm_managername")) {
      updates.push({ column: "rm_managername", value: name });
    }
    if (updates.length === 0) continue;

    const setSql = updates.map((u) => `${u.column} = ?`).join(", ");
    const params = updates.map((u) => u.value);
    // Prefer unique key on manager name (legacy email can be empty or duplicated).
    await pool.query(
      `INSERT INTO staff_users (id, ${updates.map((u) => u.column).join(", ")})
       VALUES (?, ${updates.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE ${setSql}`,
      [`rm:${name}`, ...params, ...params]
    );
    synced += 1;
  }
  return { synced };
}
