import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { RadiusService } from "../services/radius.service.js";
import { decryptSecret } from "../services/crypto.service.js";

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

export async function loadSubscriberForRadius(
  pool: Pool,
  tenantId: string,
  subscriberId: string
): Promise<SubscriberRow | null> {
  const [rows] = await pool.query<SubscriberRow[]>(
    `SELECT id, username, status, package_id, ip_address, mac_address, pool, radius_password_encrypted, expiration_date
     FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [subscriberId, tenantId]
  );
  return rows[0] ?? null;
}

/**
 * Recreates RADIUS rows when subscriber is active, not expired, and has password material.
 * Password: encrypted column first, else current radcheck Cleartext-Password.
 */
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
  });

  return { ok: true };
}
