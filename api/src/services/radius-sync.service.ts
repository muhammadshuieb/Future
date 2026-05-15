import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { loadSubscriberAccessRow } from "../lib/subscriber-access-guard.js";
import { resolveRadiusSyncDenyReason } from "../lib/radius-sync-deny.js";

type SyncLogStatus = "success" | "failed";

export class RadiusSyncService {
  constructor(private readonly pool: Pool) {}

  async syncAll(tenantId: string): Promise<void> {
    await this.syncNasDevices(tenantId);
    await this.syncPackages(tenantId);
    await this.syncSubscribers(tenantId);
  }

  /** Rebuild `nas` from all `nas_devices` for this tenant (idempotent; fixes missing/stale RADIUS clients). */
  async syncAllNasDevices(tenantId: string): Promise<void> {
    await this.syncNasDevices(tenantId);
  }

  async syncPackage(packageId: string, tenantId: string): Promise<void> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, name, mikrotik_rate_limit, default_framed_pool, simultaneous_use
       FROM packages
       WHERE id = ? AND tenant_id = ? AND active = 1
       LIMIT 1`,
      [packageId, tenantId]
    );
    const pkg = rows[0];
    if (!pkg) return;
    await this.pool.execute(`DELETE FROM radgroupreply WHERE groupname = ?`, [String(pkg.id)]);
    const replies: Array<[string, string]> = [];
    if (pkg.mikrotik_rate_limit) replies.push(["Mikrotik-Rate-Limit", String(pkg.mikrotik_rate_limit)]);
    if (pkg.default_framed_pool) replies.push(["Framed-Pool", String(pkg.default_framed_pool)]);
    for (const [attribute, value] of replies) {
      await this.pool.execute(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ':=', ?)`,
        [String(pkg.id), attribute, value]
      );
    }
    await this.log(tenantId, "package", packageId, "success");
  }

  async syncSubscriber(subscriberId: string, tenantId: string): Promise<void> {
    const access = await loadSubscriberAccessRow(this.pool, { tenantId, subscriberId });
    if (!access) return;
    const username = access.username.trim();
    if (!username) return;
    const denyReason = resolveRadiusSyncDenyReason(access);
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`DELETE FROM radcheck WHERE username = ?`, [username]);
      await conn.execute(`DELETE FROM radreply WHERE username = ?`, [username]);
      await conn.execute(`DELETE FROM radusergroup WHERE username = ?`, [username]);
      const password = String(access.credential_password ?? "").trim();
      if (denyReason) {
        await conn.execute(
          `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Auth-Type', ':=', 'Reject')`,
          [username]
        );
        await conn.commit();
        await this.log(tenantId, "subscriber", subscriberId, "success", `radius_reject:${denyReason}`);
        return;
      }
      await conn.execute(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)`,
        [username, password]
      );
      await conn.execute(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Simultaneous-Use', ':=', ?)`,
        [username, String(Math.max(1, Number(access.package_simultaneous_use ?? 1)))]
      );
      if (access.expiration_date) {
        await conn.execute(
          `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Expiration', ':=', DATE_FORMAT(?, '%d %b %Y %H:%i:%s'))`,
          [username, access.expiration_date]
        );
      }
      if (access.package_id) {
        await conn.execute(
          `INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)`,
          [username, String(access.package_id)]
        );
      }
      const replies: Array<[string, string]> = [];
      if (access.mikrotik_rate_limit) replies.push(["Mikrotik-Rate-Limit", access.mikrotik_rate_limit]);
      const framedIp = access.ip_address || access.framed_ip_address;
      if (framedIp) replies.push(["Framed-IP-Address", framedIp]);
      if (access.mikrotik_address_list) replies.push(["Mikrotik-Address-List", access.mikrotik_address_list]);
      const poolName = access.pool || access.default_framed_pool;
      if (poolName) replies.push(["Framed-Pool", poolName]);
      for (const [attribute, value] of replies) {
        await conn.execute(
          `INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ':=', ?)`,
          [username, attribute, value]
        );
      }
      await conn.commit();
      await this.log(tenantId, "subscriber", subscriberId, "success");
    } catch (error) {
      await conn.rollback();
      await this.log(tenantId, "subscriber", subscriberId, "failed", error);
      throw error;
    } finally {
      conn.release();
    }
  }

  async syncNasDevice(nasDeviceId: string, tenantId: string): Promise<void> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, name, ip, type, secret, status, wireguard_tunnel_ip
       FROM nas_devices WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [nasDeviceId, tenantId]
    );
    const row = rows[0];
    if (!row) {
      await this.pool.execute(`DELETE FROM nas WHERE description = ?`, [nasDeviceId]);
      return;
    }

    const deviceId = String(row.id);
    await this.pool.execute(`DELETE FROM nas WHERE description = ?`, [deviceId]);

    const statusNorm = String(row.status ?? "")
      .trim()
      .toLowerCase();
    if (statusNorm !== "active") {
      await this.log(tenantId, "nas", nasDeviceId, "success");
      return;
    }

    const secret = String(row.secret ?? "");
    const type = String(row.type ?? "other");
    const nameRaw = String(row.name ?? "nas").trim() || "nas";
    const shortBase = nameRaw.length > 32 ? nameRaw.slice(0, 32) : nameRaw;

    const primaryIp = String(row.ip ?? "").trim();
    const wgRaw =
      row.wireguard_tunnel_ip != null && String(row.wireguard_tunnel_ip).trim() !== ""
        ? String(row.wireguard_tunnel_ip).trim()
        : "";
    const nasNames = new Set<string>();
    if (primaryIp) nasNames.add(primaryIp);
    if (wgRaw && wgRaw !== primaryIp) nasNames.add(wgRaw);

    for (const nasname of nasNames) {
      const isWgOnly = nasname === wgRaw && primaryIp && wgRaw !== primaryIp;
      const shortname = (isWgOnly ? `${shortBase.slice(0, 28)}-wg` : shortBase).slice(0, 32);
      await this.pool.execute(
        `INSERT INTO nas (nasname, shortname, type, ports, secret, server, community, description)
         VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?)`,
        [nasname, shortname, type, secret, deviceId]
      );
    }

    await this.log(tenantId, "nas", nasDeviceId, "success");
  }

  private async syncPackages(tenantId: string): Promise<void> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT id FROM packages WHERE tenant_id = ?`, [tenantId]);
    for (const row of rows) await this.syncPackage(String(row.id), tenantId);
  }

  private async syncSubscribers(tenantId: string): Promise<void> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT id FROM subscribers WHERE tenant_id = ?`, [tenantId]);
    for (const row of rows) await this.syncSubscriber(String(row.id), tenantId);
  }

  private async syncNasDevices(tenantId: string): Promise<void> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT id FROM nas_devices WHERE tenant_id = ?`, [tenantId]);
    for (const row of rows) await this.syncNasDevice(String(row.id), tenantId);
  }

  /** Re-sync RADIUS rows for every subscriber on this package (e.g. NAS allow-list changed). */
  async syncSubscribersUsingPackage(packageId: string, tenantId: string): Promise<void> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id FROM subscribers WHERE tenant_id = ? AND package_id = ?`,
      [tenantId, packageId]
    );
    for (const row of rows) await this.syncSubscriber(String(row.id), tenantId);
  }

  private async log(
    tenantId: string,
    entityType: string,
    entityId: string,
    status: SyncLogStatus,
    error?: unknown
  ): Promise<void> {
    try {
      const message = error instanceof Error ? error.message : error ? String(error) : null;
      await this.pool.execute(
        `INSERT INTO radius_sync_logs (tenant_id, entity_type, entity_id, status, message)
         VALUES (?, ?, ?, ?, ?)`,
        [tenantId, entityType, entityId, status, message]
      );
    } catch {
      // Sync logging must never break the operational write path.
    }
  }
}
