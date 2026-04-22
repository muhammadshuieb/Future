import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasColumn, hasTable } from "../db/schemaGuards.js";

/**
 * Aggregates radacct into user_usage_live / user_usage_daily.
 * Each radacct row is one session; octets are cumulative for that session.
 *
 * Active session rule (aligns with FreeRADIUS / Radius Manager): acctstoptime IS NULL.
 */
export class AccountingService {
  constructor(private readonly pool: Pool) {}

  /** Alias: aggregate radacct → user_usage_live. */
  async refreshUsageCache(tenantId: string): Promise<void> {
    return this.refreshLiveUsage(tenantId);
  }

  async refreshLiveUsage(tenantId: string): Promise<void> {
    if (!(await hasTable(this.pool, "radacct"))) return;
    // Per-session max octets (avoids double-counting Interim-Update rows), then sum sessions per user.
    await this.pool.query(
      `
      INSERT INTO user_usage_live (tenant_id, username, total_bytes, updated_at)
      SELECT
        ? AS tenant_id,
        username,
        COALESCE(SUM(session_bytes), 0),
        CURRENT_TIMESTAMP(3)
      FROM (
        SELECT
          username,
          radacctid,
          MAX(COALESCE(acctinputoctets, 0) + COALESCE(acctoutputoctets, 0)) AS session_bytes
        FROM radacct
        WHERE username <> ''
        GROUP BY username, radacctid
      ) t
      GROUP BY username
      ON DUPLICATE KEY UPDATE
        total_bytes = VALUES(total_bytes),
        updated_at = CURRENT_TIMESTAMP(3)
      `,
      [tenantId]
    );
  }

  /** No-op if `subscribers.used_bytes` is absent (run sql/schema_extensions or migrations). */
  async syncSubscribersUsedBytes(tenantId: string): Promise<void> {
    if (!(await hasTable(this.pool, "subscribers"))) return;
    if (!(await hasTable(this.pool, "user_usage_live"))) return;
    if (!(await hasColumn(this.pool, "subscribers", "used_bytes"))) return;
    await this.pool.query(
      `
      UPDATE subscribers s
      INNER JOIN user_usage_live u
        ON u.tenant_id = s.tenant_id AND u.username = s.username
      SET s.used_bytes = u.total_bytes
      WHERE s.tenant_id = ?
      `,
      [tenantId]
    );
  }

  /** Attribute traffic to the day the session stopped (billing-style daily totals). */
  async rollupDailyForStoppedSessions(tenantId: string, day: string): Promise<void> {
    if (!(await hasTable(this.pool, "radacct"))) return;
    await this.pool.query(
      `
      INSERT INTO user_usage_daily (tenant_id, username, day, total_bytes, updated_at)
      SELECT
        ?,
        username,
        ?,
        SUM(COALESCE(acctinputoctets, 0) + COALESCE(acctoutputoctets, 0)),
        CURRENT_TIMESTAMP(3)
      FROM radacct
      WHERE username <> ''
        AND acctstoptime IS NOT NULL
        AND DATE(acctstoptime) = ?
      GROUP BY username
      ON DUPLICATE KEY UPDATE
        total_bytes = VALUES(total_bytes),
        updated_at = CURRENT_TIMESTAMP(3)
      `,
      [tenantId, day, day]
    );
  }

  async getUsageForUser(
    tenantId: string,
    username: string
  ): Promise<{ total_bytes: bigint } | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT total_bytes FROM user_usage_live WHERE tenant_id = ? AND username = ? LIMIT 1`,
      [tenantId, username]
    );
    if (!rows[0]) return null;
    return { total_bytes: BigInt(rows[0].total_bytes as string | number) };
  }

  /**
   * Usage from radacct: per-session MAX(octets) then SUM — matches Interim-Update accounting.
   * Also returns gb (decimal GB, 6 places).
   */
  async getUserUsage(username: string): Promise<{ bytes: bigint; gb: number } | null> {
    if (!(await hasTable(this.pool, "radacct"))) return null;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `
      SELECT COALESCE(SUM(session_bytes), 0) AS total
      FROM (
        SELECT MAX(COALESCE(acctinputoctets, 0) + COALESCE(acctoutputoctets, 0)) AS session_bytes
        FROM radacct
        WHERE username = ? AND username <> ''
        GROUP BY radacctid
      ) t
      `,
      [username]
    );
    const raw = rows[0]?.total;
    const bytes = BigInt(raw != null ? String(raw) : "0");
    const gb = Number(bytes) / 1024 ** 3;
    return { bytes, gb: Math.round(gb * 1_000_000) / 1_000_000 };
  }

  async countActiveSessions(username?: string): Promise<number> {
    if (!(await hasTable(this.pool, "radacct"))) return 0;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      username
        ? `SELECT COUNT(*) AS c FROM radacct WHERE acctstoptime IS NULL AND username = ?`
        : `SELECT COUNT(*) AS c FROM radacct WHERE acctstoptime IS NULL`,
      username ? [username] : []
    );
    return Number(rows[0]?.c ?? 0);
  }

  async listOnlineSessions(username?: string, limit = 500): Promise<RowDataPacket[]> {
    if (!(await hasTable(this.pool, "radacct"))) return [];
    const sql = `
      SELECT radacctid, username, nasipaddress, acctstarttime, acctsessiontime,
             framedipaddress, callingstationid, acctinputoctets, acctoutputoctets
      FROM radacct
      WHERE acctstoptime IS NULL
      ${username ? "AND username = ?" : ""}
      ORDER BY acctstarttime DESC
      LIMIT ${Number(limit)}
    `;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      sql,
      username ? [username] : []
    );
    return rows;
  }
}
