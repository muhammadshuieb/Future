import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { hasTable } from "../db/schemaGuards.js";

type EnsureDefaultAdminOptions = {
  overwritePassword?: boolean;
};

export async function ensureDefaultAdminUser(
  options: EnsureDefaultAdminOptions = {}
): Promise<{ status: "created" | "updated" | "skipped"; email: string }> {
  const overwritePassword = options.overwritePassword === true;
  const name = process.env.SEED_ADMIN_NAME ?? "admin";
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@local.test";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "muhammadshuieb";

  const staffUsersExists = await hasTable(pool, "staff_users");
  if (!staffUsersExists) {
    return { status: "skipped", email };
  }

  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM staff_users WHERE tenant_id = ? AND email = ? LIMIT 1`,
    [config.defaultTenantId, email]
  );

  if (existing[0]) {
    if (!overwritePassword) {
      await pool.execute(`UPDATE staff_users SET active = 1, role = 'admin' WHERE id = ?`, [
        existing[0].id,
      ]);
      return { status: "updated", email };
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.execute(
      `UPDATE staff_users
       SET name = ?, password_hash = ?, role = 'admin', active = 1
       WHERE id = ?`,
      [name, hash, existing[0].id]
    );
    return { status: "updated", email };
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.execute(
    `INSERT INTO staff_users (id, tenant_id, name, email, password_hash, role, active)
     VALUES (?, ?, ?, ?, ?, 'admin', 1)`,
    [randomUUID(), config.defaultTenantId, name, email, hash]
  );
  return { status: "created", email };
}
