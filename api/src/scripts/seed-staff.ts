import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import type { RowDataPacket } from "mysql2";

async function main() {
  const name = process.env.SEED_ADMIN_NAME ?? "Administrator";
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@local.test";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "change-me-now";
  const hash = await bcrypt.hash(password, 12);
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM staff_users WHERE tenant_id = ? AND email = ? LIMIT 1`,
    [config.defaultTenantId, email]
  );
  if (existing[0]) {
    await pool.execute(
      `UPDATE staff_users SET name = ?, password_hash = ?, role = 'admin', active = 1 WHERE id = ?`,
      [name, hash, existing[0].id]
    );
  } else {
    await pool.execute(
      `INSERT INTO staff_users (id, tenant_id, name, email, password_hash, role, active)
       VALUES (?, ?, ?, ?, ?, 'admin', 1)`,
      [randomUUID(), config.defaultTenantId, name, email, hash]
    );
  }
  console.log(`Seeded staff: ${email} (change password in production)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
