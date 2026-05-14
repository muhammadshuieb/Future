import type { Pool } from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";
import { config } from "../config.js";
import {
  formatRadiusExpirationUtc,
} from "../lib/radius-attr-format.js";

/** Package fields used when writing radreply (and radcheck Simultaneous-Use fallback). */
export type PackageRow = {
  id: string;
  mikrotik_rate_limit: string | null;
  framed_ip_address: string | null;
  mikrotik_address_list: string | null;
  default_framed_pool: string | null;
  simultaneous_use: number;
};

export type RadiusUserOptions = {
  framedIp?: string | null;
  macLock?: string | null;
  framedPool?: string | null;
  /** When set, writes `Expiration` into radcheck (FreeRADIUS auth-time check). */
  expirationDate?: Date | null;
  /** Overrides package.simultaneous_use for Simultaneous-Use in radcheck when set. */
  simultaneousUse?: number;
};

/** Payload for createRadiusUser / enableRadiusUser (DB is source of truth for speed/pool). */
export type RadiusUserInput = {
  username: string;
  password: string;
  package: PackageRow;
  framedIp?: string | null;
  macLock?: string | null;
  framedPool?: string | null;
  expirationDate?: Date | null;
  simultaneousUse?: number;
};

/**
 * FreeRADIUS via MySQL only — radcheck / radreply. Does not alter table DDL.
 */
export class RadiusService {
  constructor(private readonly pool: Pool) {}

  /**
   * Idempotent: clears all prior radcheck/radreply rows for this user, then inserts fresh rows.
   */
  async createRadiusUser(user: RadiusUserInput): Promise<void> {
    await this.createUser(user.username, user.password, user.package, {
      framedIp: user.framedIp ?? undefined,
      macLock: user.macLock ?? undefined,
      framedPool: user.framedPool ?? undefined,
      expirationDate: user.expirationDate ?? null,
      simultaneousUse: user.simultaneousUse,
    });
  }

