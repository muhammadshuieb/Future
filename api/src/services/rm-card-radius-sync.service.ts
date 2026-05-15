import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

export type RmCardRadiusRow = {
  cardnum: string;
  password: string;
  expiration: string | Date;
  package_id: string | null;
  simultaneous_use: number;
  active: number;
  revoked: number;
  total_limit_mb: number;
};

export async function syncRmCardToRadius(pool: Pool, card: RmCardRadiusRow): Promise<void> {
  const username = String(card.cardnum ?? "").trim();
  if (!username) return;
  const password = String(card.password ?? "").trim();
  const disabled = Number(card.active ?? 1) === 0 || Number(card.revoked ?? 0) === 1;

  let packageRate: string | null = null;
  let packagePool: string | null = null;
  if (card.package_id) {
    const [pkgRows] = await pool.query<RowDataPacket[]>(
      `SELECT mikrotik_rate_limit, default_framed_pool FROM packages WHERE id = ? LIMIT 1`,
      [card.package_id]
    );
    if (pkgRows[0]) {
      packageRate = pkgRows[0].mikrotik_rate_limit != null ? String(pkgRows[0].mikrotik_rate_limit) : null;
      packagePool = pkgRows[0].default_framed_pool != null ? String(pkgRows[0].default_framed_pool) : null;
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM radcheck WHERE username = ?`, [username]);
    await conn.execute(`DELETE FROM radreply WHERE username = ?`, [username]);
    await conn.execute(`DELETE FROM radusergroup WHERE username = ?`, [username]);

    if (disabled) {
      await conn.execute(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Auth-Type', ':=', 'Reject')`,
        [username]
      );
      await conn.commit();
      return;
    }

    await conn.execute(
      `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)`,
      [username, password]
    );
    const sim = Math.max(1, Math.min(32, Number(card.simultaneous_use ?? 1) || 1));
    await conn.execute(
      `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Simultaneous-Use', ':=', ?)`,
      [username, String(sim)]
    );
    const exp = card.expiration ? new Date(card.expiration) : null;
    if (exp && !Number.isNaN(exp.getTime())) {
      await conn.execute(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Expiration', ':=', DATE_FORMAT(?, '%d %b %Y %H:%i:%s'))`,
        [username, exp]
      );
    }
    if (card.package_id) {
      await conn.execute(`INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)`, [
        username,
        String(card.package_id),
      ]);
    }
    if (packageRate) {
      await conn.execute(
        `INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
        [username, packageRate]
      );
    }
    if (packagePool) {
      await conn.execute(
        `INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Framed-Pool', ':=', ?)`,
        [username, packagePool]
      );
    }
    const totalMb = Number(card.total_limit_mb ?? 0);
    if (totalMb > 0) {
      const octets = String(Math.floor(totalMb * 1024 * 1024));
      await conn.execute(
        `INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Mikrotik-Total-Limit', ':=', ?)`,
        [username, octets]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function removeRmCardFromRadius(pool: Pool, cardnum: string): Promise<void> {
  const username = String(cardnum ?? "").trim();
  if (!username) return;
  await pool.execute(`DELETE FROM radcheck WHERE username = ?`, [username]);
  await pool.execute(`DELETE FROM radreply WHERE username = ?`, [username]);
  await pool.execute(`DELETE FROM radusergroup WHERE username = ?`, [username]);
}
