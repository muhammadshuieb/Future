import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { config } from "../config.js";

/**
 * Aggregates radacct into user_usage_live / user_usage_daily.
 * Each radacct row is one session; octets are cumulative for that session.
 *
 * Active session rule (aligns with FreeRADIUS / external schema): acctstoptime IS NULL.
 */
export class AccountingService {
  constructor(private readonly pool: Pool) {}

  /** Alias: aggregate radacct â†’ user_usage_live. */
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

  private activeSessionFreshMinutes(): number {
    const fromMinutes = Number.parseInt(process.env.ACTIVE_SESSION_FRESH_MINUTES ?? "", 10);
    if (Number.isFinite(fromMinutes) && fromMinutes > 0) {
      return Math.max(1, Math.min(24 * 60 * 30, fromMinutes));
    }
    const fromHours = Number.parseInt(process.env.ACTIVE_SESSION_FRESH_HOURS ?? "1", 10) || 1;
    return Math.max(1, Math.min(24 * 60 * 30, fromHours * 60));
  }

  private async activeSessionWhere(alias?: string): Promise<string> {
    const p = alias ? `${alias}.` : "";
    const hasAcctUpdate = await hasColumn(this.pool, "radacct", "acctupdatetime");
    const freshMinutes = this.activeSessionFreshMinutes();
    if (!hasAcctUpdate) {
      return `${p}acctstoptime IS NULL
      AND ${p}acctstarttime >= DATE_SUB(NOW(), INTERVAL ${freshMinutes} MINUTE)`;
    }
    return `${p}acctstoptime IS NULL
      AND (
        (${p}acctupdatetime IS NOT NULL AND ${p}acctupdatetime >= DATE_SUB(NOW(), INTERVAL ${freshMinutes} MINUTE))
        OR ${p}acctstarttime >= DATE_SUB(NOW(), INTERVAL ${freshMinutes} MINUTE)
      )`;
  }

