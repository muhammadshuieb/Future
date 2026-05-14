import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { RadiusService } from "../services/radius.service.js";
import { hasTable } from "../db/schemaGuards.js";
import {
  evaluateSubscriberAccessFromRow,
  loadSubscriberAccessRow,
} from "./subscriber-access-guard.js";

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

/** Value for `createRadiusUser` / `enableRadiusUser`: explicit API body wins, else radcheck. */
export async function resolveSimultaneousUseForRadiusRefresh(
  pool: Pool,
  username: string,
  explicit?: number | null
): Promise<number | undefined> {
  if (explicit != null && Number.isFinite(Number(explicit))) {
    return Math.max(1, Math.floor(Number(explicit)));
  }
  if (await hasTable(pool, "radcheck")) {
    const [simRows] = await pool.query<RowDataPacket[]>(
      `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Simultaneous-Use' LIMIT 1`,
      [username]
    );
    const v = Number(simRows[0]?.value);
    if (Number.isFinite(v) && v >= 1) return Math.floor(v);
  }
  return undefined;
}

export async function pushRadiusForSubscriber(
  pool: Pool,
  radius: RadiusService,
  tenantId: string,
  subscriberId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const access = await loadSubscriberAccessRow(pool, { tenantId, subscriberId });
  if (!access) return { ok: false, reason: "not_found" };
  const gate = evaluateSubscriberAccessFromRow(access);
  if (!gate.ok) return gate;
  if (!access.package_id) return { ok: false, reason: "no_package" };

  const pkg = await radius.getPackage(tenantId, access.package_id);
  if (!pkg) return { ok: false, reason: "invalid_package" };

  let password: string | null = access.credential_password != null ? String(access.credential_password) : null;
  if (!password) {
    password = await radius.getCleartextPassword(access.username);
  }
  if (!password) return { ok: false, reason: "missing_password" };

  const preservedSimultaneous = await resolveSimultaneousUseForRadiusRefresh(pool, access.username, null);

  let expirationForRadius: Date | null = null;
  if (access.expiration_date != null && String(access.expiration_date).trim() !== "") {
    expirationForRadius = new Date(access.expiration_date as string);
  }

  await radius.enableRadiusUser({
    username: access.username,
    password,
    package: pkg,
    framedIp: access.ip_address,
    macLock: undefined,
    framedPool: access.pool,
    expirationDate: expirationForRadius,
    simultaneousUse: preservedSimultaneous,
  });

  return { ok: true };
}

export async function pushRadiusByUsername(
  pool: Pool,
  radius: RadiusService,
  tenantId: string,
  username: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!(await hasTable(pool, "subscribers"))) {
    return { ok: false, reason: "not_found" };
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM subscribers WHERE tenant_id = ? AND username = ? LIMIT 1`,
    [tenantId, username]
  );
  if (!rows[0]) {
    return { ok: false, reason: "not_found" };
  }
  return pushRadiusForSubscriber(pool, radius, tenantId, String(rows[0].id));
}
