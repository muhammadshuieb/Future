import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { hashStaffPassword } from "../lib/staff-password.js";

type EnsureDefaultAdminOptions = {
  overwritePassword?: boolean;
};

function envTruthy(v: string | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/**
 * Ensures default tenant, RBAC roles, and a bootstrap staff user (`users` table).
 * Password from STAFF_BOOTSTRAP_PASSWORD or DEFAULT_ADMIN_PASSWORD; requires STRONG value in production via env.
 */
export async function ensureDefaultAdminUser(
  options: EnsureDefaultAdminOptions = {}
): Promise<{ status: "created" | "updated" | "skipped"; email: string }> {
  const pwReset = envTruthy(process.env.STAFF_BOOTSTRAP_PASSWORD_RESET);
  const overwritePassword = options.overwritePassword === true || pwReset;

  const tenantId = config.defaultTenantId;
  const staffEmail =
    process.env.STAFF_BOOTSTRAP_EMAIL?.trim() ||
    process.env.DEFAULT_ADMIN_EMAIL?.trim() ||
    "admin@futureradius.local";

  const password =
    process.env.STAFF_BOOTSTRAP_PASSWORD?.trim() ||
    process.env.DEFAULT_ADMIN_PASSWORD?.trim() ||
    (config.nodeEnv === "production" ? "" : "muhammadshuieb");

  if (config.nodeEnv === "production" && !password) {
    console.warn("[bootstrap] STAFF_BOOTSTRAP_PASSWORD / DEFAULT_ADMIN_PASSWORD not set — skipping admin seed");
    return { status: "skipped", email: staffEmail };
  }

  if (!(await hasTable(pool, "tenants"))) {
    console.warn("[bootstrap] tenants table missing — migrations not applied?");
    return { status: "skipped", email: staffEmail };
  }

  await pool.execute(
    `INSERT IGNORE INTO tenants (id, name, status) VALUES (?, 'Default', 'active')`,
    [tenantId]
  );

  const roleNames = ["admin", "manager", "accountant", "viewer"] as const;
  const roleIdByName = new Map<string, string>();
  for (const rn of roleNames) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM roles WHERE tenant_id = ? AND name = ? LIMIT 1`,
      [tenantId, rn]
    );
    if (rows[0]?.id) {
      roleIdByName.set(rn, String(rows[0].id));
      continue;
    }
    const rid = randomUUID();
    await pool.execute(`INSERT INTO roles (id, tenant_id, name) VALUES (?, ?, ?)`, [rid, tenantId, rn]);
    roleIdByName.set(rn, rid);
  }

  const adminRoleId = roleIdByName.get("admin");
  if (!adminRoleId || !(await hasTable(pool, "users"))) {
    return { status: "skipped", email: staffEmail };
  }

  const hash = await hashStaffPassword(password);
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.password_hash FROM users u
     WHERE u.tenant_id = ? AND LOWER(u.email) = LOWER(?) LIMIT 1`,
    [tenantId, staffEmail]
  );

  if (existing[0]) {
    const uid = String((existing[0] as RowDataPacket).id);
    const ph = String((existing[0] as RowDataPacket).password_hash ?? "");
    const looksBcrypt = /^\$2[aby]\$\d{2}\$/.test(ph);
    if (overwritePassword || !looksBcrypt) {
      await pool.execute(`UPDATE users SET password_hash = ?, name = COALESCE(NULLIF(name,''), 'Administrator') WHERE id = ?`, [
        hash,
        uid,
      ]);
    }
    const [ur] = await pool.query<RowDataPacket[]>(
      `SELECT 1 AS ok FROM user_roles WHERE user_id = ? AND role_id = ? LIMIT 1`,
      [uid, adminRoleId]
    );
    if (!ur[0]) {
      await pool.execute(`INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`, [uid, adminRoleId]);
    }
    return { status: "updated", email: staffEmail };
  }

  const userId = randomUUID();
  await pool.execute(
    `INSERT INTO users (id, tenant_id, email, name, password_hash, status, wallet_balance, allowed_negative_balance)
     VALUES (?, ?, ?, 'Administrator', ?, 'active', 0, 0)`,
    [userId, tenantId, staffEmail, hash]
  );
  await pool.execute(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, [userId, adminRoleId]);

  return { status: "created", email: staffEmail };
}
