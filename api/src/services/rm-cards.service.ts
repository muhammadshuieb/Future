import { randomInt, randomUUID } from "crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import {
  applyManagerPrepaidBatchFinancials,
  assertManagerCanPrintCards,
  assertManagerCanSellCards,
} from "./prepaid-batch-finance.service.js";
import { removeRmCardFromRadius, syncRmCardToRadius } from "./rm-card-radius-sync.service.js";
import { terminateExpiredPrepaidCardsManual } from "./prepaid-card-lifecycle.service.js";

type CardRow = RowDataPacket & {
  id: number;
  cardnum: string;
  password: string;
  series: string;
  value: number;
  total_limit_mb: number;
  expiration: string;
  date: string;
  cardtype: number;
  revoked: number;
  active: number;
  package_id: string | null;
  service_name: string | null;
};

const SORT_KEYS = new Set([
  "id",
  "cardnum",
  "series",
  "service_name",
  "value",
  "total_limit_mb",
  "generated_on",
  "valid_till",
  "status",
]);

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function cardStatus(row: {
  active: number;
  revoked: number;
  expiration: string;
  lifecycle_status?: string | null;
}): "active" | "expired" | "disabled" | "consumed" {
  const lifecycle = String(row.lifecycle_status ?? "")
    .trim()
    .toLowerCase();
  if (lifecycle === "consumed") return "consumed";
  if (lifecycle === "expired") return "expired";
  if (lifecycle === "disabled" || Number(row.active ?? 1) === 0 || Number(row.revoked ?? 0) === 1) {
    return "disabled";
  }
  const exp = String(row.expiration ?? "").slice(0, 10);
  if (exp && exp < todayIsoDate()) return "expired";
  return "active";
}

async function syncCardRowToRadius(pool: Pool, row: RowDataPacket): Promise<void> {
  await syncRmCardToRadius(pool, {
    cardnum: String(row.cardnum),
    password: String(row.password),
    expiration: String(row.expiration),
    package_id: row.package_id != null ? String(row.package_id) : null,
    simultaneous_use: Number(row.simultaneous_use ?? 1),
    active: Number(row.active ?? 1),
    revoked: Number(row.revoked ?? 0),
    total_limit_mb: Number(row.total_limit_mb ?? 0),
    download_limit_mb: Number(row.download_limit_mb ?? 0),
    upload_limit_mb: Number(row.upload_limit_mb ?? 0),
    online_time_limit: Number(row.online_time_limit ?? 0),
    lifecycle_status: row.lifecycle_status != null ? String(row.lifecycle_status) : "available",
    terminate_reason: row.terminate_reason != null ? String(row.terminate_reason) : null,
    used_bytes: row.used_bytes ?? 0,
    used_seconds: row.used_seconds ?? 0,
    available_time_from_activation: Number(row.available_time_from_activation ?? 0),
    first_used_at: row.first_used_at ?? null,
  });
}

function randomDigits(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += String(randomInt(0, 10));
  return out;
}

function randomAlphanumeric(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[randomInt(0, chars.length)];
  return out;
}

