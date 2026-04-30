import bcrypt from "bcryptjs";
import { createHash } from "crypto";
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
  const name = "admin";
  const email = "admin@local.test";
  const password = "muhammadshuieb";

  const rmManagersExists = await hasTable(pool, "rm_managers");
  if (rmManagersExists) {
    const md5 = createHash("md5").update(password, "utf8").digest("hex");
    const [existingRm] = await pool.query<RowDataPacket[]>(
      `SELECT managername FROM rm_managers WHERE managername = ? LIMIT 1`,
      [name]
    );
    if (existingRm[0]) {
      if (overwritePassword) {
        await pool.execute(
          `UPDATE rm_managers
           SET password = ?, email = ?, enablemanager = 1
           WHERE managername = ?`,
          [md5, email, name]
        );
      } else {
        await pool.execute(
          `UPDATE rm_managers
           SET email = ?, enablemanager = 1
           WHERE managername = ?`,
          [email, name]
        );
      }
      return { status: "updated", email };
    }
    await pool.execute(
      `INSERT INTO rm_managers
       (managername, password, email, firstname, lastname, enablemanager,
        perm_listmanagers, perm_createmanagers, perm_deletemanagers)
       VALUES (?, ?, ?, ?, ?, 1, 1, 1, 1)`,
      [name, md5, email, name, "admin"]
    );
    return { status: "created", email };
  }

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
