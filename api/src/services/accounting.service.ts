import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { config } from "../config.js";

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

  private async sessionOctetExpression(): Promise<string> {
    const gIn = await hasColumn(this.pool, "radacct", "acctinputgigawords");
    const gOut = await hasColumn(this.pool, "radacct", "acctoutputgigawords");
    if (gIn && gOut) {
      return `(COALESCE(acctinputoctets,0) + COALESCE(acctinputgigawords,0) * 4294967296) + (COALESCE(acctoutputoctets,0) + COALESCE(acctoutputgigawords,0) * 4294967296)`;
    }
    return `COALESCE(acctinputoctets, 0) + COALESCE(acctoutputoctets, 0)`;
  }

  private activeSessionFreshHours(): number {
    return Math.max(
      1,
      Math.min(24 * 30, Number.parseInt(process.env.ACTIVE_SESSION_FRESH_HOURS ?? "72", 10) || 72)
    );
  }

  private async activeSessionWhere(alias?: string): Promise<string> {
    const p = alias ? `${alias}.` : "";
    const hasAcctUpdate = await hasColumn(this.pool, "radacct", "acctupdatetime");
    const freshHours = this.activeSessionFreshHours();
    if (!hasAcctUpdate) {
      return `${p}acctstoptime IS NULL
      AND ${p}acctstarttime >= DATE_SUB(NOW(), INTERVAL ${freshHours} HOUR)`;
    }
    return `${p}acctstoptime IS NULL
      AND (
        (${p}acctupdatetime IS NOT NULL AND ${p}acctupdatetime >= DATE_SUB(NOW(), INTERVAL ${freshHours} HOUR))
        OR ${p}acctstarttime >= DATE_SUB(NOW(), INTERVAL ${freshHours} HOUR)
      )`;
  }

  async countActiveUsernames(tenantId: string): Promise<number> {
    if (!(await hasTable(this.pool, "radacct"))) return 0;
    const activeWhere = await this.activeSessionWhere("r");
    if (config.dmaMode || !(await hasTable(this.pool, "subscribers"))) {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT r.username) AS c
         FROM radacct r
         WHERE ${activeWhere} AND r.username <> ''`
      );
      return Number(rows[0]?.c ?? 0);
    }
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT r.username) AS c
       FROM radacct r
       INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
       WHERE ${activeWhere} AND r.username <> ''`,
      [tenantId]
    );
    return Number(rows[0]?.c ?? 0);
  }

  async refreshLiveUsage(tenantId: string): Promise<void> {
    if (!(await hasTable(this.pool, "radacct"))) return;
    if (!(await hasTable(this.pool, "user_usage_live"))) return;
    const expr = await this.sessionOctetExpression();
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
          MAX(${expr}) AS session_bytes
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
    if (config.dmaMode) return;
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
    const expr = await this.sessionOctetExpression();
    await this.pool.query(
      `
      INSERT INTO user_usage_daily (tenant_id, username, day, total_bytes, updated_at)
      SELECT
        ?,
        username,
        ?,
        SUM(${expr}),
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
    const expr = await this.sessionOctetExpression();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `
      SELECT COALESCE(SUM(session_bytes), 0) AS total
      FROM (
        SELECT MAX(${expr}) AS session_bytes
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

  async countActiveSessions(tenantId: string, username?: string): Promise<number> {
    if (!(await hasTable(this.pool, "radacct"))) return 0;
    const activeWhere = await this.activeSessionWhere("r");
    if (config.dmaMode || !(await hasTable(this.pool, "subscribers"))) {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        username
          ? `SELECT COUNT(*) AS c FROM radacct r WHERE ${activeWhere} AND r.username = ?`
          : `SELECT COUNT(*) AS c FROM radacct r WHERE ${activeWhere}`,
        username ? [username] : []
      );
      return Number(rows[0]?.c ?? 0);
    }
    const [rows] = await this.pool.query<RowDataPacket[]>(
      username
        ? `SELECT COUNT(*) AS c
           FROM radacct r
           INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
           WHERE ${activeWhere} AND r.username = ?`
        : `SELECT COUNT(*) AS c
           FROM radacct r
           INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
           WHERE ${activeWhere}`,
      username ? [tenantId, username] : [tenantId]
    );
    return Number(rows[0]?.c ?? 0);
  }

  async listOnlineSessions(
    tenantId: string,
    username?: string,
    limit = 500
  ): Promise<RowDataPacket[]> {
    if (!(await hasTable(this.pool, "radacct"))) return [];
    const activeWhere = await this.activeSessionWhere("r");
    if (config.dmaMode || !(await hasTable(this.pool, "subscribers"))) {
      return this.legacyListOnlineSessions(username, limit, activeWhere);
    }
    const lim = Math.min(5000, Math.max(1, Number(limit) || 500));
    const sql = `
      SELECT r.radacctid, r.username, r.nasipaddress, r.acctstarttime, r.acctsessiontime,
             r.framedipaddress, r.callingstationid, r.acctinputoctets, r.acctoutputoctets
      FROM radacct r
      INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
      WHERE ${activeWhere}
      ${username ? "AND r.username = ?" : ""}
      ORDER BY r.acctstarttime DESC
      LIMIT ${lim}
    `;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      sql,
      username ? [tenantId, username] : [tenantId]
    );
    return rows;
  }

  /** Fallback when subscribers table is missing. */
  private async legacyListOnlineSessions(
    username?: string,
    limit = 500,
    activeWhere = "acctstoptime IS NULL"
  ): Promise<RowDataPacket[]> {
    const lim = Math.min(5000, Math.max(1, Number(limit) || 500));
    const sql = `
      SELECT radacctid, username, nasipaddress, acctstarttime, acctsessiontime,
             framedipaddress, callingstationid, acctinputoctets, acctoutputoctets
      FROM radacct r
      WHERE ${activeWhere}
      ${username ? "AND r.username = ?" : ""}
      ORDER BY acctstarttime DESC
      LIMIT ${lim}
    `;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      sql,
      username ? [username] : []
    );
    return rows;
  }
}
