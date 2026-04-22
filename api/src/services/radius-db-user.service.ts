import { pool } from "../db/pool.js";
import { config } from "../config.js";

/**
 * Ensure the MySQL user used by FreeRADIUS (via mods-available/sql) exists
 * with the password declared in RADIUS_DB_PASSWORD and has access to the
 * RADIUS database. This reconciles the DB state with the current .env so that
 * rotating the RADIUS password in .env does not leave FreeRADIUS stranded
 * with the old password on the existing MySQL volume.
 */
export async function ensureRadiusDbUser(): Promise<
  { status: "ok"; user: string } | { status: "skipped"; reason: string }
> {
  const user = process.env.RADIUS_DB_USER?.trim() || "radius";
  const password = process.env.RADIUS_DB_PASSWORD?.trim() || "";
  if (!password) {
    return { status: "skipped", reason: "missing_password" };
  }
  const database = config.databaseName;
  try {
    const createStatements = [
      `CREATE USER IF NOT EXISTS \`${user}\`@'%' IDENTIFIED BY ${pool.escape(password)}`,
      `ALTER USER \`${user}\`@'%' IDENTIFIED BY ${pool.escape(password)}`,
      `GRANT ALL PRIVILEGES ON \`${database}\`.* TO \`${user}\`@'%'`,
      `FLUSH PRIVILEGES`,
    ];
    for (const sql of createStatements) {
      try {
        await pool.query(sql);
      } catch (error) {
        const message = (error as Error).message;
        // GRANT may fail on MySQL 8 if user specified without auth; CREATE USER
        // already handled it. Log and continue.
        console.warn("[radius-user] statement warning", message, {
          snippet: sql.slice(0, 120),
        });
      }
    }
    return { status: "ok", user };
  } catch (error) {
    console.error("[radius-user] failed to reconcile radius MySQL user", error);
    return { status: "skipped", reason: (error as Error).message };
  }
}