function mapCardRow(row: CardRow) {
  const status = cardStatus(row);
  const totalMb = Number(row.total_limit_mb ?? 0);
  const usedBytes = Number((row as RowDataPacket).used_bytes ?? 0);
  const quotaBytes = totalMb > 0 ? totalMb * 1024 * 1024 : 0;
  const onlineLimitMin = Number((row as RowDataPacket).online_time_limit ?? 0);
  const usedSeconds = Number((row as RowDataPacket).used_seconds ?? 0);
  return {
    id: Number(row.id),
    cardnum: String(row.cardnum ?? ""),
    password: String(row.password ?? ""),
    series: String(row.series ?? ""),
    value: Number(row.value ?? 0),
    total_limit_mb: totalMb,
    expiration: String(row.expiration ?? "").slice(0, 10),
    date: row.date != null ? String(row.date) : String(row.generated_on ?? "").slice(0, 19),
    cardtype: Number(row.cardtype ?? 0),
    revoked: Number(row.revoked ?? 0),
    active: Number(row.active ?? 1),
    srvid: row.package_id ? 1 : 0,
    package_id: row.package_id != null ? String(row.package_id) : null,
    service_name: row.service_name != null ? String(row.service_name) : "",
    status,
    lifecycle_status: String((row as RowDataPacket).lifecycle_status ?? status),
    used_bytes: String(usedBytes),
    remaining_bytes: quotaBytes > 0 ? String(Math.max(0, quotaBytes - usedBytes)) : null,
    used_seconds: usedSeconds,
    remaining_seconds: onlineLimitMin > 0 ? Math.max(0, onlineLimitMin * 60 - usedSeconds) : null,
    first_used_at:
      (row as RowDataPacket).first_used_at != null ? String((row as RowDataPacket).first_used_at) : null,
    last_used_at: (row as RowDataPacket).last_used_at != null ? String((row as RowDataPacket).last_used_at) : null,
    expired_at: (row as RowDataPacket).expired_at != null ? String((row as RowDataPacket).expired_at) : null,
    finished_at: (row as RowDataPacket).finished_at != null ? String((row as RowDataPacket).finished_at) : null,
    terminate_reason:
      (row as RowDataPacket).terminate_reason != null ? String((row as RowDataPacket).terminate_reason) : null,
    last_disconnect_status:
      (row as RowDataPacket).last_disconnect_status != null
        ? String((row as RowDataPacket).last_disconnect_status)
        : null,
  };
}

export async function ensureRmCardsTable(pool: Pool): Promise<void> {
  if (await hasTable(pool, "rm_cards")) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rm_cards (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tenant_id CHAR(36) NOT NULL,
      series VARCHAR(64) NOT NULL,
      cardnum VARCHAR(64) NOT NULL,
      password VARCHAR(64) NOT NULL,
      card_type TINYINT NOT NULL DEFAULT 0,
      value DECIMAL(14,2) NOT NULL DEFAULT 0,
      package_id CHAR(36) NULL,
      expiration DATE NOT NULL,
      generated_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      download_limit_mb INT NOT NULL DEFAULT 0,
      upload_limit_mb INT NOT NULL DEFAULT 0,
      total_limit_mb INT NOT NULL DEFAULT 0,
      online_time_limit INT NOT NULL DEFAULT 0,
      available_time_from_activation INT NOT NULL DEFAULT 0,
      simultaneous_use INT NOT NULL DEFAULT 1,
      active TINYINT(1) NOT NULL DEFAULT 1,
      revoked TINYINT(1) NOT NULL DEFAULT 0,
      lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'available',
      used_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
      used_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
      first_used_at DATETIME NULL,
      last_used_at DATETIME NULL,
      expired_at DATETIME NULL,
      finished_at DATETIME NULL,
      terminate_reason VARCHAR(64) NULL,
      last_disconnect_status VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_rm_cards_tenant_cardnum (tenant_id, cardnum),
      KEY idx_rm_cards_tenant_series (tenant_id, series),
      KEY idx_rm_cards_tenant_package (tenant_id, package_id),
      KEY idx_rm_cards_tenant_expiration (tenant_id, expiration)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

export async function listRmCardSeries(
  pool: Pool,
  tenantId: string,
  opts: { page: number; perPage: number; sortKey: string; sortDir: "asc" | "desc" }
): Promise<{ items: RowDataPacket[]; total: number }> {
  const sortKey = ["series", "card_type", "generated_on", "valid_till", "gross_card_value", "quantity", "service_name"].includes(
    opts.sortKey
  )
    ? opts.sortKey
    : "generated_on";
  const dir = opts.sortDir === "asc" ? "ASC" : "DESC";
  const orderCol =
    sortKey === "valid_till"
      ? "valid_till"
      : sortKey === "gross_card_value"
        ? "gross_card_value"
        : sortKey === "card_type"
          ? "card_type"
          : sortKey === "quantity"
            ? "quantity"
            : sortKey === "service_name"
              ? "service_name"
              : sortKey === "series"
                ? "series"
                : "generated_on";

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT c.series) AS n FROM rm_cards c WHERE c.tenant_id = ?`,
    [tenantId]
  );
  const total = Number(countRows[0]?.n ?? 0);
  const offset = (opts.page - 1) * opts.perPage;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
        c.series,
        MIN(c.card_type) AS card_type,
        MIN(c.generated_on) AS generated_on,
        MIN(c.expiration) AS valid_till,
        MIN(c.value) AS gross_card_value,
        COUNT(*) AS quantity,
        MAX(p.name) AS service_name,
        MIN(c.download_limit_mb) AS download_limit_mb,
        MIN(c.upload_limit_mb) AS upload_limit_mb,
        MIN(c.total_limit_mb) AS total_traffic_limit_mb,
        MIN(c.online_time_limit) AS online_time_limit,
        MIN(c.available_time_from_activation) AS available_time_from_activation,
        MAX(c.revoked) AS revoked
      FROM rm_cards c
      LEFT JOIN packages p ON p.id = c.package_id AND p.tenant_id = c.tenant_id
      WHERE c.tenant_id = ?
      GROUP BY c.series
      ORDER BY ${orderCol} ${dir}
      LIMIT ? OFFSET ?`,
    [tenantId, opts.perPage, offset]
  );
  return { items: rows, total };
}

