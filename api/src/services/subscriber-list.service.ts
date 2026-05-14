import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasColumn, hasTable } from "../db/schemaGuards.js";

export type SubscriberListFilters = {
  q?: string;
  status_filter?: "all" | "active" | "expired" | "disabled";
  package_id?: string;
  nas_server_id?: string;
  region_id?: string;
  customer_id?: string;
  expiry_from?: string;
  expiry_to?: string;
  quota_status?: "all" | "ok" | "exhausted";
  debt_status?: "all" | "overdue" | "clean";
};

export type SubscriberListSort = {
  sort_key: string;
  sort_dir: "asc" | "desc";
  page: number;
  per_page: number;
};

const SORT_COLS: Record<string, string> = {
  username: "s.username",
  full_name: "COALESCE(NULLIF(TRIM(CONCAT(COALESCE(s.first_name,''),' ',COALESCE(s.last_name,''))),''), s.nickname, s.username)",
  phone: "s.phone",
  status: "s.status",
  package_name: "p.name",
  nas_network: "nd.name",
  region_name: "reg.name",
  created_by: "s.username",
  created_at: "s.created_at",
  start_date: "s.created_at",
  expiration_date: "s.expiration_date",
};

function clampPage(n: number): number {
  return Math.max(1, Math.min(10_000, n));
}

function clampPerPage(n: number): number {
  return Math.max(1, Math.min(500, n));
}

export type SubscriberStats = {
  active: number;
  expired: number;
  quota_finished: number;
  suspended: number;
  online_now: number;
  unpaid_balance_subscribers: number;
};

