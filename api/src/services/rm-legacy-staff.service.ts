import { createHash, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
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
    (Number(m.perm_listmanagers) === 1 &&
      Number(m.perm_createmanagers) === 1 &&
      Number(m.perm_deletemanagers) === 1);
  const role: Role = isAdmin ? "admin" : "manager";
  const base = defaultManagerPermissions();
  if (role === "admin") return { role, permissions: base };
  return {
    role,
    permissions: {
      ...base,
      manage_subscribers: Number(m.perm_listusers) === 1 || Number(m.perm_editusers) === 1,
      renew_subscriptions: Number(m.perm_addcredits) === 1,
      manage_invoices: Number(m.perm_listinvoices) === 1 || Number(m.perm_editinvoice) === 1,
      manage_managers: Number(m.perm_listmanagers) === 1,
      transfer_balance: Number(m.perm_addcredits) === 1 || Number(m.perm_negbalance) === 1,
      disconnect_users: Number(m.perm_logout) === 1,
    },
  };
}

function normalizeRmManagerEmail(m: RowDataPacket, hasEmail: boolean): string {
  if (hasEmail && String(m.email ?? "").trim()) {
    return String(m.email).trim();
  }
  return `${String(m.managername ?? "manager").trim()}@rm-legacy.local`;
}

function readRmManagerBalance(m: RowDataPacket): number {
  const n = Number(m.balance ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * If staff_users login failed, try rm_managers (MD5 password) and ensure a staff_users row.
 * Keeps rm_managers as source of auth on restored DB; upgrades password_hash to bcrypt.
 */
export async function tryLoginViaRmManagers(
  pool: Pool,
  tenantId: string,
  emailOrName: string,
  password: string
): Promise<RowDataPacket | null> {
  if (!(await hasTable(pool, "rm_managers"))) return null;
  const cols = await getTableColumns(pool, "rm_managers");
  if (!cols.has("managername") || !cols.has("password")) return null;
  const ident = emailOrName.trim();
  if (!ident) return null;
  const hasEmail = cols.has("email");
  /** Prefer unambiguous lookup: managername for logins like "admin"; email only when ident looks like an email. */
  let mRows: RowDataPacket[];
  if (ident.includes("@") && hasEmail) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM rm_managers WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(?) LIMIT 2`,
      [ident]
    );
    mRows = rows;
  } else {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM rm_managers WHERE managername = ? LIMIT 1`,
      [ident]
    );
    mRows = rows;
  }
  if (mRows.length !== 1) return null;
  const m = mRows[0];
  if (cols.has("enablemanager") && Number(m.enablemanager) !== 1) return null;
  const stored = String(m.password ?? "");
  if (stored.length !== 32) return null;
  if (md5Hex(password) !== stored.toLowerCase()) return null;

  const { role, permissions } = mapRmToRoleAndPerms(m);
  const email = normalizeRmManagerEmail(m, hasEmail);
  const name = String(m.managername ?? "manager");
  if (!(await hasTable(pool, "staff_users"))) {
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
    } as RowDataPacket;
  }
  const staffCols = await getTableColumns(pool, "staff_users");
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, email, password_hash, role, active FROM staff_users
     WHERE tenant_id = ? AND (email = ? OR email = ?) LIMIT 1`,
    [tenantId, email, `${String(m.managername)}@rm-legacy.local`]
  );
  const hash = await bcrypt.hash(password, 10);
  const permsJson = JSON.stringify(permissions);

  if (existing[0]) {
    const id = existing[0].id as string;
    const sets: string[] = ["password_hash = ?", "active = 1", "role = ?"];
    const vals: unknown[] = [hash, role];
    if (staffCols.has("name")) {
      sets.push("name = ?");
      vals.push(name);
    }
    if (staffCols.has("permissions_json")) {
      sets.push("permissions_json = ?");
      vals.push(permsJson);
    }
    vals.push(id, tenantId);
    await pool.query(`UPDATE staff_users SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, vals);
    const [out] = await pool.query<RowDataPacket[]>(
      `SELECT id, tenant_id, email, password_hash, role, active, name, permissions_json, wallet_balance
       FROM staff_users WHERE id = ? LIMIT 1`,
      [id]
    );
    return out[0] ?? null;
  }

  const id = randomUUID();
  const fields: string[] = [
    "id",
    "tenant_id",
    "name",
    "email",
    "password_hash",
    "role",
    "active",
  ];
  const values: unknown[] = [id, tenantId, name, email, hash, role, 1];
  if (staffCols.has("permissions_json")) {
    fields.push("permissions_json");
    values.push(permsJson);
  }
  await pool.query(
    `INSERT INTO staff_users (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
    values
  );
  const [out] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, email, password_hash, role, active, name, permissions_json, wallet_balance
     FROM staff_users WHERE id = ? LIMIT 1`,
    [id]
  );
  return out[0] ?? null;
}

