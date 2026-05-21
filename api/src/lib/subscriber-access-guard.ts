/**
 * Central rules for whether a subscriber may receive RADIUS credentials or portal access.
 * All checks are application-side complements to FreeRADIUS (radcheck / Auth-Type Reject).
 */

import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasTable, hasColumn } from "../db/schemaGuards.js";
import { isSubscriptionExpiredByCalendarDate } from "./expiration-date.js";

export type SubscriberAccessRow = {
  tenant_status: string | null;
  subscriber_status: string | null;
  expiration_date: Date | string | null;
  package_id: string | null;
  package_active: number | boolean | string | null;
  quota_total_bytes: bigint | number | string | null;
  used_bytes: bigint | number | string | null;
  overdue_invoices: number | string | null;
};

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normStatus(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Pure evaluation used by API routes, RADIUS sync, and unit tests (no I/O).
 */
export function evaluateSubscriberAccessFromRow(
  r: SubscriberAccessRow
): { ok: true } | { ok: false; reason: string } {
  if (normStatus(r.tenant_status) !== "active") {
    return { ok: false, reason: "tenant_inactive" };
  }
  const st = normStatus(r.subscriber_status);
  if (st !== "active") {
    return { ok: false, reason: "subscriber_not_active" };
  }
  if (r.expiration_date != null && String(r.expiration_date).trim() !== "") {
    const exp = new Date(r.expiration_date as string);
    if (Number.isNaN(exp.getTime())) {
      return { ok: false, reason: "invalid_expiration" };
    }
    if (isSubscriptionExpiredByCalendarDate(r.expiration_date)) {
      return { ok: false, reason: "expired" };
    }
  }
  if (!r.package_id) {
    return { ok: false, reason: "no_package" };
  }
  const pa = r.package_active;
  const active =
    pa === true ||
    pa === 1 ||
    pa === "1" ||
    String(pa ?? "").toLowerCase() === "true";
  if (!active) {
    return { ok: false, reason: "package_inactive" };
  }
  const quotaTotal = num(r.quota_total_bytes);
  const used = num(r.used_bytes);
  if (quotaTotal > 0 && used >= quotaTotal) {
    return { ok: false, reason: "quota_exceeded" };
  }
  if (num(r.overdue_invoices) > 0) {
    return { ok: false, reason: "overdue_invoices" };
  }
  return { ok: true };
}

export type LoadedSubscriberAccess = SubscriberAccessRow & {
  id: string;
  username: string;
  tenant_id: string;
  credential_password: string | null;
  ip_address: string | null;
  pool: string | null;
  package_simultaneous_use: number | null;
  mikrotik_rate_limit: string | null;
  framed_ip_address: string | null;
  mikrotik_address_list: string | null;
  default_framed_pool: string | null;
  nas_server_id: string | null;
  /** Package JSON whitelist; null when column absent or unrestricted. */
  package_allowed_nas_ids: unknown;
};

export async function loadSubscriberAccessRow(
  pool: Pool,
  opts: { tenantId?: string; subscriberId?: string; username?: string }
): Promise<LoadedSubscriberAccess | null> {
  if (!(await hasTable(pool, "subscribers"))) return null;
  const tenantId = opts.tenantId?.trim();
  const hasInvoices = await hasTable(pool, "invoices");
  const overdueSql = hasInvoices
    ? `(SELECT COUNT(*) FROM invoices i
        WHERE i.tenant_id = s.tenant_id AND i.subscriber_id = s.id
          AND i.status = 'sent' AND i.due_date < CURDATE())`
    : `0`;
  const pkgNasSelect = (await hasColumn(pool, "packages", "allowed_nas_ids"))
    ? "p.allowed_nas_ids AS package_allowed_nas_ids"
    : "CAST(NULL AS JSON) AS package_allowed_nas_ids";
  const nasColSelect = (await hasColumn(pool, "subscribers", "nas_server_id"))
    ? "s.nas_server_id"
    : "CAST(NULL AS CHAR(36)) AS nas_server_id";

  let sql = `SELECT s.id, s.tenant_id, s.username, s.status AS subscriber_status, s.expiration_date,
       s.package_id, s.used_bytes, s.pool, ${nasColSelect},
       sc.password AS credential_password,
       (SELECT ip_address FROM subscriber_static_ips WHERE subscriber_id = s.id LIMIT 1) AS ip_address,
       t.status AS tenant_status,
       p.active AS package_active, p.quota_total_bytes,
       p.simultaneous_use AS package_simultaneous_use,
       p.mikrotik_rate_limit, p.framed_ip_address, p.mikrotik_address_list, p.default_framed_pool,
       ${pkgNasSelect},
       ${overdueSql} AS overdue_invoices
     FROM subscribers s
     INNER JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN subscriber_credentials sc ON sc.subscriber_id = s.id AND sc.tenant_id = s.tenant_id
     LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     WHERE `;
  const params: unknown[] = [];
  if (opts.subscriberId) {
    sql += `s.id = ?`;
    params.push(opts.subscriberId);
    if (tenantId) {
      sql += ` AND s.tenant_id = ?`;
      params.push(tenantId);
    }
  } else if (opts.username) {
    sql += `s.username = ?`;
    params.push(opts.username);
    if (tenantId) {
      sql += ` AND s.tenant_id = ?`;
      params.push(tenantId);
    }
  } else {
    return null;
  }
  sql += ` LIMIT 1`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    username: String(row.username ?? ""),
    tenant_status: row.tenant_status != null ? String(row.tenant_status) : null,
    subscriber_status: row.subscriber_status != null ? String(row.subscriber_status) : null,
    expiration_date: row.expiration_date ?? null,
    package_id: row.package_id != null ? String(row.package_id) : null,
    package_active: row.package_active ?? null,
    quota_total_bytes: row.quota_total_bytes ?? null,
    used_bytes: row.used_bytes ?? null,
    overdue_invoices: row.overdue_invoices ?? 0,
    credential_password: row.credential_password != null ? String(row.credential_password) : null,
    ip_address: row.ip_address != null ? String(row.ip_address) : null,
    pool: row.pool != null ? String(row.pool) : null,
    package_simultaneous_use:
      row.package_simultaneous_use != null ? Number(row.package_simultaneous_use) : null,
    mikrotik_rate_limit: row.mikrotik_rate_limit != null ? String(row.mikrotik_rate_limit) : null,
    framed_ip_address: row.framed_ip_address != null ? String(row.framed_ip_address) : null,
    mikrotik_address_list: row.mikrotik_address_list != null ? String(row.mikrotik_address_list) : null,
    default_framed_pool: row.default_framed_pool != null ? String(row.default_framed_pool) : null,
    nas_server_id: row.nas_server_id != null ? String(row.nas_server_id) : null,
    package_allowed_nas_ids: row.package_allowed_nas_ids ?? null,
  };
}
