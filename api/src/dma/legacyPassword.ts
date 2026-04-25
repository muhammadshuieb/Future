import { createHash } from "crypto";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasTable } from "../db/schemaGuards.js";

function md5Hex(plain: string): string {
  return createHash("md5").update(plain, "utf8").digest("hex");
}

/**
 * RADIUS: Cleartext-Password in radcheck; rm_users may store 32-hex MD5 of the password.
 */
export async function verifyLegacySubscriberPassword(
  pool: Pool,
  username: string,
  password: string
): Promise<boolean> {
  const hasRad = await hasTable(pool, "radcheck");
  if (hasRad) {
    const [pwRows] = await pool.query<RowDataPacket[]>(
      `SELECT value FROM radcheck
       WHERE username = ? AND UPPER(TRIM(attribute)) = UPPER('Cleartext-Password') LIMIT 1`,
      [username]
    );
    const stored = pwRows[0]?.value != null ? String(pwRows[0].value) : null;
    if (stored != null && stored === password) return true;
  }
  if (await hasTable(pool, "rm_users")) {
    const [rmRows] = await pool.query<RowDataPacket[]>(
      `SELECT password FROM rm_users WHERE username = ? LIMIT 1`,
      [username]
    );
    const p = rmRows[0]?.password != null ? String(rmRows[0].password).trim() : "";
    if (p.length === 32 && /^[0-9a-fA-F]+$/.test(p) && md5Hex(password) === p.toLowerCase()) {
      return true;
    }
  }
  return false;
}