export async function syncStaffUsersFromRmManagers(pool: Pool, tenantId: string): Promise<{ synced: number }> {
  if (!(await hasTable(pool, "rm_managers"))) return { synced: 0 };
  const rmCols = await getTableColumns(pool, "rm_managers");
  if (!rmCols.has("managername")) return { synced: 0 };
  const hasEmail = rmCols.has("email");
  const hasActive = rmCols.has("enablemanager");
  const hasBalance = rmCols.has("balance");
  const [rmRows] = await pool.query<RowDataPacket[]>(`SELECT * FROM rm_managers ORDER BY managername`);
  if (!rmRows.length) return { synced: 0 };
  const staffCols = await getTableColumns(pool, "staff_users");
  let synced = 0;

  for (const rm of rmRows) {
    const managerName = String(rm.managername ?? "").trim();
    if (!managerName) continue;
    const { role, permissions } = mapRmToRoleAndPerms(rm);
    const email = normalizeRmManagerEmail(rm, hasEmail);
    const active = hasActive ? Number(rm.enablemanager ?? 0) === 1 : true;
    const balance = hasBalance ? readRmManagerBalance(rm) : 0;
    const permissionsJson = JSON.stringify(permissions);

    const candidateSql =
      role === "admin"
        ? `SELECT id
           FROM staff_users
           WHERE tenant_id = ?
             AND (LOWER(email) = LOWER(?) OR LOWER(name) = LOWER(?) OR role = 'admin')
           ORDER BY (role = 'admin') DESC, created_at ASC
           LIMIT 1`
        : `SELECT id
           FROM staff_users
           WHERE tenant_id = ?
             AND (LOWER(email) = LOWER(?) OR LOWER(name) = LOWER(?))
           LIMIT 1`;
    const [candidateRows] = await pool.query<RowDataPacket[]>(candidateSql, [tenantId, email, managerName]);
    const existingId = candidateRows[0]?.id ? String(candidateRows[0].id) : null;

    if (existingId) {
      const sets: string[] = ["name = ?", "email = ?", "role = ?", "active = ?"];
      const vals: unknown[] = [managerName, email, role, active ? 1 : 0];
      if (staffCols.has("permissions_json")) {
        sets.push("permissions_json = ?");
        vals.push(permissionsJson);
      }
      if (staffCols.has("wallet_balance")) {
        sets.push("wallet_balance = ?");
        vals.push(balance);
      }
      if (staffCols.has("opening_balance")) {
        sets.push("opening_balance = ?");
        vals.push(balance);
      }
      vals.push(existingId, tenantId);
      await pool.query(`UPDATE staff_users SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, vals);
      synced += 1;
      continue;
    }

    const fields: string[] = ["id", "tenant_id", "name", "email", "password_hash", "role", "active"];
    const values: unknown[] = [randomUUID(), tenantId, managerName, email, "", role, active ? 1 : 0];
    if (staffCols.has("permissions_json")) {
      fields.push("permissions_json");
      values.push(permissionsJson);
    }
    if (staffCols.has("wallet_balance")) {
      fields.push("wallet_balance");
      values.push(balance);
    }
    if (staffCols.has("opening_balance")) {
      fields.push("opening_balance");
      values.push(balance);
    }
    await pool.query(
      `INSERT INTO staff_users (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
      values
    );
    synced += 1;
  }

  return { synced };
}
