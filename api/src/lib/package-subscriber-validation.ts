import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasColumn } from "../db/schemaGuards.js";
import {
  managerAllowedForPackage,
  packageNasWhitelistIsUnrestricted,
  subscriberNasAllowedForPackage,
} from "./package-access-scope.js";

export async function tenantNasDeviceIds(pool: Pool, tenantId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM nas_devices WHERE tenant_id = ?`,
    [tenantId]
  );
  return rows.map((r) => String(r.id));
}

export async function assertSubscriberFitsPackageNas(
  pool: Pool,
  tenantId: string,
  packageId: string | null | undefined,
  nasServerId: string | null | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!packageId) return { ok: true };
  if (!(await hasColumn(pool, "packages", "allowed_nas_ids"))) return { ok: true };
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT allowed_nas_ids FROM packages WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [packageId, tenantId]
  );
  if (!rows[0]) return { ok: false, error: "package_not_found" };
  const allowedNas = rows[0].allowed_nas_ids;
  const tenantNasIds = await tenantNasDeviceIds(pool, tenantId);
  if (packageNasWhitelistIsUnrestricted(allowedNas, tenantNasIds)) {
    return { ok: true };
  }
  if (!subscriberNasAllowedForPackage(nasServerId, allowedNas, tenantNasIds)) {
    return { ok: false, error: "subscriber_nas_not_in_package_allowed_list" };
  }
  return { ok: true };
}

export async function assertStaffCanAssignPackage(
  pool: Pool,
  tenantId: string,
  staffRole: string | undefined,
  staffUserId: string | undefined,
  packageId: string | null | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!packageId) return { ok: true };
  if (staffRole !== "manager") return { ok: true };
  if (!(await hasColumn(pool, "packages", "available_manager_user_ids"))) return { ok: true };
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT available_manager_user_ids FROM packages WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [packageId, tenantId]
  );
  if (!rows[0]) return { ok: false, error: "package_not_found" };
  if (!managerAllowedForPackage(staffRole, staffUserId, rows[0].available_manager_user_ids)) {
    return { ok: false, error: "manager_not_allowed_for_package" };
  }
  return { ok: true };
}
