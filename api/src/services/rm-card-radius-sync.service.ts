import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import {
  evaluatePrepaidCardAccessFromRow,
  PREPAID_REPLY_MESSAGES,
  type PrepaidDenyReason,
} from "../lib/prepaid-card-access.js";

export type RmCardRadiusRow = {
  cardnum: string;
  password: string;
  expiration: string | Date;
  package_id: string | null;
  simultaneous_use: number;
  active: number;
  revoked: number;
  total_limit_mb: number;
  download_limit_mb?: number;
  upload_limit_mb?: number;
  online_time_limit?: number;
  lifecycle_status?: string | null;
  terminate_reason?: string | null;
  used_bytes?: number | bigint | string | null;
  used_seconds?: number | bigint | string | null;
  available_time_from_activation?: number | null;
  first_used_at?: Date | string | null;
};

function buildMikrotikRateLimit(row: RmCardRadiusRow, packageRate: string | null): string | null {
  const dl = Number(row.download_limit_mb ?? 0);
  const ul = Number(row.upload_limit_mb ?? 0);
  if (dl > 0 || ul > 0) {
    const up = ul > 0 ? `${ul}M` : "0";
    const down = dl > 0 ? `${dl}M` : "0";
    return `${up}/${down}`;
  }
  return packageRate;
}

function resolveDenyForSync(row: RmCardRadiusRow): { reason: PrepaidDenyReason; message: string } | null {
  if (Number(row.active ?? 1) === 0 || Number(row.revoked ?? 0) === 1) {
    return { reason: "disabled", message: PREPAID_REPLY_MESSAGES.disabled };
  }
  const explicit = String(row.terminate_reason ?? "").trim() as PrepaidDenyReason;
  if (explicit && explicit in PREPAID_REPLY_MESSAGES) {
    return { reason: explicit, message: PREPAID_REPLY_MESSAGES[explicit] };
  }
  const gate = evaluatePrepaidCardAccessFromRow({
    lifecycle_status: row.lifecycle_status ?? null,
    active: row.active,
    revoked: row.revoked,
    expiration: row.expiration,
    total_limit_mb: row.total_limit_mb,
    used_bytes: row.used_bytes ?? null,
    used_seconds: row.used_seconds ?? null,
    online_time_limit: row.online_time_limit ?? null,
    available_time_from_activation: row.available_time_from_activation ?? null,
    first_used_at: row.first_used_at ?? null,
  });
  if (!gate.ok) return { reason: gate.reason, message: gate.message };
  return null;
}

export async function syncRmCardToRadius(pool: Pool, card: RmCardRadiusRow): Promise<void> {
  const username = String(card.cardnum ?? "").trim();
  if (!username) return;
  const password = String(card.password ?? "").trim();
  const deny = resolveDenyForSync(card);

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

    if (deny) {
      await conn.execute(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Auth-Type', ':=', 'Reject')`,
        [username]
      );
      await conn.execute(
        `INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Reply-Message', ':=', ?)`,
        [username, deny.message.slice(0, 253)]
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

    const rateLimit = buildMikrotikRateLimit(card, packageRate);
    if (rateLimit) {
      await conn.execute(
        `INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
        [username, rateLimit]
      );
    }
    if (packagePool) {
      await conn.execute(
        `INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Framed-Pool', ':=', ?)`,
        [username, packagePool]
      );
    }

    const onlineMin = Number(card.online_time_limit ?? 0);
    if (onlineMin > 0) {
      const sessionTimeoutSec = String(Math.min(2147483647, onlineMin * 60));
      await conn.execute(
        `INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Session-Timeout', ':=', ?)`,
        [username, sessionTimeoutSec]
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
