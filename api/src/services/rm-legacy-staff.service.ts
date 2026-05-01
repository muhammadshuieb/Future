import { createHash } from "crypto";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";
import type { Role } from "../middleware/auth.js";
import { defaultManagerPermissions, type ManagerPermissions } from "../lib/manager-permissions.js";

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
 * Auth source of truth: rm_managers only (no staff_users dependency).
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
  // Authentication source of truth is rm_managers.managername (email is optional legacy metadata).
  const [mRows] = await pool.query<RowDataPacket[]>(`SELECT * FROM rm_managers WHERE managername = ? LIMIT 1`, [ident]);
  if (mRows.length !== 1) return null;
  const m = mRows[0];
  if (cols.has("enablemanager") && m.enablemanager != null && Number(m.enablemanager) !== 1) return null;
  const stored = String(m.password ?? "");
  if (stored.length !== 32) return null;
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

export async function syncStaffUsersFromRmManagers(pool: Pool, tenantId: string): Promise<{ synced: number }> {
  void pool;
  void tenantId;
  return { synced: 0 };
}