export async function listRmCards(
  pool: Pool,
  tenantId: string,
  opts: {
    page: number;
    perPage: number;
    q?: string;
    status?: string;
    serviceId?: string;
    sortKey: string;
    sortDir: "asc" | "desc";
  }
): Promise<{ items: ReturnType<typeof mapCardRow>[]; total: number }> {
  const where = ["c.tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (opts.q?.trim()) {
    where.push("(c.cardnum LIKE ? OR c.series LIKE ? OR c.password LIKE ?)");
    const like = `%${opts.q.trim()}%`;
    params.push(like, like, like);
  }
  if (opts.serviceId?.trim()) {
    where.push("c.package_id = ?");
    params.push(opts.serviceId.trim());
  }
  const hasLifecycle = await hasColumn(pool, "rm_cards", "lifecycle_status");
  if (opts.status === "active") {
    where.push("c.active = 1 AND c.revoked = 0 AND c.expiration >= CURDATE()");
    if (hasLifecycle) where.push("c.lifecycle_status IN ('available', 'active')");
  } else if (opts.status === "expired") {
    if (hasLifecycle) {
      where.push(
        "(c.lifecycle_status IN ('expired','consumed') OR (c.expiration < CURDATE() AND c.active = 1 AND c.revoked = 0))"
      );
    } else {
      where.push("c.expiration < CURDATE() AND c.active = 1 AND c.revoked = 0");
    }
  } else if (opts.status === "consumed" && hasLifecycle) {
    where.push("c.lifecycle_status = 'consumed'");
  } else if (opts.status === "disabled") {
    where.push("(c.active = 0 OR c.revoked = 1)");
  }

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM rm_cards c WHERE ${where.join(" AND ")}`,
    params
  );
  const total = Number(countRows[0]?.n ?? 0);

  const sortKey = SORT_KEYS.has(opts.sortKey) ? opts.sortKey : "generated_on";
  const dir = opts.sortDir === "asc" ? "ASC" : "DESC";
  let orderSql = "c.generated_on DESC";
  if (sortKey === "id") orderSql = `c.id ${dir}`;
  else if (sortKey === "cardnum") orderSql = `c.cardnum ${dir}`;
  else if (sortKey === "series") orderSql = `c.series ${dir}`;
  else if (sortKey === "service_name") orderSql = `p.name ${dir}`;
  else if (sortKey === "value") orderSql = `c.value ${dir}`;
  else if (sortKey === "total_limit_mb") orderSql = `c.total_limit_mb ${dir}`;
  else if (sortKey === "generated_on") orderSql = `c.generated_on ${dir}`;
  else if (sortKey === "valid_till") orderSql = `c.expiration ${dir}`;
  else if (sortKey === "status") orderSql = `c.active ${dir}, c.revoked ${dir}, c.expiration ${dir}`;

  const offset = (opts.page - 1) * opts.perPage;
  const [rows] = await pool.query<CardRow[]>(
    `SELECT c.*, c.generated_on AS date, c.card_type AS cardtype, p.name AS service_name
     FROM rm_cards c
     LEFT JOIN packages p ON p.id = c.package_id AND p.tenant_id = c.tenant_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${orderSql}
     LIMIT ? OFFSET ?`,
    [...params, opts.perPage, offset]
  );
  return { items: rows.map(mapCardRow), total };
}

export async function listCardsBySeries(pool: Pool, tenantId: string, series: string) {
  const [rows] = await pool.query<CardRow[]>(
    `SELECT c.*, c.generated_on AS date, c.card_type AS cardtype, p.name AS service_name
     FROM rm_cards c
     LEFT JOIN packages p ON p.id = c.package_id AND p.tenant_id = c.tenant_id
     WHERE c.tenant_id = ? AND c.series = ?
     ORDER BY c.id ASC`,
    [tenantId, series]
  );
  return rows.map(mapCardRow);
}

export type SqlExecutor = Pool | PoolConnection;

export type RmBatchFinanceContext = {
  role: string;
  sub: string;
  kind: "print" | "sale";
  client_batch_key?: string | null;
};

export async function createRmCardBatch(
  exec: SqlExecutor,
  schemaPool: Pool,
  tenantId: string,
  input: {
    quantity: number;
    card_type: "classic" | "refill";
    gross_card_value: number;
    valid_till: string;
    prefix: string;
    pin_length: number;
    password_length: number;
    package_id: string;
    download_limit_mb: number;
    upload_limit_mb: number;
    total_limit_mb: number;
    online_time_limit: number;
    available_time_from_activation: number;
    simultaneous_use: number;
  },
  finance: RmBatchFinanceContext | null
): Promise<{
  created: number;
  series: string;
  batch_id: string | null;
  ledger_id: string | null;
  syncTasks: Array<{
    cardnum: string;
    password: string;
    expiration: string;
    package_id: string;
    simultaneous_use: number;
    active: number;
    revoked: number;
    total_limit_mb: number;
    download_limit_mb: number;
    upload_limit_mb: number;
    online_time_limit: number;
    available_time_from_activation: number;
    lifecycle_status: string;
  }>;
  idempotent?: boolean;
}> {
  const [pkgRows] = await exec.query<RowDataPacket[]>(
    `SELECT id, currency FROM packages WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [input.package_id, tenantId]
  );
  if (!pkgRows[0]) throw new Error("package_not_found");
  const currency = String(pkgRows[0]?.currency ?? "USD").slice(0, 8).toUpperCase();
  const qty = Math.max(1, Math.min(500, Math.floor(input.quantity)));
  const totalFace = Math.round(qty * Number(input.gross_card_value ?? 0) * 100) / 100;

  const hasPcb = await hasTable(schemaPool, "prepaid_card_batches");
  const hasKeyCol = hasPcb && (await hasColumn(schemaPool, "prepaid_card_batches", "client_batch_key"));
  const keyTrim = finance?.client_batch_key?.trim();
  if (keyTrim && hasKeyCol) {
    const [ex] = await exec.query<RowDataPacket[]>(
      `SELECT id, series, wallet_transaction_id FROM prepaid_card_batches WHERE tenant_id = ? AND client_batch_key = ? LIMIT 1`,
      [tenantId, keyTrim]
    );
    if (ex[0]) {
      const ser = String(ex[0].series ?? "");
      const [cntRows] = await exec.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM rm_cards WHERE tenant_id = ? AND series = ?`,
        [tenantId, ser]
      );
      return {
        created: Number(cntRows[0]?.c ?? 0),
        series: ser,
        batch_id: String(ex[0].id),
        ledger_id: ex[0].wallet_transaction_id != null ? String(ex[0].wallet_transaction_id) : null,
        syncTasks: [],
        idempotent: true,
      };
    }
  }

  const prefix = String(input.prefix ?? "PRE")
    .replace(/[^\w-]/g, "")
    .slice(0, 16) || "PRE";
  const series = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
  const cardType = input.card_type === "refill" ? 1 : 0;
  const existing = new Set<string>();
  const [existingRows] = await exec.query<RowDataPacket[]>(
    `SELECT cardnum FROM rm_cards WHERE tenant_id = ?`,
    [tenantId]
  );
  for (const r of existingRows) existing.add(String(r.cardnum ?? ""));

  const batchId = randomUUID();
  let ledgerId: string | null = null;
  const conn = exec as PoolConnection;
  const isManager = Boolean(finance && finance.role === "manager");

  if (isManager && totalFace > 0) {
    if (finance!.kind === "sale") {
      await assertManagerCanSellCards(conn, tenantId, finance!.sub);
    } else {
      await assertManagerCanPrintCards(conn, tenantId, finance!.sub);
    }
    const rFin = await applyManagerPrepaidBatchFinancials(
      conn,
      schemaPool,
      tenantId,
      finance!.sub,
      input.package_id,
      totalFace,
      currency,
      batchId,
      finance!.sub
    );
    ledgerId = rFin.ledger_id || null;
  }

  if (hasPcb) {
    const hasSeriesCol = await hasColumn(schemaPool, "prepaid_card_batches", "series");
    const hasClientKeyCol = await hasColumn(schemaPool, "prepaid_card_batches", "client_batch_key");
    const kindStr = finance?.kind === "sale" ? "sale" : "print";
    const printedBy = finance?.sub ?? null;
    if (hasSeriesCol && hasClientKeyCol) {
      await exec.execute(
        `INSERT INTO prepaid_card_batches (id, tenant_id, batch_total_amount, currency, printed_by, wallet_transaction_id, kind, series, client_batch_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [batchId, tenantId, totalFace, currency, printedBy, ledgerId, kindStr, series, keyTrim || null]
      );
    } else {
      await exec.execute(
        `INSERT INTO prepaid_card_batches (id, tenant_id, batch_total_amount, currency, printed_by, wallet_transaction_id, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [batchId, tenantId, totalFace, currency, printedBy, ledgerId, kindStr]
      );
    }
  }

  const hasItems = await hasTable(schemaPool, "prepaid_card_batch_items");
  const hasDedup = await hasTable(schemaPool, "prepaid_card_batch_dedup");

  const syncTasks: Array<{
    cardnum: string;
    password: string;
    expiration: string;
    package_id: string;
    simultaneous_use: number;
    active: number;
    revoked: number;
    total_limit_mb: number;
    download_limit_mb: number;
    upload_limit_mb: number;
    online_time_limit: number;
    available_time_from_activation: number;
    lifecycle_status: string;
  }> = [];

  let created = 0;
  for (let i = 0; i < qty; i++) {
    let cardnum = "";
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = `${prefix}${randomDigits(input.pin_length)}`.slice(0, 64);
      if (!existing.has(candidate)) {
        cardnum = candidate;
        existing.add(candidate);
        break;
      }
    }
    if (!cardnum) throw new Error("cardnum_generation_failed");
    const password = randomAlphanumeric(input.password_length);
    const [res] = await exec.execute(
      `INSERT INTO rm_cards
        (tenant_id, series, cardnum, password, card_type, value, package_id, expiration,
         download_limit_mb, upload_limit_mb, total_limit_mb, online_time_limit,
         available_time_from_activation, simultaneous_use, active, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [
        tenantId,
        series,
        cardnum,
        password,
        cardType,
        input.gross_card_value,
        input.package_id,
        input.valid_till,
        input.download_limit_mb,
        input.upload_limit_mb,
        input.total_limit_mb,
        input.online_time_limit,
        input.available_time_from_activation,
        input.simultaneous_use,
      ]
    );
    const insertId = Number((res as { insertId?: number }).insertId ?? 0);
    if (hasItems && hasPcb && insertId > 0) {
      await exec.execute(
        `INSERT INTO prepaid_card_batch_items (batch_id, rm_card_id, card_value) VALUES (?, ?, ?)`,
        [batchId, insertId, input.gross_card_value]
      );
    }
    if (hasDedup && insertId > 0) {
      await exec.execute(
        `INSERT INTO prepaid_card_batch_dedup (tenant_id, rm_card_id, batch_id) VALUES (?, ?, ?)`,
        [tenantId, insertId, batchId]
      );
    }
    syncTasks.push({
      cardnum,
      password,
      expiration: input.valid_till,
      package_id: input.package_id,
      simultaneous_use: input.simultaneous_use,
      active: 1,
      revoked: 0,
      total_limit_mb: input.total_limit_mb,
      download_limit_mb: input.download_limit_mb,
      upload_limit_mb: input.upload_limit_mb,
      online_time_limit: input.online_time_limit,
      available_time_from_activation: input.available_time_from_activation,
      lifecycle_status: "available",
    });
    created += 1;
  }
  return {
    created,
    series,
    batch_id: hasPcb ? batchId : null,
    ledger_id: ledgerId,
    syncTasks,
  };
}

export async function getRmCardStats(pool: Pool, tenantId: string, cardId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT cardnum, total_limit_mb FROM rm_cards WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [cardId, tenantId]
  );
  const row = rows[0];
  if (!row) return null;
  const username = String(row.cardnum ?? "");
  const totalLimitMb = Number(row.total_limit_mb ?? 0);

  let usageBytes = 0;
  let dailyBytes = 0;
  let monthlyBytes = 0;
  const sessions: Array<{
    radacctid: string;
    start_time: string | null;
    stop_time: string | null;
    online_seconds: number;
    total_bytes: string;
    nas_ip: string | null;
    is_active: boolean;
  }> = [];

  const [usageRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(acctinputoctets + acctoutputoctets), 0) AS total
     FROM radacct WHERE username = ?`,
    [username]
  );
  usageBytes = Number(usageRows[0]?.total ?? 0);

  const [dailyRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(acctinputoctets + acctoutputoctets), 0) AS total
     FROM radacct WHERE username = ? AND DATE(acctstarttime) = CURDATE()`,
    [username]
  );
  dailyBytes = Number(dailyRows[0]?.total ?? 0);

  const [monthlyRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(acctinputoctets + acctoutputoctets), 0) AS total
     FROM radacct
     WHERE username = ? AND acctstarttime >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
    [username]
  );
  monthlyBytes = Number(monthlyRows[0]?.total ?? 0);

  const [sessRows] = await pool.query<RowDataPacket[]>(
    `SELECT radacctid, acctstarttime, acctstoptime, acctsessiontime,
            (acctinputoctets + acctoutputoctets) AS total_bytes, nasipaddress,
            (acctstoptime IS NULL) AS is_active
     FROM radacct
     WHERE username = ?
     ORDER BY acctstarttime DESC
     LIMIT 20`,
    [username]
  );
  for (const s of sessRows) {
    sessions.push({
      radacctid: String(s.radacctid ?? ""),
      start_time: s.acctstarttime != null ? String(s.acctstarttime) : null,
      stop_time: s.acctstoptime != null ? String(s.acctstoptime) : null,
      online_seconds: Number(s.acctsessiontime ?? 0),
      total_bytes: String(s.total_bytes ?? 0),
      nas_ip: s.nasipaddress != null ? String(s.nasipaddress) : null,
      is_active: Boolean(s.is_active),
    });
  }

  const [cardRows] = await pool.query<RowDataPacket[]>(
    `SELECT used_bytes, used_seconds, total_limit_mb, online_time_limit,
            first_used_at, last_used_at, expiration, expired_at, finished_at,
            terminate_reason, last_disconnect_status, lifecycle_status
     FROM rm_cards WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [cardId, tenantId]
  );
  const meta = cardRows[0];
  const usedB = Number(meta?.used_bytes ?? usageBytes);
  const quotaB = Number(meta?.total_limit_mb ?? totalLimitMb) * 1024 * 1024;
  const onlineMin = Number(meta?.online_time_limit ?? 0);
  const usedSec = Number(meta?.used_seconds ?? 0);

  return {
    total_limit_mb: totalLimitMb,
    usage_bytes: String(usedB),
    remaining_bytes: quotaB > 0 ? String(Math.max(0, quotaB - usedB)) : null,
    used_seconds: usedSec,
    remaining_seconds: onlineMin > 0 ? Math.max(0, onlineMin * 60 - usedSec) : null,
    first_used_at: meta?.first_used_at != null ? String(meta.first_used_at) : null,
    expires_at: meta?.expiration != null ? String(meta.expiration).slice(0, 10) : null,
    expired_at: meta?.expired_at != null ? String(meta.expired_at) : null,
    finished_at: meta?.finished_at != null ? String(meta.finished_at) : null,
    terminate_reason: meta?.terminate_reason != null ? String(meta.terminate_reason) : null,
    last_disconnect_status:
      meta?.last_disconnect_status != null ? String(meta.last_disconnect_status) : null,
    lifecycle_status: meta?.lifecycle_status != null ? String(meta.lifecycle_status) : null,
    daily_total_bytes: String(dailyBytes),
    monthly_total_bytes: String(monthlyBytes),
    sessions,
  };
}

async function loadCardForSync(pool: Pool, tenantId: string, cardId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM rm_cards WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [cardId, tenantId]
  );
  return rows[0] ?? null;
}

export async function updateRmCard(
  pool: Pool,
  tenantId: string,
  cardId: number,
  patch: {
    password?: string;
    value?: number;
    expiration?: string;
    package_id?: string | null;
    active?: number;
    revoked?: number;
  }
): Promise<boolean> {
  const row = await loadCardForSync(pool, tenantId, cardId);
  if (!row) return false;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.password !== undefined) {
    sets.push("password = ?");
    vals.push(patch.password);
  }
  if (patch.value !== undefined) {
    sets.push("value = ?");
    vals.push(patch.value);
  }
  if (patch.expiration !== undefined) {
    sets.push("expiration = ?");
    vals.push(patch.expiration);
  }
  if (patch.package_id !== undefined) {
    sets.push("package_id = ?");
    vals.push(patch.package_id);
  }
  if (patch.active !== undefined) {
    sets.push("active = ?");
    vals.push(patch.active);
  }
  if (patch.revoked !== undefined) {
    sets.push("revoked = ?");
    vals.push(patch.revoked);
  }
  if (!sets.length) return true;
  await pool.execute(`UPDATE rm_cards SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, [
    ...vals,
    cardId,
    tenantId,
  ] as Array<string | number | null>);
  const updated = await loadCardForSync(pool, tenantId, cardId);
  if (updated) {
    await syncCardRowToRadius(pool, updated);
  }
  return true;
}