  async countActiveUsernames(tenantId: string): Promise<number> {
    if (!(await hasTable(this.pool, "radacct"))) return 0;
    if (!(await hasTable(this.pool, "subscribers"))) return 0;
    const activeWhere = await this.activeSessionWhere("r");
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

  /** No-op if `subscribers.used_bytes` or `user_usage_live` is absent. */
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
    if (!(await hasTable(this.pool, "subscribers"))) return 0;
    const activeWhere = await this.activeSessionWhere("r");
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
    if (!(await hasTable(this.pool, "subscribers"))) return [];
    const activeWhere = await this.activeSessionWhere("r");
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

  /**
   * Subscriber portal traffic report: daily/monthly/yearly rollups + recent sessions (radacct).
   */
  async buildSubscriberTrafficReport(
    tenantId: string,
    username: string,
    opts?: { from?: string; to?: string }
  ): Promise<{
    username: string;
    filter: { from: string | null; to: string | null };
    totals: {
      daily_online_seconds: number;
      daily_download_bytes: string;
      daily_upload_bytes: string;
      daily_total_bytes: string;
      monthly_online_seconds: number;
      monthly_download_bytes: string;
      monthly_upload_bytes: string;
      monthly_total_bytes: string;
    };
    daily: {
      period: string;
      sessions_count: number;
      online_seconds: number;
      download_bytes: string;
      upload_bytes: string;
      total_bytes: string;
    }[];
    monthly: {
      period: string;
      sessions_count: number;
      online_seconds: number;
      download_bytes: string;
      upload_bytes: string;
      total_bytes: string;
    }[];
    yearly: {
      period: string;
      sessions_count: number;
      online_seconds: number;
      download_bytes: string;
      upload_bytes: string;
      total_bytes: string;
    }[];
    sessions: {
      radacctid: string;
      start_time: string | null;
      stop_time: string | null;
      online_seconds: number;
      download_bytes: string;
      upload_bytes: string;
      total_bytes: string;
      framed_ip: string | null;
      caller_id: string | null;
      nas_ip: string | null;
      is_active: boolean;
    }[];
  }> {
    type Row = {
      period: string;
      sessions_count: number;
      online_seconds: number;
      download_bytes: string;
      upload_bytes: string;
      total_bytes: string;
    };
    type Sess = {
      radacctid: string;
      start_time: string | null;
      stop_time: string | null;
      online_seconds: number;
      download_bytes: string;
      upload_bytes: string;
      total_bytes: string;
      framed_ip: string | null;
      caller_id: string | null;
      nas_ip: string | null;
      is_active: boolean;
    };
    const empty = () => ({
      username,
      filter: { from: opts?.from?.trim() || null, to: opts?.to?.trim() || null },
      totals: {
        daily_online_seconds: 0,
        daily_download_bytes: "0",
        daily_upload_bytes: "0",
        daily_total_bytes: "0",
        monthly_online_seconds: 0,
        monthly_download_bytes: "0",
        monthly_upload_bytes: "0",
        monthly_total_bytes: "0",
      },
      daily: [] as Row[],
      monthly: [] as Row[],
      yearly: [] as Row[],
      sessions: [] as Sess[],
    });
    if (!(await hasTable(this.pool, "radacct"))) return empty();

    const rawOct = await this.sessionOctetExpression();
    const octR = rawOct
      .replace(/acctinputoctets/g, "r.acctinputoctets")
      .replace(/acctoutputoctets/g, "r.acctoutputoctets")
      .replace(/acctinputgigawords/g, "r.acctinputgigawords")
      .replace(/acctoutputgigawords/g, "r.acctoutputgigawords");
    const activeWhere = await this.activeSessionWhere("r");
    const from = opts?.from?.trim() || null;
    const to = opts?.to?.trim() || null;
    const dateFilter =
      from && to
        ? `AND DATE(COALESCE(r.acctstoptime, r.acctupdatetime, r.acctstarttime)) BETWEEN ? AND ?`
        : "";
    const dateArgs = from && to ? [from, to] : [];
    const dayExpr = `DATE(COALESCE(r.acctstoptime, r.acctupdatetime, r.acctstarttime))`;

    const [dailyRows] = await this.pool.query<RowDataPacket[]>(
      `
      SELECT
        ${dayExpr} AS period,
        COUNT(*) AS sessions_count,
        COALESCE(SUM(COALESCE(r.acctsessiontime, 0)), 0) AS online_seconds,
        COALESCE(SUM(COALESCE(r.acctoutputoctets, 0)), 0) AS download_bytes,
        COALESCE(SUM(COALESCE(r.acctinputoctets, 0)), 0) AS upload_bytes,
        COALESCE(SUM(${octR}), 0) AS total_bytes
      FROM radacct r
      INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
      WHERE r.username = ?
      ${dateFilter}
      GROUP BY ${dayExpr}
      ORDER BY period DESC
      LIMIT 62
      `,
      [tenantId, username, ...dateArgs]
    );

    const [monthlyRows] = await this.pool.query<RowDataPacket[]>(
      `
      SELECT
        DATE_FORMAT(COALESCE(r.acctstoptime, r.acctupdatetime, r.acctstarttime), '%Y-%m') AS period,
        COUNT(*) AS sessions_count,
        COALESCE(SUM(COALESCE(r.acctsessiontime, 0)), 0) AS online_seconds,
        COALESCE(SUM(COALESCE(r.acctoutputoctets, 0)), 0) AS download_bytes,
        COALESCE(SUM(COALESCE(r.acctinputoctets, 0)), 0) AS upload_bytes,
        COALESCE(SUM(${octR}), 0) AS total_bytes
      FROM radacct r
      INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
      WHERE r.username = ?
      ${dateFilter}
      GROUP BY DATE_FORMAT(COALESCE(r.acctstoptime, r.acctupdatetime, r.acctstarttime), '%Y-%m')
      ORDER BY period DESC
      LIMIT 24
      `,
      [tenantId, username, ...dateArgs]
    );

    const [yearlyRows] = await this.pool.query<RowDataPacket[]>(
      `
      SELECT
        CAST(YEAR(COALESCE(r.acctstoptime, r.acctupdatetime, r.acctstarttime)) AS CHAR) AS period,
        COUNT(*) AS sessions_count,
        COALESCE(SUM(COALESCE(r.acctsessiontime, 0)), 0) AS online_seconds,
        COALESCE(SUM(COALESCE(r.acctoutputoctets, 0)), 0) AS download_bytes,
        COALESCE(SUM(COALESCE(r.acctinputoctets, 0)), 0) AS upload_bytes,
        COALESCE(SUM(${octR}), 0) AS total_bytes
      FROM radacct r
      INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
      WHERE r.username = ?
      ${dateFilter}
      GROUP BY YEAR(COALESCE(r.acctstoptime, r.acctupdatetime, r.acctstarttime))
      ORDER BY period DESC
      LIMIT 8
      `,
      [tenantId, username, ...dateArgs]
    );

    const today = new Date().toISOString().slice(0, 10);
    const monthPrefix = new Date().toISOString().slice(0, 7);

    const agg = (rows: RowDataPacket[], pred: (r: RowDataPacket) => boolean) =>
      rows.filter(pred).reduce(
        (acc, r) => ({
          online: acc.online + Number(r.online_seconds ?? 0),
          down: acc.down + BigInt(String(r.download_bytes ?? 0)),
          up: acc.up + BigInt(String(r.upload_bytes ?? 0)),
          tot: acc.tot + BigInt(String(r.total_bytes ?? 0)),
        }),
        { online: 0, down: 0n, up: 0n, tot: 0n }
      );

    const dAgg = agg(dailyRows, (r) => String(r.period) === today);
    const mAgg = agg(monthlyRows, (r) => String(r.period) === monthPrefix);

    const [sessRows] = await this.pool.query<RowDataPacket[]>(
      `
      SELECT
        r.radacctid,
        r.acctstarttime AS start_time,
        r.acctstoptime AS stop_time,
        COALESCE(r.acctsessiontime, 0) AS online_seconds,
        COALESCE(r.acctoutputoctets, 0) AS download_bytes,
        COALESCE(r.acctinputoctets, 0) AS upload_bytes,
        ${octR} AS total_bytes,
        r.framedipaddress AS framed_ip,
        r.callingstationid AS caller_id,
        r.nasipaddress AS nas_ip,
        CASE WHEN ${activeWhere} THEN 1 ELSE 0 END AS is_active
      FROM radacct r
      INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
      WHERE r.username = ?
      ${dateFilter}
      ORDER BY r.acctstarttime DESC
      LIMIT 200
      `,
      [tenantId, username, ...dateArgs]
    );

    const mapRoll = (rows: RowDataPacket[]) =>
      rows.map((r) => ({
        period: String(r.period),
        sessions_count: Number(r.sessions_count ?? 0),
        online_seconds: Number(r.online_seconds ?? 0),
        download_bytes: String(r.download_bytes ?? 0),
        upload_bytes: String(r.upload_bytes ?? 0),
        total_bytes: String(r.total_bytes ?? 0),
      }));

    const result = {
      username,
      filter: { from, to },
      totals: {
        daily_online_seconds: dAgg.online,
        daily_download_bytes: dAgg.down.toString(),
        daily_upload_bytes: dAgg.up.toString(),
        daily_total_bytes: dAgg.tot.toString(),
        monthly_online_seconds: mAgg.online,
        monthly_download_bytes: mAgg.down.toString(),
        monthly_upload_bytes: mAgg.up.toString(),
        monthly_total_bytes: mAgg.tot.toString(),
      },
      daily: mapRoll(dailyRows),
      monthly: mapRoll(monthlyRows),
      yearly: mapRoll(yearlyRows),
      sessions: sessRows.map((r) => ({
        radacctid: String(r.radacctid),
        start_time: r.start_time ? new Date(r.start_time as Date).toISOString() : null,
        stop_time: r.stop_time ? new Date(r.stop_time as Date).toISOString() : null,
        online_seconds: Number(r.online_seconds ?? 0),
        download_bytes: String(r.download_bytes ?? 0),
        upload_bytes: String(r.upload_bytes ?? 0),
        total_bytes: String(r.total_bytes ?? 0),
        framed_ip: r.framed_ip ? String(r.framed_ip) : null,
        caller_id: r.caller_id ? String(r.caller_id) : null,
        nas_ip: r.nas_ip ? String(r.nas_ip) : null,
        is_active: Boolean(r.is_active),
      })),
    };
    return result;
  }
}