  async createUser(
    username: string,
    password: string,
    pkg: PackageRow,
    opts: RadiusUserOptions = {}
  ): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`DELETE FROM radcheck WHERE username = ?`, [username]);
      await conn.execute(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)`,
        [username, password]
      );
      const rawSim =
        opts.simultaneousUse != null && Number.isFinite(Number(opts.simultaneousUse))
          ? Number(opts.simultaneousUse)
          : Number(pkg.simultaneous_use ?? 1);
      const sim = Math.max(1, Math.floor(rawSim));
      await conn.execute(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Simultaneous-Use', ':=', ?)`,
        [username, String(sim)]
      );
      const macLock = opts.macLock?.trim();
      if (macLock) {
        await conn.execute(
          `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Calling-Station-Id', '==', ?)`,
          [username, macLock]
        );
      }
      if (opts.expirationDate) {
        const expVal = formatRadiusExpirationUtc(
          opts.expirationDate instanceof Date ? opts.expirationDate : new Date(opts.expirationDate)
        );
        await conn.execute(
          `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Expiration', ':=', ?)`,
          [username, expVal]
        );
      }
      await conn.execute(`DELETE FROM radreply WHERE username = ?`, [username]);
      const replies: [string, string][] = [];
      if (pkg.mikrotik_rate_limit) {
        replies.push(["Mikrotik-Rate-Limit", pkg.mikrotik_rate_limit]);
      }
      const framedIp = opts.framedIp ?? pkg.framed_ip_address;
      if (framedIp) replies.push(["Framed-IP-Address", framedIp]);
      const poolName = opts.framedPool ?? pkg.default_framed_pool;
      if (poolName) replies.push(["Framed-Pool", poolName]);
      if (pkg.mikrotik_address_list) {
        replies.push(["Mikrotik-Address-List", pkg.mikrotik_address_list]);
      }
      for (const [attr, value] of replies) {
        await conn.execute(
          `INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ':=', ?)`,
          [username, attr, value]
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

  async disableRadiusUser(username: string): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [passwordRows] = await conn.query<RowDataPacket[]>(
        `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password' LIMIT 1`,
        [username]
      );
      const preservedPassword =
        passwordRows[0]?.value != null && String(passwordRows[0].value).trim() !== ""
          ? String(passwordRows[0].value)
          : null;
      await conn.execute(`DELETE FROM radcheck WHERE username = ?`, [username]);
      await conn.execute(`DELETE FROM radreply WHERE username = ?`, [username]);
      if (preservedPassword) {
        await conn.execute(
          `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)`,
          [username, preservedPassword]
        );
      }
      await conn.execute(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Auth-Type', ':=', 'Reject')`,
        [username]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  /**
   * Hard quota / administrative deny: no Cleartext-Password, auth rejected at RADIUS.
   */
  async applyQuotaHardDeny(username: string): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`DELETE FROM radcheck WHERE username = ?`, [username]);
      await conn.execute(`DELETE FROM radreply WHERE username = ?`, [username]);
      await conn.execute(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Auth-Type', ':=', 'Reject')`,
        [username]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  /** Same as createRadiusUser — full row replace, no duplicate attributes. */
  async enableRadiusUser(user: RadiusUserInput): Promise<void> {
    await this.createRadiusUser(user);
  }

  /**
   * Update Mikrotik-Rate-Limit only (UPSERT-style: update row or insert if missing).
   */
  async updateUserSpeed(username: string, speed: string): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      const [res] = await conn.execute<ResultSetHeader>(
        `UPDATE radreply SET value = ? WHERE username = ? AND attribute = 'Mikrotik-Rate-Limit'`,
        [speed, username]
      );
      if (res.affectedRows === 0) {
        await conn.execute(
          `INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
          [username, speed]
        );
      }
    } finally {
      conn.release();
    }
  }

  /** @deprecated use disableRadiusUser */
  async disableUser(username: string): Promise<void> {
    await this.disableRadiusUser(username);
  }

  /** @deprecated use enableRadiusUser */
  async enableUser(
    username: string,
    password: string,
    pkg: PackageRow,
    opts: RadiusUserOptions = {}
  ): Promise<void> {
    await this.createUser(username, password, pkg, opts);
  }

  async listDistinctUsernamesFromRadcheck(): Promise<string[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT DISTINCT username FROM radcheck WHERE username <> '' ORDER BY username`
    );
    return rows.map((r) => r.username as string);
  }

  async getPackage(tenantId: string, packageId: string): Promise<PackageRow | null> {
    if (await hasTable(this.pool, "packages")) {
      const col = await getTableColumns(this.pool, "packages");
      const want = [
        "id",
        "mikrotik_rate_limit",
        "framed_ip_address",
        "mikrotik_address_list",
        "default_framed_pool",
        "simultaneous_use",
        "quota_total_bytes",
      ];
      const sel = want.filter((c) => col.has(c));
      if (sel.includes("id")) {
        let sql = `SELECT ${sel.join(", ")} FROM packages WHERE tenant_id = ? AND id = ?`;
        const params: unknown[] = [tenantId, packageId];
        if (col.has("active")) {
          sql += ` AND active = 1`;
        }
        sql += ` LIMIT 1`;
        const [rows] = await this.pool.query<RowDataPacket[]>(sql, params);
        const r = rows[0];
        if (r) {
          return {
            id: String(r.id),
            mikrotik_rate_limit: r.mikrotik_rate_limit != null ? String(r.mikrotik_rate_limit) : null,
            framed_ip_address: r.framed_ip_address != null ? String(r.framed_ip_address) : null,
            mikrotik_address_list: r.mikrotik_address_list != null ? String(r.mikrotik_address_list) : null,
            default_framed_pool: r.default_framed_pool != null ? String(r.default_framed_pool) : null,
            simultaneous_use: Number(r.simultaneous_use ?? 1),
          };
        }
      }
    }

    return null;
  }

  async getCleartextPassword(username: string): Promise<string | null> {
    if (await hasTable(this.pool, "radcheck")) {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password' LIMIT 1`,
        [username]
      );
      const v = rows[0]?.value;
      if (v != null && String(v).trim() !== "") return String(v);
    }
    if (await hasTable(this.pool, "subscriber_credentials")) {
      const [sub] = await this.pool.query<RowDataPacket[]>(
        `SELECT sc.password
         FROM subscriber_credentials sc
         INNER JOIN subscribers s ON s.id = sc.subscriber_id
         WHERE s.username = ?
         LIMIT 1`,
        [username]
      );
      const p = sub[0]?.password;
      const password = p != null ? String(p).trim() : "";
      if (/^[a-f0-9]{32}$/i.test(password)) return null;
      if (password !== "") return password;
    }
    return null;
  }

  async getPasswordForDisplay(username: string): Promise<string | null> {
    const clear = await this.getCleartextPassword(username);
    if (clear) return clear;

    if (await hasTable(this.pool, "radcheck")) {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT value FROM radcheck
         WHERE username = ? AND attribute IN ('User-Password', 'Password')
         ORDER BY FIELD(attribute, 'User-Password', 'Password')
         LIMIT 1`,
        [username]
      );
      const radcheckPassword = rows[0]?.value != null ? String(rows[0].value).trim() : "";
      if (radcheckPassword && !/^[a-f0-9]{32}$/i.test(radcheckPassword)) return radcheckPassword;
    }

    if (await hasTable(this.pool, "subscriber_credentials")) {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT sc.password
         FROM subscriber_credentials sc
         INNER JOIN subscribers s ON s.id = sc.subscriber_id
         WHERE s.username = ?
         LIMIT 1`,
        [username]
      );
      const stored = rows[0]?.password != null ? String(rows[0].password).trim() : "";
      if (stored && !/^[a-f0-9]{32}$/i.test(stored)) return stored;
    }

    return null;
  }
}
