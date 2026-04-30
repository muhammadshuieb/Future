import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { RadiusService } from "../services/radius.service.js";
import { decryptSecret } from "../services/crypto.service.js";
import { hasTable } from "../db/schemaGuards.js";
import { config } from "../config.js";

type SubscriberRow = RowDataPacket & {
  id: string;
  username: string;
  status: string;
  package_id: string | null;
  ip_address: string | null;
  mac_address: string | null;
  pool: string | null;
  radius_password_encrypted: Buffer | null;
  expiration_date: Date | string;
};

export class RadiusPushError extends Error {
  constructor(public readonly reason: string) {
    super(`radius_push_failed:${reason}`);
    this.name = "RadiusPushError";
  }
}

export function assertRadiusPush(
  r: { ok: true } | { ok: false; reason: string }
): asserts r is { ok: true } {
  if (!r.ok) {
    throw new RadiusPushError(r.reason);
  }
}

export async function loadSubscriberForRadius(
  pool: Pool,
  tenantId: string,
  subscriberId: string
): Promise<SubscriberRow | null> {
  if (!config.dmaMode && (await hasTable(pool, "subscribers"))) {
    const [legacy] = await pool.query<SubscriberRow[]>(
      `SELECT id, username, status, package_id, ip_address, mac_address, pool, radius_password_encrypted, expiration_date
       FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [subscriberId, tenantId]
    );
    if (legacy[0]) return legacy[0];
  }
  if (!(await hasTable(pool, "rm_users"))) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT username,
            CASE WHEN enableuser = 1 THEN 'active' ELSE 'disabled' END AS status,
            CAST(srvid AS CHAR) AS package_id,
            NULLIF(TRIM(staticipcpe), '') AS ip_address,
            NULLIF(TRIM(mac), '') AS mac_address,
            NULL AS pool,
            CAST(NULL AS BINARY) AS radius_password_encrypted,
            expiration AS expiration_date
     FROM rm_users WHERE username = ? LIMIT 1`,
    [subscriberId]
  );
  const r = rows[0];
  if (!r) return null;
  const u = String(r.username ?? "");
  return {
    id: u,
    username: u,
    status: String(r.status ?? "disabled"),
    package_id: r.package_id != null ? String(r.package_id) : null,
    ip_address: r.ip_address != null ? String(r.ip_address) : null,
    mac_address: r.mac_address != null ? String(r.mac_address) : null,
    pool: r.pool != null ? String(r.pool) : null,
    radius_password_encrypted: null,
    expiration_date: r.expiration_date as Date | string,
  } as SubscriberRow;
}

export async function pushRadiusForSubscriber(
  pool: Pool,
  radius: RadiusService,
  tenantId: string,
  subscriberId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sub = await loadSubscriberForRadius(pool, tenantId, subscriberId);
  if (!sub) return { ok: false, reason: "not_found" };
  if (sub.status !== "active") return { ok: false, reason: "not_active" };
  const exp = new Date(sub.expiration_date as string);
  if (exp.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (!sub.package_id) return { ok: false, reason: "no_package" };
  const pkg = await radius.getPackage(tenantId, sub.package_id);
  if (!pkg) return { ok: false, reason: "invalid_package" };

  let password: string | null = null;
  if (sub.radius_password_encrypted && sub.radius_password_encrypted.length > 0) {
    try {
      password = decryptSecret(Buffer.from(sub.radius_password_encrypted));
    } catch {
      return { ok: false, reason: "decrypt_password_failed" };
    }
  }
  if (!password) {
    password = await radius.getCleartextPassword(sub.username);
  }
  if (!password) return { ok: false, reason: "missing_password" };

  await radius.enableRadiusUser({
    username: sub.username,
    password,
    package: pkg,
    framedIp: sub.ip_address,
    macLock: sub.mac_address,
    framedPool: sub.pool,
    expirationDate: exp,
  });

  return { ok: true };
}

export async function pushRadiusByUsername(
  pool: Pool,
  radius: RadiusService,
  tenantId: string,
  username: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!config.dmaMode && (await hasTable(pool, "subscribers"))) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM subscribers WHERE tenant_id = ? AND username = ? LIMIT 1`,
      [tenantId, username]
    );
    if (rows[0]) {
      return pushRadiusForSubscriber(pool, radius, tenantId, String(rows[0].id));
    }
  }
  if (await hasTable(pool, "rm_users")) {
    const [rm] = await pool.query<RowDataPacket[]>(
      `SELECT username FROM rm_users WHERE username = ? LIMIT 1`,
      [username]
    );
    if (rm[0]) {
      return pushRadiusForSubscriber(pool, radius, tenantId, username);
    }
  }
  return { ok: false, reason: "not_found" };
}