export async function computeSubscriberStats(pool: Pool, tenantId: string): Promise<SubscriberStats> {
  const out: SubscriberStats = {
    active: 0,
    expired: 0,
    quota_finished: 0,
    suspended: 0,
    online_now: 0,
    unpaid_balance_subscribers: 0,
  };
  if (!(await hasTable(pool, "subscribers"))) return out;

  const hasRadacct = await hasTable(pool, "radacct");
  const hasAcctUpd = hasRadacct && (await hasColumn(pool, "radacct", "acctupdatetime"));
  const activeSess = hasRadacct
    ? hasAcctUpd
      ? `r.acctstoptime IS NULL AND COALESCE(r.acctupdatetime, r.acctstarttime) > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
      : `r.acctstoptime IS NULL AND r.acctstarttime > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
    : "0";

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN s.status = 'active' AND (s.expiration_date IS NULL OR s.expiration_date >= NOW()) THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN s.status = 'expired' OR (s.expiration_date IS NOT NULL AND s.expiration_date < NOW()) THEN 1 ELSE 0 END) AS expired,
       SUM(CASE WHEN COALESCE(p.quota_total_bytes,0) > 0 AND s.used_bytes >= p.quota_total_bytes THEN 1 ELSE 0 END) AS quota_finished,
       SUM(CASE WHEN s.status IN ('suspended','disabled','inactive') THEN 1 ELSE 0 END) AS suspended,
       SUM(CASE WHEN EXISTS (
         SELECT 1 FROM radacct r
         INNER JOIN subscribers sx ON sx.username = r.username AND sx.tenant_id = s.tenant_id AND sx.id = s.id
         WHERE ${hasRadacct ? activeSess : "0"}
       ) THEN 1 ELSE 0 END) AS online_now,
       SUM(CASE WHEN EXISTS (
         SELECT 1 FROM invoices i
         WHERE i.tenant_id = s.tenant_id AND i.subscriber_id = s.id
           AND LOWER(i.status) = 'sent' AND i.due_date < CURDATE()
       ) THEN 1 ELSE 0 END) AS unpaid_balance_subscribers
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     WHERE s.tenant_id = ?`,
    [tenantId]
  );
  const r = rows[0] ?? {};
  out.active = Number(r.active ?? 0);
  out.expired = Number(r.expired ?? 0);
  out.quota_finished = Number(r.quota_finished ?? 0);
  out.suspended = Number(r.suspended ?? 0);
  out.online_now = Number(r.online_now ?? 0);
  out.unpaid_balance_subscribers = Number(r.unpaid_balance_subscribers ?? 0);
  return out;
}

export async function querySubscribersList(
  pool: Pool,
  tenantId: string,
  filters: SubscriberListFilters,
  sort: SubscriberListSort
): Promise<{ rows: RowDataPacket[]; total: number }> {
  if (!(await hasTable(pool, "subscribers"))) return { rows: [], total: 0 };
  const withNas =
    (await hasColumn(pool, "subscribers", "nas_server_id")) && (await hasTable(pool, "nas_devices"));
  const hasRegions = (await hasColumn(pool, "subscribers", "region_id")) && (await hasTable(pool, "subscriber_regions"));
  const hasRadacct = await hasTable(pool, "radacct");
  const hasPost = await hasTable(pool, "radpostauth");
  const hasInvoices = await hasTable(pool, "invoices");

  const nasJoin = withNas ? "LEFT JOIN nas_devices nd ON nd.id = s.nas_server_id AND nd.tenant_id = s.tenant_id" : "";
  const nasSelect = withNas ? ", nd.id AS nas_server_id, nd.name AS nas_name, nd.ip AS nas_ip" : "";
  const regJoin = hasRegions
    ? "LEFT JOIN subscriber_regions reg ON reg.id = s.region_id AND reg.tenant_id = s.tenant_id"
    : "";
  const regSelect = hasRegions ? ", reg.name AS region_name" : ", NULL AS region_name";

  const activeSessWhere =
    hasRadacct && (await hasColumn(pool, "radacct", "acctupdatetime"))
      ? `r2.acctstoptime IS NULL AND COALESCE(r2.acctupdatetime, r2.acctstarttime) > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
      : hasRadacct
        ? `r2.acctstoptime IS NULL AND r2.acctstarttime > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
        : "0";

  const onlineExpr = hasRadacct
    ? `(SELECT COUNT(*) FROM radacct r2 WHERE r2.username = s.username AND ${activeSessWhere})`
    : "0";

  const lastLoginExpr = hasPost
    ? `(SELECT MAX(authdate) FROM radpostauth ra WHERE ra.username = s.username)`
    : "NULL";

  const debtExpr = hasInvoices
    ? `(SELECT COALESCE(SUM(
         GREATEST(0,
           CAST(i.amount AS DECIMAL(14,2))
           - COALESCE((SELECT SUM(py.amount) FROM payments py WHERE py.invoice_id = i.id AND py.tenant_id = i.tenant_id), 0)
         )
       ), 0)
       FROM invoices i
       WHERE i.tenant_id = s.tenant_id AND i.subscriber_id = s.id AND LOWER(i.status) <> 'paid')`
    : "0";

  const overdueExpr = hasInvoices
    ? `(SELECT COUNT(*) FROM invoices i
        WHERE i.tenant_id = s.tenant_id AND i.subscriber_id = s.id
          AND LOWER(i.status) = 'sent' AND i.due_date < CURDATE())`
    : "0";

  const where: string[] = ["s.tenant_id = ?"];
  const params: unknown[] = [tenantId];

  const q = (filters.q ?? "").trim();
  if (q) {
    where.push(
      `(s.username LIKE ? OR s.phone LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR s.nickname LIKE ? OR c.display_name LIKE ?)`
    );
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    params.push(like, like, like, like, like, like);
  }

  const sf = filters.status_filter ?? "all";
  if (sf === "active") {
    where.push(`s.status = 'active' AND (s.expiration_date IS NULL OR s.expiration_date >= NOW())`);
  } else if (sf === "expired") {
    where.push(`(s.status = 'expired' OR (s.expiration_date IS NOT NULL AND s.expiration_date < NOW()))`);
  } else if (sf === "disabled") {
    where.push(`s.status IN ('disabled','suspended','inactive','blocked')`);
  }

  if (filters.package_id) {
    where.push("s.package_id = ?");
    params.push(filters.package_id);
  }
  if (filters.nas_server_id && withNas) {
    where.push("s.nas_server_id = ?");
    params.push(filters.nas_server_id);
  }
  if (filters.region_id && hasRegions) {
    where.push("s.region_id = ?");
    params.push(filters.region_id);
  }
  if (filters.customer_id) {
    where.push("s.customer_id = ?");
    params.push(filters.customer_id);
  }
  if (filters.expiry_from) {
    where.push("s.expiration_date IS NOT NULL AND s.expiration_date >= ?");
    params.push(filters.expiry_from);
  }
  if (filters.expiry_to) {
    where.push("s.expiration_date IS NOT NULL AND s.expiration_date < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(filters.expiry_to);
  }

  const qs = filters.quota_status ?? "all";
  if (qs === "ok") {
    where.push("(COALESCE(p.quota_total_bytes,0) = 0 OR s.used_bytes < p.quota_total_bytes)");
  } else if (qs === "exhausted") {
    where.push("COALESCE(p.quota_total_bytes,0) > 0 AND s.used_bytes >= p.quota_total_bytes");
  }

  const ds = filters.debt_status ?? "all";
  if (ds === "overdue" && hasInvoices) {
    where.push(`${overdueExpr} > 0`);
  } else if (ds === "clean" && hasInvoices) {
    where.push(`${overdueExpr} = 0`);
  }

  const whereSql = where.join(" AND ");
  const [[countRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     LEFT JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
     ${nasJoin}
     ${regJoin}
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countRow?.c ?? 0);

  const sortCol = SORT_COLS[sort.sort_key] ?? SORT_COLS.username!;
  const dir = sort.sort_dir === "desc" ? "DESC" : "ASC";
  const page = clampPage(sort.page);
  const per = clampPerPage(sort.per_page);
  const offset = (page - 1) * per;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.*,
            p.name AS package_name,
            p.quota_total_bytes,
            c.display_name AS customer_name,
            ${onlineExpr} AS active_sessions,
            ${lastLoginExpr} AS last_login,
            ${debtExpr} AS debt_total,
            ${overdueExpr} AS overdue_invoice_count
            ${nasSelect}
            ${regSelect}
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     LEFT JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
     ${nasJoin}
     ${regJoin}
     WHERE ${whereSql}
     ORDER BY ${sortCol} ${dir}, s.id ASC
     LIMIT ${per} OFFSET ${offset}`,
    params
  );

  return { rows, total };
}