export async function setRmCardEnabled(pool: Pool, tenantId: string, cardId: number, enabled: boolean): Promise<boolean> {
  return updateRmCard(pool, tenantId, cardId, { active: enabled ? 1 : 0, revoked: enabled ? 0 : 1 });
}

export async function deleteRmCard(pool: Pool, tenantId: string, cardId: number): Promise<boolean> {
  const row = await loadCardForSync(pool, tenantId, cardId);
  if (!row) return false;
  await pool.execute(`DELETE FROM rm_cards WHERE id = ? AND tenant_id = ?`, [cardId, tenantId]);
  await removeRmCardFromRadius(pool, String(row.cardnum));
  return true;
}

export async function deleteRmCardSeries(pool: Pool, tenantId: string, series: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, cardnum FROM rm_cards WHERE tenant_id = ? AND series = ?`,
    [tenantId, series]
  );
  if (!rows.length) return 0;
  await pool.execute(`DELETE FROM rm_cards WHERE tenant_id = ? AND series = ?`, [tenantId, series]);
  for (const r of rows) {
    await removeRmCardFromRadius(pool, String(r.cardnum));
  }
  return rows.length;
}

export async function deleteExpiredRmCards(
  pool: Pool,
  tenantId: string,
  opts?: { coa?: import("./coa.service.js").CoaService; radius?: import("./radius.service.js").RadiusService }
): Promise<number> {
  if (opts?.coa && opts?.radius) {
    return terminateExpiredPrepaidCardsManual(pool, tenantId, opts.coa, opts.radius);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, cardnum FROM rm_cards
     WHERE tenant_id = ? AND expiration < CURDATE() AND lifecycle_status IN ('available', 'active')`,
    [tenantId]
  );
  if (!rows.length) return 0;
  await pool.execute(
    `UPDATE rm_cards
     SET lifecycle_status = 'expired', active = 0, terminate_reason = 'calendar_expired', finished_at = NOW()
     WHERE tenant_id = ? AND expiration < CURDATE() AND lifecycle_status IN ('available', 'active')`,
    [tenantId]
  );
  for (const r of rows) {
    const full = await loadCardForSync(pool, tenantId, Number(r.id));
    if (full) await syncCardRowToRadius(pool, full);
  }
  return rows.length;
}

export async function bulkDeleteRmCards(
  pool: Pool,
  tenantId: string,
  input: { ids?: number[]; all_matching?: boolean; q?: string; status?: string; service_id?: number | string; exclude_ids?: number[] }
): Promise<number> {
  if (input.all_matching) {
    const where = ["tenant_id = ?"];
    const params: unknown[] = [tenantId];
    if (input.q?.trim()) {
      where.push("(cardnum LIKE ? OR series LIKE ?)");
      const like = `%${input.q.trim()}%`;
      params.push(like, like);
    }
    if (input.service_id != null && String(input.service_id).trim()) {
      where.push("package_id = ?");
      params.push(String(input.service_id));
    }
    if (input.status === "disabled") where.push("(active = 0 OR revoked = 1)");
    else if (input.status === "expired") where.push("expiration < CURDATE() AND active = 1 AND revoked = 0");
    else if (input.status === "active") where.push("active = 1 AND revoked = 0 AND expiration >= CURDATE()");
    const exclude = (input.exclude_ids ?? []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (exclude.length) {
      where.push(`id NOT IN (${exclude.map(() => "?").join(",")})`);
      params.push(...exclude);
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, cardnum FROM rm_cards WHERE ${where.join(" AND ")}`,
      params
    );
    if (!rows.length) return 0;
    const ids = rows.map((r) => Number(r.id));
    await pool.execute(`DELETE FROM rm_cards WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    for (const r of rows) await removeRmCardFromRadius(pool, String(r.cardnum));
    return rows.length;
  }
  const ids = (input.ids ?? []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  if (!ids.length) return 0;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, cardnum FROM rm_cards WHERE tenant_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    [tenantId, ...ids]
  );
  await pool.execute(`DELETE FROM rm_cards WHERE tenant_id = ? AND id IN (${ids.map(() => "?").join(",")})`, [
    tenantId,
    ...ids,
  ]);
  for (const r of rows) await removeRmCardFromRadius(pool, String(r.cardnum));
  return rows.length;
}
