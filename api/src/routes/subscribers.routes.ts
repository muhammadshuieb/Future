import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import {
  getTableColumns,
  hasTable,
  hasColumn,
  invalidateColumnCache,
  isRadiusManagerSubscribersPrimary,
} from "../db/schemaGuards.js";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import { RadiusService } from "../services/radius.service.js";
import { encryptSecret } from "../services/crypto.service.js";
import { sendNewSubscriberWhatsApp } from "../services/whatsapp.service.js";
import { emitEvent } from "../events/eventBus.js";
import { Events } from "../events/eventTypes.js";
import { defaultExpirationNoonFromNow, extendSubscriptionByDaysNoon } from "../lib/billing.js";
import { assertRadiusPush, pushRadiusForSubscriber } from "../lib/subscriber-radius.js";
import { CoaService } from "../services/coa.service.js";
import { AccountingService } from "../services/accounting.service.js";
import { getSystemSettings } from "../services/system-settings.service.js";
import {
  chargeManagerWallet,
  chargeManagerWalletWithConnection,
  ManagerBalanceError,
} from "../services/manager-wallet.service.js";
import { withTransaction } from "../db/transaction.js";
import { writeAuditLog } from "../services/audit-log.service.js";
import type { RowDataPacket } from "mysql2";
import { resolveSubscriberState } from "../lib/subscriber-state.js";
import { insertRmUserRow } from "../lib/rm-users-insert.js";

const router = Router();
const radius = new RadiusService(pool);
const accounting = new AccountingService(pool);
const coa = new CoaService(pool);

router.use(requireAuth);

/** Portal `subscribers` row storage is active (not empty-table + rm_users–only mode). */
async function usePortalSubscribersData(tenantId: string): Promise<boolean> {
  return (await hasTable(pool, "subscribers")) && !(await isRadiusManagerSubscribersPrimary(pool, tenantId));
}

/** Subscriber `id` is UUID in legacy mode, or `rm_users.username` in Radius Manager–only databases. */
async function resolveUsernameForSubscriberId(tenantId: string, id: string): Promise<string | null> {
  if (await usePortalSubscribersData(tenantId)) {
    const [subs] = await pool.query<RowDataPacket[]>(
      `SELECT username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, tenantId]
    );
    if (subs[0]?.username != null && String(subs[0].username).trim()) {
      return String(subs[0].username);
    }
  }
  if (await hasTable(pool, "rm_users")) {
    const [rm] = await pool.query<RowDataPacket[]>(
      `SELECT username FROM rm_users WHERE username = ? LIMIT 1`,
      [id]
    );
    if (rm[0]?.username != null && String(rm[0].username).trim()) {
      return String(rm[0].username);
    }
  }
  return null;
}

async function disconnectBySystemPolicy(
  tenantId: string,
  username: string,
  mode: "activation" | "update"
): Promise<void> {
  try {
    const settings = await getSystemSettings(tenantId);
    const enabled =
      mode === "activation" ? settings.disconnect_on_activation : settings.disconnect_on_update;
    if (!enabled) return;
  } catch (error) {
    // Keep behavior safe-by-default when settings cannot be read.
    console.warn("[subscribers] settings read failed, using default disconnect=true", error);
  }
  try {
    const rep = await coa.disconnectAllSessions(username, tenantId);
    if (rep && !rep.anyOk) {
      console.warn(`[subscribers] ${mode}: disconnect incomplete for ${username}`);
    }
  } catch (error) {
    console.error(`[subscribers] ${mode}: coa disconnect failed for ${username}`, error);
  }
}

function pickExistingColumns(cols: Set<string>, names: string[]): string[] {
  return names.filter((name) => cols.has(name));
}

function toSafeBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.max(0, Math.trunc(value)));
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value.trim());
    } catch {
      return 0n;
    }
  }
  return 0n;
}

async function deleteSubscriberData(tenantId: string, subscriberId: string, username: string): Promise<void> {
  const tableNames = [
    "subscribers",
    "invoices",
    "user_usage_live",
    "user_usage_daily",
    "radcheck",
    "radreply",
    "radusergroup",
    "radacct",
    "radpostauth",
    "rm_users",
  ] as const;
  const available = new Map<string, boolean>();
  await Promise.all(
    tableNames.map(async (name) => {
      available.set(name, await hasTable(pool, name));
    })
  );
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (available.get("invoices")) {
      await conn.execute(`DELETE FROM invoices WHERE subscriber_id = ? AND tenant_id = ?`, [subscriberId, tenantId]);
    }
    if (available.get("user_usage_live")) {
      await conn.execute(`DELETE FROM user_usage_live WHERE tenant_id = ? AND username = ?`, [tenantId, username]);
    }
    if (available.get("user_usage_daily")) {
      await conn.execute(`DELETE FROM user_usage_daily WHERE tenant_id = ? AND username = ?`, [tenantId, username]);
    }
    if (available.get("radcheck")) {
      await conn.execute(`DELETE FROM radcheck WHERE username = ?`, [username]);
    }
    if (available.get("radreply")) {
      await conn.execute(`DELETE FROM radreply WHERE username = ?`, [username]);
    }
    if (available.get("radusergroup")) {
      await conn.execute(`DELETE FROM radusergroup WHERE username = ?`, [username]);
    }
    if (available.get("radacct")) {
      await conn.execute(`DELETE FROM radacct WHERE username = ?`, [username]);
    }
    if (available.get("radpostauth")) {
      await conn.execute(`DELETE FROM radpostauth WHERE username = ?`, [username]);
    }
    if (available.get("rm_users")) {
      await conn.execute(`DELETE FROM rm_users WHERE username = ?`, [username]);
    }
    if (available.get("subscribers")) {
      await conn.execute(`DELETE FROM subscribers WHERE id = ? AND tenant_id = ?`, [
        subscriberId,
        tenantId,
      ]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

const subscribersQuerySchema = z.object({
  q: z.string().trim().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(500).default(25),
  sort_key: z
    .enum([
      "username",
      "full_name",
      "phone",
      "status",
      "package_name",
      "nas_network",
      "region_name",
      "created_by",
      "created_at",
      "start_date",
      "expiration_date",
    ])
    .default("username"),
  sort_dir: z.enum(["asc", "desc"]).default("asc"),
  account_type: z.enum(["all", "subscriptions", "cards"]).default("subscriptions"),
  status_filter: z.enum(["all", "active", "expired", "disabled"]).default("all"),
});

router.get("/", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req, res) => {
  const tenant = req.auth!.tenantId;
  const queryParsed = subscribersQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  const q = queryParsed.data.q ? queryParsed.data.q.trim() : "";
  const page = queryParsed.data.page;
  const perPage = queryParsed.data.per_page;
  const sortKey = queryParsed.data.sort_key;
  const sortDir = queryParsed.data.sort_dir.toUpperCase() === "DESC" ? "DESC" : "ASC";
  const accountType = queryParsed.data.account_type;
  const statusFilter = queryParsed.data.status_filter;
  const offset = (page - 1) * perPage;
  const activeSessionFreshMinutes = (() => {
    const fromMinutes = Number.parseInt(process.env.ACTIVE_SESSION_FRESH_MINUTES ?? "", 10);
    if (Number.isFinite(fromMinutes) && fromMinutes > 0) {
      return Math.max(1, Math.min(24 * 60 * 30, fromMinutes));
    }
    const fromHours = Number.parseInt(process.env.ACTIVE_SESSION_FRESH_HOURS ?? "1", 10) || 1;
    return Math.max(1, Math.min(24 * 60 * 30, fromHours * 60));
  })();
  try {
    if (await isRadiusManagerSubscribersPrimary(pool, tenant)) {
      const hasSvc = await hasTable(pool, "rm_services");
      const svcCols = hasSvc ? await getTableColumns(pool, "rm_services") : new Set<string>();
      const hasRadacctTbl = await hasTable(pool, "radacct");
      const where: string[] = ["1=1"];
      const paramsRm: unknown[] = [];
      if (q) {
        const like = `%${q}%`;
        where.push(
          `(u.username LIKE ? OR u.firstname LIKE ? OR u.lastname LIKE ? OR u.phone LIKE ? OR u.mobile LIKE ? OR u.email LIKE ? OR u.comment LIKE ? OR u.address LIKE ?)`
        );
        for (let i = 0; i < 8; i++) paramsRm.push(like);
      }
      // Prepaid cards are managed in rm_cards pages, never in /users list.
      where.push("u.acctype <> 1");
      if (hasSvc && svcCols.has("srvtype")) {
        // Extra guard: some legacy rows can be card accounts with wrong acctype.
        where.push("COALESCE(svc.srvtype, 0) <> 1");
      }
      if (await hasTable(pool, "rm_cards")) {
        where.push("NOT EXISTS (SELECT 1 FROM rm_cards c WHERE BINARY c.cardnum = BINARY u.username)");
      }
      if (statusFilter === "active") {
        where.push("u.enableuser = 1 AND u.expiration >= CURDATE()");
      } else if (statusFilter === "expired") {
        where.push("u.expiration < CURDATE()");
      } else if (statusFilter === "disabled") {
        // Disabled is manual stop (not date expiration).
        where.push("u.enableuser = 0 AND u.expiration >= CURDATE()");
      }
      const sortExprByKey: Record<string, string> = {
        username: "u.username",
        full_name: "CONCAT(COALESCE(u.firstname,''),COALESCE(u.lastname,''),u.username)",
        phone: "COALESCE(NULLIF(TRIM(u.phone), ''), NULLIF(TRIM(u.mobile), ''), '')",
        status: "u.enableuser",
        package_name: hasSvc ? "svc.srvname" : "CAST(u.srvid AS CHAR)",
        nas_network: "u.username",
        region_name: "u.username",
        created_by: "u.owner",
        created_at: "u.createdon",
        start_date: "u.createdon",
        expiration_date: "u.expiration",
      };
      const sortExpr = sortExprByKey[sortKey] ?? "u.username";
      const joinSvc = hasSvc ? "LEFT JOIN rm_services svc ON svc.srvid = u.srvid" : "";
      const selectParts = [
        "u.username AS id",
        "u.username",
        "CASE WHEN u.expiration < CURDATE() THEN 'expired' WHEN u.enableuser = 1 THEN 'active' ELSE 'disabled' END AS status",
        "CAST(u.srvid AS CHAR) AS package_id",
        hasSvc ? "svc.srvname AS package_name" : "CAST(u.srvid AS CHAR) AS package_name",
        "NULL AS nas_server_id",
        "NULL AS nas_name",
        "NULL AS nas_ip",
        "u.createdon AS created_at",
        "u.createdon AS start_date",
        "u.expiration AS expiration_date",
        "NULLIF(TRIM(u.staticipcpe), '') AS ip_address",
        "NULLIF(TRIM(u.mac), '') AS mac_address",
        "NULL AS pool",
        "u.comment AS notes",
        "u.firstname AS first_name",
        "u.lastname AS last_name",
        "NULL AS nickname",
        "COALESCE(NULLIF(TRIM(u.phone), ''), NULLIF(TRIM(u.mobile), '')) AS phone",
        "u.address AS address",
        "NULL AS region_name",
        "0 AS used_bytes",
        "NULL AS quota_total_bytes",
        "NULL AS overdue_invoices_count",
        "0 AS quota_limited_today",
        "u.owner AS creator_name",
        "NULL AS creator_email",
        "CASE WHEN u.acctype = 1 THEN 'card' ELSE 'subscription' END AS account_type",
      ];
      if (hasRadacctTbl) {
        const hasAcctUpdate = await hasColumn(pool, "radacct", "acctupdatetime");
        const activeWhere = hasAcctUpdate
          ? `r_online.acctstoptime IS NULL
             AND (
               (r_online.acctupdatetime IS NOT NULL AND r_online.acctupdatetime >= DATE_SUB(NOW(), INTERVAL ${activeSessionFreshMinutes} MINUTE))
               OR r_online.acctstarttime >= DATE_SUB(NOW(), INTERVAL ${activeSessionFreshMinutes} MINUTE)
             )`
          : `r_online.acctstoptime IS NULL
             AND r_online.acctstarttime >= DATE_SUB(NOW(), INTERVAL ${activeSessionFreshMinutes} MINUTE)`;
        selectParts.push(
          `CASE WHEN EXISTS (
             SELECT 1 FROM radacct r_online
             WHERE BINARY r_online.username = BINARY u.username
               AND ${activeWhere}
             LIMIT 1
           ) THEN 1 ELSE 0 END AS is_online`
        );
      } else {
        selectParts.push("0 AS is_online");
      }
      const fromSql = ` FROM rm_users u ${joinSvc} WHERE ${where.join(" AND ")}`;
      const [countRows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c${fromSql}`, paramsRm);
      const total = Number(countRows[0]?.c ?? 0);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${selectParts.join(", ")}${fromSql} ORDER BY ${sortExpr} ${sortDir} LIMIT ? OFFSET ?`,
        [...paramsRm, perPage, offset]
      );
      const enriched = rows.map((row) => {
        const state = resolveSubscriberState({
          status: String(row.status ?? ""),
          expirationDate: row.expiration_date ? String(row.expiration_date) : null,
          quotaTotalBytes: 0,
          usedBytes: Number(row.used_bytes ?? 0),
          quotaLimitedToday: false,
          overdueInvoicesCount: 0,
        });
        return { ...row, state };
      });
      res.json({ items: enriched, meta: { page, per_page: perPage, total } });
      return;
    }
    if (!(await hasTable(pool, "subscribers"))) {
      res.json({ items: [] });
      return;
    }
    invalidateColumnCache();
    const subCols = await getTableColumns(pool, "subscribers");
    const hasPkgTbl = await hasTable(pool, "packages");
    const hasNasTbl = await hasTable(pool, "nas_servers");
    const hasRmManagersTbl = await hasTable(pool, "rm_managers");
    const hasInvoicesTbl = await hasTable(pool, "invoices");
    const hasQuotaStateTbl = await hasTable(pool, "user_quota_state");
    const hasUsageLiveTbl = await hasTable(pool, "user_usage_live");
    const hasRadacctTbl = await hasTable(pool, "radacct");
    const hasRegionsTbl = await hasTable(pool, "subscriber_regions");
    const pkgCols = hasPkgTbl ? await getTableColumns(pool, "packages") : new Set<string>();
    const nasCols = hasNasTbl ? await getTableColumns(pool, "nas_servers") : new Set<string>();
    const rmManagerCols = hasRmManagersTbl ? await getTableColumns(pool, "rm_managers") : new Set<string>();
    const usageLiveCols = hasUsageLiveTbl ? await getTableColumns(pool, "user_usage_live") : new Set<string>();
    const radCols = hasRadacctTbl ? await getTableColumns(pool, "radacct") : new Set<string>();
    const joinPkg = hasPkgTbl && subCols.has("package_id") && pkgCols.has("id");
    const joinNas = hasNasTbl && subCols.has("nas_server_id") && nasCols.has("id");
    const joinCreator = hasRmManagersTbl && subCols.has("created_by") && rmManagerCols.has("managername");
    const joinReg = hasRegionsTbl && subCols.has("region_id");
    const joinUsageLive =
      hasUsageLiveTbl &&
      subCols.has("username") &&
      usageLiveCols.has("tenant_id") &&
      usageLiveCols.has("username") &&
      usageLiveCols.has("total_bytes");
    const canJoinRadUsage =
      hasRadacctTbl &&
      subCols.has("username") &&
      radCols.has("username") &&
      (radCols.has("acctinputoctets") || radCols.has("acctoutputoctets"));
    const ruInputOctetsExpr = radCols.has("acctinputoctets")
      ? "SUM(COALESCE(acctinputoctets,0))"
      : "0";
    const ruOutputOctetsExpr = radCols.has("acctoutputoctets")
      ? "SUM(COALESCE(acctoutputoctets,0))"
      : "0";
    const ruInputGwExpr = radCols.has("acctinputgigawords")
      ? "SUM(COALESCE(acctinputgigawords,0))"
      : "0";
    const ruOutputGwExpr = radCols.has("acctoutputgigawords")
      ? "SUM(COALESCE(acctoutputgigawords,0))"
      : "0";
    const safeSubCols = pickExistingColumns(subCols, [
      "id",
      "tenant_id",
      "username",
      "status",
      "package_id",
      "nas_server_id",
      "start_date",
      "expiration_date",
      "created_at",
      "created_by",
      "first_name",
      "last_name",
      "nickname",
      "phone",
      "address",
      "region_id",
      "notes",
      "ip_address",
      "mac_address",
      "pool",
    ]);
    const selectParts = safeSubCols.map((name) => `s.${name}`);
    if (subCols.has("used_bytes")) {
      const radInput =
        (radCols.has("acctinputoctets") ? "COALESCE(ru.sum_input_octets,0)" : "0") +
        (radCols.has("acctinputgigawords") ? " + COALESCE(ru.sum_input_gw,0) * 4294967296" : "");
      const radOutput =
        (radCols.has("acctoutputoctets") ? "COALESCE(ru.sum_output_octets,0)" : "0") +
        (radCols.has("acctoutputgigawords") ? " + COALESCE(ru.sum_output_gw,0) * 4294967296" : "");
      /**
       * لا نربط قائمة المشتركين بـ subquery على radacct بالكامل (GROUP BY username):
       * بعد استعادة dump كبير يصبح ذلك مسحًا كاملًا لكل COUNT/LIST ويثقل MySQL لساعات.
       * عند وجود user_usage_live نعتمد uul + subscribers.used_bytes (يحدّثهما worker).
       */
      if (joinUsageLive) {
        selectParts.push(`COALESCE(uul.total_bytes, s.used_bytes) AS used_bytes`);
      } else if (canJoinRadUsage) {
        selectParts.push(`COALESCE(((${radInput}) + (${radOutput})), s.used_bytes) AS used_bytes`);
      } else {
        selectParts.push(`s.used_bytes AS used_bytes`);
      }
    }
    if (joinPkg && pkgCols.has("name")) selectParts.push(`p.name AS package_name`);
    if (joinPkg && pkgCols.has("quota_total_bytes")) selectParts.push(`p.quota_total_bytes AS quota_total_bytes`);
    if (hasInvoicesTbl) selectParts.push(`COALESCE(ov.overdue_count, 0) AS overdue_invoices_count`);
    if (hasQuotaStateTbl) selectParts.push(`CASE WHEN qs.username IS NULL THEN 0 ELSE 1 END AS quota_limited_today`);
    if (joinNas && nasCols.has("name")) selectParts.push(`n.name AS nas_name`);
    if (joinNas && nasCols.has("ip")) selectParts.push(`n.ip AS nas_ip`);
    if (joinCreator) {
      selectParts.push(`rmc.managername AS creator_name`);
      selectParts.push(`rmc.email AS creator_email`);
    }
    if (hasRadacctTbl && subCols.has("username")) {
      const hasAcctUpdate = await hasColumn(pool, "radacct", "acctupdatetime");
      const activeWhere = hasAcctUpdate
        ? `r_online.acctstoptime IS NULL
           AND (
             (r_online.acctupdatetime IS NOT NULL AND r_online.acctupdatetime >= DATE_SUB(NOW(), INTERVAL ${activeSessionFreshMinutes} MINUTE))
             OR r_online.acctstarttime >= DATE_SUB(NOW(), INTERVAL ${activeSessionFreshMinutes} MINUTE)
           )`
        : `r_online.acctstoptime IS NULL
           AND r_online.acctstarttime >= DATE_SUB(NOW(), INTERVAL ${activeSessionFreshMinutes} MINUTE)`;
      selectParts.push(
        `CASE WHEN EXISTS (
          SELECT 1 FROM radacct r_online
          WHERE BINARY r_online.username = BINARY s.username
            AND ${activeWhere}
          LIMIT 1
        ) THEN 1 ELSE 0 END AS is_online`
      );
    }
    if (joinReg) {
      selectParts.push(`reg.name AS region_name`);
    }
    if (selectParts.length === 0) {
      res.json({ items: [] });
      return;
    }
    const joins: string[] = [];
    if (joinPkg) joins.push(`LEFT JOIN packages p ON p.id = s.package_id`);
    if (joinNas) joins.push(`LEFT JOIN nas_servers n ON n.id = s.nas_server_id`);
    if (joinCreator) {
      joins.push(
        `LEFT JOIN rm_managers rmc
         ON BINARY rmc.managername = BINARY CASE
             WHEN s.created_by LIKE 'rm:%' THEN SUBSTRING(s.created_by, 4)
             ELSE s.created_by
           END`
      );
    }
    if (joinReg) {
      joins.push(
        `LEFT JOIN subscriber_regions reg ON reg.id = s.region_id AND reg.tenant_id = s.tenant_id`
      );
    }
    if (joinUsageLive) {
      joins.push(
        `LEFT JOIN user_usage_live uul
         ON uul.tenant_id = s.tenant_id
        AND BINARY uul.username = BINARY s.username`
      );
    }
    if (canJoinRadUsage && !joinUsageLive) {
      joins.push(
        `LEFT JOIN (
           SELECT
             username,
             ${ruInputOctetsExpr} AS sum_input_octets,
             ${ruOutputOctetsExpr} AS sum_output_octets,
             ${ruInputGwExpr} AS sum_input_gw,
             ${ruOutputGwExpr} AS sum_output_gw
           FROM radacct
           GROUP BY username
         ) ru ON BINARY ru.username = BINARY s.username`
      );
    }
    if (hasInvoicesTbl) {
      // فواتير «صادرة» فقط: مسودة draft / ملغاة void لا تمنع الاشتراك (وإلا ينقلب الجميع إلى BLOCKED عند توليد مسودات جماعيّة)
      joins.push(
        `LEFT JOIN (
          SELECT tenant_id, subscriber_id, COUNT(*) AS overdue_count
          FROM invoices
          WHERE status = 'sent' AND due_date < CURDATE()
          GROUP BY tenant_id, subscriber_id
        ) ov ON ov.tenant_id = s.tenant_id AND ov.subscriber_id = s.id`
      );
    }
    if (hasQuotaStateTbl) {
      joins.push(
        `LEFT JOIN user_quota_state qs
         ON qs.tenant_id = s.tenant_id
        AND BINARY qs.username = BINARY s.username
        AND qs.quota_date = CURDATE()`
      );
    }
    const where: string[] = [`s.tenant_id = ?`];
    const params: unknown[] = [tenant];
    if (statusFilter === "active") {
      where.push(`COALESCE(s.status, 'active') = 'active' AND (s.expiration_date IS NULL OR s.expiration_date >= CURDATE())`);
    } else if (statusFilter === "expired") {
      where.push(`s.expiration_date IS NOT NULL AND s.expiration_date < CURDATE()`);
    } else if (statusFilter === "disabled") {
      where.push(`LOWER(TRIM(COALESCE(s.status, ''))) = 'disabled'`);
    }
    if (subCols.has("account_type")) {
      // Keep /users page strictly for subscription accounts.
      where.push(`COALESCE(s.account_type, 'subscription') <> 'card'`);
    }
    if (joinPkg && pkgCols.has("account_type")) {
      where.push(`LOWER(TRIM(COALESCE(p.account_type, 'subscriptions'))) NOT IN ('card','cards')`);
    }
    if (await hasTable(pool, "rm_cards") && subCols.has("username")) {
      where.push(`NOT EXISTS (SELECT 1 FROM rm_cards c WHERE BINARY c.cardnum = BINARY s.username)`);
    }
    if (q) {
      const like = `%${q}%`;
      const searchParts: string[] = [];
      if (subCols.has("username")) searchParts.push(`s.username LIKE ?`);
      if (subCols.has("first_name")) searchParts.push(`s.first_name LIKE ?`);
      if (subCols.has("last_name")) searchParts.push(`s.last_name LIKE ?`);
      if (subCols.has("nickname")) searchParts.push(`s.nickname LIKE ?`);
      if (subCols.has("phone")) searchParts.push(`s.phone LIKE ?`);
      if (joinPkg && pkgCols.has("name")) searchParts.push(`p.name LIKE ?`);
      if (joinNas && nasCols.has("name")) searchParts.push(`n.name LIKE ?`);
      if (joinNas && nasCols.has("ip")) searchParts.push(`n.ip LIKE ?`);
      if (joinCreator) searchParts.push(`rmc.managername LIKE ?`);
      if (joinCreator && rmManagerCols.has("email")) searchParts.push(`rmc.email LIKE ?`);
      if (joinReg) searchParts.push(`reg.name LIKE ?`);
      if (searchParts.length) {
        where.push(`(${searchParts.join(" OR ")})`);
        for (let i = 0; i < searchParts.length; i++) params.push(like);
      }
    }

    const sortExprByKey: Record<string, string> = {
      username: subCols.has("username") ? "s.username" : "s.id",
      full_name:
        subCols.has("first_name") && subCols.has("last_name")
          ? "CONCAT(COALESCE(s.first_name,''),' ',COALESCE(s.last_name,''),COALESCE(s.nickname,''))"
          : subCols.has("nickname")
            ? "s.nickname"
            : "s.username",
      phone: subCols.has("phone") ? "s.phone" : "s.username",
      status: subCols.has("status") ? "s.status" : "s.username",
      package_name: joinPkg && pkgCols.has("name") ? "p.name" : "s.username",
      nas_network: joinNas && nasCols.has("name") ? "n.name" : joinNas && nasCols.has("ip") ? "n.ip" : "s.username",
      region_name: joinReg ? "reg.name" : "s.username",
      created_by: joinCreator ? "rmc.managername" : "s.username",
      created_at: subCols.has("created_at") ? "s.created_at" : "s.username",
      start_date: subCols.has("start_date") ? "s.start_date" : "s.username",
      expiration_date: subCols.has("expiration_date") ? "s.expiration_date" : "s.username",
    };
    const sortExpr = sortExprByKey[sortKey] ?? (subCols.has("username") ? "s.username" : "s.id");

    const fromSql = ` FROM subscribers s ${joins.join(" ")} WHERE ${where.join(" AND ")}`;
    const [countRows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c${fromSql}`, params);
    const total = Number(countRows[0]?.c ?? 0);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ${selectParts.join(", ")}${fromSql} ORDER BY ${sortExpr} ${sortDir} LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );
    const enriched = rows.map((row) => {
      const state = resolveSubscriberState({
        status: String(row.status ?? ""),
        expirationDate: row.expiration_date ? String(row.expiration_date) : null,
        quotaTotalBytes: Number(row.quota_total_bytes ?? 0),
        usedBytes: Number(row.used_bytes ?? 0),
        quotaLimitedToday: Number(row.quota_limited_today ?? 0) > 0,
        overdueInvoicesCount: Number(row.overdue_invoices_count ?? 0),
      });
      return { ...row, state };
    });
    res.json({ items: enriched, meta: { page, per_page: perPage, total } });
  } catch (e) {
    console.error("subscribers GET", e);
    res.status(500).json({
      error: "db_error",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

router.get(
  "/:id/password",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req: Request, res: Response) => {
    const tenant = req.auth!.tenantId;
    let username: string | undefined;
    if (await usePortalSubscribersData(tenant)) {
      const [subs] = await pool.query<RowDataPacket[]>(
        `SELECT username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [req.params.id, tenant]
      );
      username = subs[0]?.username != null ? String(subs[0].username) : undefined;
    }
    if (!username && (await hasTable(pool, "rm_users"))) {
      const [rm] = await pool.query<RowDataPacket[]>(
        `SELECT username FROM rm_users WHERE username = ? LIMIT 1`,
        [req.params.id]
      );
      username = rm[0]?.username != null ? String(rm[0].username) : undefined;
    }
    if (!username) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const password = await radius.getCleartextPassword(username);
    if (!password) {
      res.status(404).json({ error: "password_unavailable" });
      return;
    }
    res.json({ password });
  }
);

const createBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1),
  /** Legacy UUID packages row, or Radius Manager `rm_services.srvid` as decimal string. */
  package_id: z.string().min(1).max(64),
  expiration_date: z.string().optional(),
  start_date: z.string().optional(),
  first_name: z.string().max(128).optional(),
  last_name: z.string().max(128).optional(),
  nickname: z.string().max(128).optional(),
  phone: z.string().max(32).optional(),
  address: z.string().max(255).optional(),
  notes: z.string().optional(),
  ip_address: z.string().optional(),
  mac_address: z.string().optional(),
  pool: z.string().optional(),
  nas_server_id: z.string().uuid().nullable().optional(),
  region_id: z.string().uuid().nullable().optional(),
});

const createSubscriberHandler = async (req: Request, res: Response) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const tenant = req.auth!.tenantId;
  const staff = req.auth!.sub;
  const {
    username,
    password,
    package_id,
    first_name,
    last_name,
    nickname,
    phone,
    address,
    notes,
    ip_address,
    mac_address,
    pool: poolName,
    nas_server_id,
    region_id,
  } = parsed.data;
  const expiration_date = parsed.data.expiration_date
    ? new Date(parsed.data.expiration_date)
    : defaultExpirationNoonFromNow(30);
  const start_date = parsed.data.start_date ? new Date(parsed.data.start_date) : new Date();
  const pkg = await radius.getPackage(tenant, package_id);
  if (!pkg) {
    res.status(400).json({ error: "invalid_package" });
    return;
  }
  if (region_id) {
    if (await hasTable(pool, "subscriber_regions")) {
      const [reg] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM subscriber_regions WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [region_id, tenant]
      );
      if (!reg[0]) {
        res.status(400).json({ error: "invalid_region" });
        return;
      }
    }
  }
  await radius.createRadiusUser({
    username,
    password,
    package: pkg,
    framedIp: ip_address ?? null,
    macLock: mac_address ?? null,
    framedPool: poolName ?? null,
    expirationDate: expiration_date,
  });
  invalidateColumnCache();
  let subscriberIdForEvents: string;
  if (await usePortalSubscribersData(tenant)) {
    const id = randomUUID();
    const enc = encryptSecret(password);
    const subCol = await getTableColumns(pool, "subscribers");
    const fields: string[] = [];
    const vals: (string | number | Buffer | Date | null)[] = [];
    const push = (f: string, v: string | number | Buffer | Date | null) => {
      if (subCol.has(f)) {
        fields.push(f);
        vals.push(v);
      }
    };
    push("id", id);
    push("tenant_id", tenant);
    push("username", username);
    push("status", "active");
    push("package_id", package_id);
    push("expiration_date", expiration_date);
    push("start_date", start_date);
    push("created_by", staff);
    push("first_name", first_name ?? null);
    push("last_name", last_name ?? null);
    push("nickname", nickname ?? null);
    push("phone", phone ?? null);
    push("address", address ?? null);
    push("region_id", region_id ?? null);
    push("notes", notes ?? null);
    push("ip_address", ip_address ?? null);
    push("mac_address", mac_address ?? null);
    push("pool", poolName ?? null);
    push("nas_server_id", nas_server_id ?? null);
    push("radius_password_encrypted", enc);
    if (fields.length < 3) {
      res.status(500).json({
        error: "subscribers_schema",
        detail: "subscribers table is missing required columns",
      });
      return;
    }
    await pool.execute(
      `INSERT INTO subscribers (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
      vals as (string | number | Buffer | Date | null)[]
    );
    subscriberIdForEvents = id;
    try {
      const [pkgRows] = await pool.query<RowDataPacket[]>(
        `SELECT name, mikrotik_rate_limit FROM packages WHERE tenant_id = ? AND id = ? LIMIT 1`,
        [tenant, package_id]
      );
      const info = pkgRows[0] ?? {};
      await sendNewSubscriberWhatsApp({
        tenantId: tenant,
        subscriberId: id,
        phone,
        username,
        fullName: [first_name, last_name].filter(Boolean).join(" ").trim() || username,
        password,
        packageName: String(info.name ?? ""),
        speed: String(info.mikrotik_rate_limit ?? pkg.mikrotik_rate_limit ?? ""),
        expirationDate: expiration_date,
      });
    } catch (e) {
      console.warn("whatsapp new subscriber notification failed", e);
    }
  } else {
    const srvid = parseInt(String(package_id).trim(), 10);
    if (!Number.isFinite(srvid)) {
      res.status(400).json({ error: "invalid_package" });
      return;
    }
    try {
      await insertRmUserRow(pool, {
        username,
        cleartextPassword: password,
        srvid,
        expiration: expiration_date,
        firstname: first_name,
        lastname: last_name,
        phone,
        address,
        mac: mac_address,
        comment: notes ?? "",
        staticipcpe: ip_address,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (String(msg).toLowerCase().includes("duplicate")) {
        res.status(409).json({ error: "username_taken" });
        return;
      }
      console.error("rm_users insert failed", e);
      res.status(500).json({ error: "db_error", detail: msg });
      return;
    }
    subscriberIdForEvents = username;
    let pkgLabel = "";
    if (await hasTable(pool, "rm_services")) {
      const [pn] = await pool.query<RowDataPacket[]>(
        `SELECT srvname FROM rm_services WHERE srvid = ? LIMIT 1`,
        [srvid]
      );
      pkgLabel = String(pn[0]?.srvname ?? "");
    }
    try {
      await sendNewSubscriberWhatsApp({
        tenantId: tenant,
        subscriberId: subscriberIdForEvents,
        phone,
        username,
        fullName: [first_name, last_name].filter(Boolean).join(" ").trim() || username,
        password,
        packageName: pkgLabel,
        speed: String(pkg.mikrotik_rate_limit ?? ""),
        expirationDate: expiration_date,
      });
    } catch (e) {
      console.warn("whatsapp new subscriber notification failed", e);
    }
  }
  await writeAuditLog(pool, {
    tenantId: tenant,
    staffId: staff,
    action: "create",
    entityType: "subscriber",
    entityId: subscriberIdForEvents,
    payload: { username, package_id },
  });
  await emitEvent(Events.USER_CREATED, {
    tenantId: tenant,
    subscriberId: subscriberIdForEvents,
    username,
  }).catch(() => {});
  res.status(201).json({ id: subscriberIdForEvents, username });
};

router.post(
  "/",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  createSubscriberHandler
);

/** Spec alias: POST /api/subscribers/create */
router.post(
  "/create",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  createSubscriberHandler
);

const bulkBody = z.object({
  items: z
    .array(
      z.object({
        username: z.string().min(1).max(64),
        password: z.string().min(1),
        package_id: z.string().min(1).max(64),
        account_type: z.enum(["subscription", "card"]).optional(),
        ip_address: z.string().optional(),
        mac_address: z.string().optional(),
        pool: z.string().optional(),
        nas_server_id: z.string().uuid().nullable().optional(),
      })
    )
    .min(1)
    .max(500),
});

router.post(
  "/bulk",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsed = bulkBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const tenant = req.auth!.tenantId;
    const staff = req.auth!.sub;
    const created: { id: string; username: string }[] = [];
    const errors: { username: string; error: string }[] = [];
    invalidateColumnCache();
    const useSubscribersBulk = await usePortalSubscribersData(tenant);
    const subColBulk = useSubscribersBulk ? await getTableColumns(pool, "subscribers") : null;
    for (const item of parsed.data.items) {
      try {
        const pkg = await radius.getPackage(tenant, item.package_id);
        if (!pkg) {
          errors.push({ username: item.username, error: "invalid_package" });
          continue;
        }
        const exp = defaultExpirationNoonFromNow(30);
        await radius.createRadiusUser({
          username: item.username,
          password: item.password,
          package: pkg,
          framedIp: item.ip_address ?? null,
          macLock: item.mac_address ?? null,
          framedPool: item.pool ?? null,
          expirationDate: exp,
        });
        if (useSubscribersBulk && subColBulk) {
          const id = randomUUID();
          const enc = encryptSecret(item.password);
          const fields: string[] = [];
          const vals: (string | number | Buffer | Date | null)[] = [];
          const push = (f: string, v: string | number | Buffer | Date | null) => {
            if (subColBulk.has(f)) {
              fields.push(f);
              vals.push(v);
            }
          };
          push("id", id);
          push("tenant_id", tenant);
          push("username", item.username);
          push("status", "active");
          push("account_type", item.account_type === "card" ? "card" : "subscription");
          push("package_id", item.package_id);
          push("expiration_date", exp);
          push("start_date", new Date());
          push("created_by", staff);
          push("ip_address", item.ip_address ?? null);
          push("mac_address", item.mac_address ?? null);
          push("pool", item.pool ?? null);
          push("nas_server_id", item.nas_server_id ?? null);
          push("radius_password_encrypted", enc);
          if (fields.length < 3) {
            errors.push({ username: item.username, error: "subscribers_schema" });
            continue;
          }
          await pool.execute(
            `INSERT INTO subscribers (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
            vals
          );
          try {
            const [pkgRows] = await pool.query<RowDataPacket[]>(
              `SELECT name, mikrotik_rate_limit FROM packages WHERE tenant_id = ? AND id = ? LIMIT 1`,
              [tenant, item.package_id]
            );
            const info = pkgRows[0] ?? {};
            await sendNewSubscriberWhatsApp({
              tenantId: tenant,
              subscriberId: id,
              phone: null,
              username: item.username,
              password: item.password,
              packageName: String(info.name ?? ""),
              speed: String(info.mikrotik_rate_limit ?? pkg.mikrotik_rate_limit ?? ""),
              expirationDate: exp,
            });
          } catch (e) {
            console.warn("whatsapp bulk new subscriber notification failed", e);
          }
          created.push({ id, username: item.username });
        } else {
          const srvid = parseInt(String(item.package_id).trim(), 10);
          if (!Number.isFinite(srvid)) {
            errors.push({ username: item.username, error: "invalid_package" });
            continue;
          }
          await insertRmUserRow(pool, {
            username: item.username,
            cleartextPassword: item.password,
            srvid,
            expiration: exp,
            accountType: item.account_type === "card" ? "card" : "subscription",
            mac: item.mac_address,
            staticipcpe: item.ip_address,
            comment: "",
          });
          created.push({ id: item.username, username: item.username });
        }
      } catch (e) {
        errors.push({ username: item.username, error: String(e) });
      }
    }
    res.status(201).json({ created, errors });
  }
);

router.post(
  "/import-csv",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const raw = typeof req.body?.csv === "string" ? req.body.csv : null;
    if (!raw || !raw.trim()) {
      res.status(400).json({ error: "expected_json_csv_field" });
      return;
    }
    const lines = raw.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      res.status(400).json({ error: "csv_empty" });
      return;
    }
    const tenant = req.auth!.tenantId;
    const staff = req.auth!.sub;
    const created: { id: string; username: string }[] = [];
    const errors: { line: number; error: string }[] = [];
    invalidateColumnCache();
    const useSubscribersCsv = await usePortalSubscribersData(tenant);
    const subColCsv = useSubscribersCsv ? await getTableColumns(pool, "subscribers") : null;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c: string) => c.trim());
      const [username, password, package_id, ip_address, mac_address, poolCsv] = cols;
      if (!username || !password || !package_id) {
        errors.push({ line: i + 1, error: "missing_columns" });
        continue;
      }
      try {
        const pkg = await radius.getPackage(tenant, package_id);
        if (!pkg) {
          errors.push({ line: i + 1, error: "invalid_package" });
          continue;
        }
        const exp = defaultExpirationNoonFromNow(30);
        await radius.createRadiusUser({
          username,
          password,
          package: pkg,
          framedIp: ip_address || null,
          macLock: mac_address || null,
          framedPool: poolCsv || null,
          expirationDate: exp,
        });
        if (useSubscribersCsv && subColCsv) {
          const id = randomUUID();
          const enc = encryptSecret(password);
          const fields: string[] = [];
          const vals: (string | number | Buffer | Date | null)[] = [];
          const push = (f: string, v: string | number | Buffer | Date | null) => {
            if (subColCsv.has(f)) {
              fields.push(f);
              vals.push(v);
            }
          };
          push("id", id);
          push("tenant_id", tenant);
          push("username", username);
          push("status", "active");
          push("package_id", package_id);
          push("expiration_date", exp);
          push("start_date", new Date());
          push("created_by", staff);
          push("ip_address", ip_address || null);
          push("mac_address", mac_address || null);
          push("pool", poolCsv || null);
          push("radius_password_encrypted", enc);
          if (fields.length < 3) {
            errors.push({ line: i + 1, error: "subscribers_schema" });
            continue;
          }
          await pool.execute(
            `INSERT INTO subscribers (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
            vals
          );
          try {
            const [pkgRows] = await pool.query<RowDataPacket[]>(
              `SELECT name, mikrotik_rate_limit FROM packages WHERE tenant_id = ? AND id = ? LIMIT 1`,
              [tenant, package_id]
            );
            const info = pkgRows[0] ?? {};
            await sendNewSubscriberWhatsApp({
              tenantId: tenant,
              subscriberId: id,
              phone: null,
              username,
              password,
              packageName: String(info.name ?? ""),
              speed: String(info.mikrotik_rate_limit ?? pkg.mikrotik_rate_limit ?? ""),
              expirationDate: exp,
            });
          } catch (e) {
            console.warn("whatsapp csv new subscriber notification failed", e);
          }
          created.push({ id, username });
        } else {
          const srvid = parseInt(String(package_id).trim(), 10);
          if (!Number.isFinite(srvid)) {
            errors.push({ line: i + 1, error: "invalid_package" });
            continue;
          }
          await insertRmUserRow(pool, {
            username,
            cleartextPassword: password,
            srvid,
            expiration: exp,
            mac: mac_address,
            staticipcpe: ip_address,
            comment: "",
          });
          created.push({ id: username, username });
        }
      } catch (e) {
        errors.push({ line: i + 1, error: String(e) });
      }
    }
    res.status(201).json({ created, errors });
  }
);

router.get(
  "/:id/usage",
  routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }),
  async (req, res) => {
    const tenant = req.auth!.tenantId;
    const username = await resolveUsernameForSubscriberId(tenant, req.params.id);
    if (!username) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const radacct = await accounting.getUserUsage(username);
    const cached = await accounting.getUsageForUser(tenant, username);
    res.json({
      username,
      bytes: radacct?.bytes.toString() ?? "0",
      gb: radacct?.gb ?? 0,
      cache_total_bytes: cached?.total_bytes.toString() ?? null,
    });
  }
);

router.get(
  "/:id/traffic-report",
  routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }),
  async (req, res) => {
    const trafficQuerySchema = z.object({
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    });
    const queryParsed = trafficQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }
    const fromDate = queryParsed.data.from ?? null;
    const toDate = queryParsed.data.to ?? null;
    if (fromDate && toDate && fromDate > toDate) {
      res.status(400).json({ error: "invalid_range" });
      return;
    }
    const tenant = req.auth!.tenantId;
    const username = await resolveUsernameForSubscriberId(tenant, req.params.id);
    if (!username) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!(await hasTable(pool, "radacct"))) {
      res.json({
        username,
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
        daily: [],
        monthly: [],
        yearly: [],
        sessions: [],
      });
      return;
    }

    const sessionSecondsExpr = `GREATEST(
      COALESCE(acctsessiontime, 0),
      COALESCE(TIMESTAMPDIFF(SECOND, acctstarttime, COALESCE(acctstoptime, NOW())), 0)
    )`;
    const dateWhereParts: string[] = [];
    const dateParams: string[] = [];
    if (fromDate) {
      dateWhereParts.push(`DATE(acctstarttime) >= ?`);
      dateParams.push(fromDate);
    }
    if (toDate) {
      dateWhereParts.push(`DATE(acctstarttime) <= ?`);
      dateParams.push(toDate);
    }
    const dateWhereSql = dateWhereParts.length ? ` AND ${dateWhereParts.join(" AND ")}` : "";

    const mapAggRows = (rows: RowDataPacket[]) =>
      rows.map((r) => {
        const download = toSafeBigInt(r.download_bytes).toString();
        const upload = toSafeBigInt(r.upload_bytes).toString();
        const total = (toSafeBigInt(r.download_bytes) + toSafeBigInt(r.upload_bytes)).toString();
        return {
          period: String(r.period ?? ""),
          sessions_count: Number(r.sessions_count ?? 0),
          online_seconds: Number(r.online_seconds ?? 0),
          download_bytes: download,
          upload_bytes: upload,
          total_bytes: total,
        };
      });

    const [dailyRows, monthlyRows, yearlyRows, todayRows, monthRows, sessionRows] = await Promise.all([
      pool.query<RowDataPacket[]>(
        `SELECT
           DATE(acctstarttime) AS period,
           COUNT(*) AS sessions_count,
           SUM(${sessionSecondsExpr}) AS online_seconds,
           SUM(COALESCE(acctinputoctets,0)) AS download_bytes,
           SUM(COALESCE(acctoutputoctets,0)) AS upload_bytes
         FROM radacct
         WHERE username = ?${dateWhereSql}
         GROUP BY DATE(acctstarttime)
         ORDER BY period DESC
         LIMIT 90`,
        [username, ...dateParams]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(acctstarttime, '%Y-%m') AS period,
           COUNT(*) AS sessions_count,
           SUM(${sessionSecondsExpr}) AS online_seconds,
           SUM(COALESCE(acctinputoctets,0)) AS download_bytes,
           SUM(COALESCE(acctoutputoctets,0)) AS upload_bytes
         FROM radacct
         WHERE username = ?${dateWhereSql}
         GROUP BY DATE_FORMAT(acctstarttime, '%Y-%m')
         ORDER BY period DESC
         LIMIT 24`,
        [username, ...dateParams]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(acctstarttime, '%Y') AS period,
           COUNT(*) AS sessions_count,
           SUM(${sessionSecondsExpr}) AS online_seconds,
           SUM(COALESCE(acctinputoctets,0)) AS download_bytes,
           SUM(COALESCE(acctoutputoctets,0)) AS upload_bytes
         FROM radacct
         WHERE username = ?${dateWhereSql}
         GROUP BY DATE_FORMAT(acctstarttime, '%Y')
         ORDER BY period DESC
         LIMIT 10`,
        [username, ...dateParams]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT
           SUM(${sessionSecondsExpr}) AS online_seconds,
           SUM(COALESCE(acctinputoctets,0)) AS download_bytes,
           SUM(COALESCE(acctoutputoctets,0)) AS upload_bytes
         FROM radacct
         WHERE username = ? AND DATE(acctstarttime) = CURDATE()${dateWhereSql}`,
        [username, ...dateParams]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT
           SUM(${sessionSecondsExpr}) AS online_seconds,
           SUM(COALESCE(acctinputoctets,0)) AS download_bytes,
           SUM(COALESCE(acctoutputoctets,0)) AS upload_bytes
         FROM radacct
         WHERE username = ?
           AND YEAR(acctstarttime) = YEAR(CURDATE())
           AND MONTH(acctstarttime) = MONTH(CURDATE())${dateWhereSql}`,
        [username, ...dateParams]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT
           radacctid,
           nasipaddress,
           framedipaddress,
           callingstationid,
           acctstarttime,
           acctstoptime,
           ${sessionSecondsExpr} AS online_seconds,
           COALESCE(acctinputoctets,0) AS download_bytes,
           COALESCE(acctoutputoctets,0) AS upload_bytes
         FROM radacct
         WHERE username = ?${dateWhereSql}
         ORDER BY acctstarttime DESC
         LIMIT 120`,
        [username, ...dateParams]
      ),
    ]);

    const daily = mapAggRows(dailyRows[0] ?? []);
    const monthly = mapAggRows(monthlyRows[0] ?? []);
    const yearly = mapAggRows(yearlyRows[0] ?? []);

    const today = todayRows[0]?.[0] ?? {};
    const month = monthRows[0]?.[0] ?? {};
    const dailyDownload = toSafeBigInt(today.download_bytes).toString();
    const dailyUpload = toSafeBigInt(today.upload_bytes).toString();
    const monthlyDownload = toSafeBigInt(month.download_bytes).toString();
    const monthlyUpload = toSafeBigInt(month.upload_bytes).toString();

    const sessions = (sessionRows[0] ?? []).map((r) => {
      const download = toSafeBigInt(r.download_bytes).toString();
      const upload = toSafeBigInt(r.upload_bytes).toString();
      const total = (toSafeBigInt(r.download_bytes) + toSafeBigInt(r.upload_bytes)).toString();
      return {
        radacctid: String(r.radacctid ?? ""),
        start_time: r.acctstarttime ? String(r.acctstarttime) : null,
        stop_time: r.acctstoptime ? String(r.acctstoptime) : null,
        online_seconds: Number(r.online_seconds ?? 0),
        download_bytes: download,
        upload_bytes: upload,
        total_bytes: total,
        framed_ip: r.framedipaddress ? String(r.framedipaddress) : null,
        caller_id: r.callingstationid ? String(r.callingstationid) : null,
        nas_ip: r.nasipaddress ? String(r.nasipaddress) : null,
        is_active: !r.acctstoptime,
      };
    });

    res.json({
      username,
      filter: {
        from: fromDate,
        to: toDate,
      },
      totals: {
        daily_online_seconds: Number(today.online_seconds ?? 0),
        daily_download_bytes: dailyDownload,
        daily_upload_bytes: dailyUpload,
        daily_total_bytes: (toSafeBigInt(today.download_bytes) + toSafeBigInt(today.upload_bytes)).toString(),
        monthly_online_seconds: Number(month.online_seconds ?? 0),
        monthly_download_bytes: monthlyDownload,
        monthly_upload_bytes: monthlyUpload,
        monthly_total_bytes: (toSafeBigInt(month.download_bytes) + toSafeBigInt(month.upload_bytes)).toString(),
      },
      daily,
      monthly,
      yearly,
      sessions,
    });
  }
);

const payBody = z.object({
  extend_days: z.number().int().min(1).max(400).optional(),
});

router.post(
  "/:id/pay",
  routePolicy({
    allow: ["admin", "manager", "accountant"],
    managerPermission: "renew_subscriptions",
    allowAccountantWrite: true,
  }),
  async (req, res) => {
  const parsed = payBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const tenant = req.auth!.tenantId;
  let subs: RowDataPacket[] = [];
  if (await usePortalSubscribersData(tenant)) {
    const [r] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.expiration_date, p.price, p.currency
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id
       WHERE s.id = ? AND s.tenant_id = ?
       LIMIT 1`,
      [req.params.id, tenant]
    );
    subs = r as RowDataPacket[];
  }
  if (!subs[0] && (await hasTable(pool, "rm_users"))) {
    const hasSrv = await hasTable(pool, "rm_services");
    const [r] = await pool.query<RowDataPacket[]>(
      hasSrv
        ? `SELECT u.username AS id, u.expiration AS expiration_date, p.unitprice AS price, 'USD' AS currency
           FROM rm_users u
           LEFT JOIN rm_services p ON p.srvid = u.srvid
           WHERE u.username = ? LIMIT 1`
        : `SELECT u.username AS id, u.expiration AS expiration_date, 0 AS price, 'USD' AS currency
           FROM rm_users u WHERE u.username = ? LIMIT 1`,
      [req.params.id]
    );
    subs = r as RowDataPacket[];
  }
  if (!subs[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const current = new Date(subs[0].expiration_date as string);
  if (req.auth!.role === "manager") {
    try {
      await chargeManagerWallet({
        tenantId: tenant,
        staffId: req.auth!.sub,
        amount: Number(subs[0].price ?? 0),
        currency: String(subs[0].currency ?? "USD"),
        reason: "subscriber_pay_renewal",
        subscriberId: String(subs[0].id),
      });
    } catch (error) {
      if (error instanceof ManagerBalanceError && error.code === "insufficient_balance") {
        res.status(400).json({ error: "insufficient_manager_balance" });
        return;
      }
      res.status(500).json({ error: "wallet_charge_failed" });
      return;
    }
  }
  const next = extendSubscriptionByDaysNoon(current, parsed.data.extend_days ?? 30);
  if (await usePortalSubscribersData(tenant)) {
    await pool.execute(
      `UPDATE subscribers SET expiration_date = ?, status = 'active' WHERE id = ? AND tenant_id = ?`,
      [next, req.params.id, tenant]
    );
  } else {
    await pool.execute(`UPDATE rm_users SET expiration = ?, enableuser = 1 WHERE username = ?`, [
      next,
      req.params.id,
    ]);
  }
  try {
    assertRadiusPush(await pushRadiusForSubscriber(pool, radius, tenant, req.params.id));
  } catch (e) {
    console.error("[subscribers] renew_paid: radius push failed", e);
    res.status(502).json({
      error: "radius_sync_failed",
      detail: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  await writeAuditLog(pool, {
    tenantId: tenant,
    staffId: req.auth!.sub,
    action: "renew_paid",
    entityType: "subscriber",
    entityId: req.params.id,
    payload: { extend_days: parsed.data.extend_days ?? 30 },
  });
  res.json({ ok: true, expiration_date: next.toISOString() });
  }
);

router.post(
  "/:id/current-package-invoice",
  routePolicy({
    allow: ["admin", "manager", "accountant"],
    managerPermission: "manage_invoices",
    allowAccountantWrite: true,
  }),
  async (req, res) => {
    const tenant = req.auth!.tenantId;
    const subscriberId = req.params.id;
    if (!(await hasTable(pool, "invoices"))) {
      res.status(503).json({ error: "invoices_table_missing" });
      return;
    }
    const portal = await usePortalSubscribersData(tenant);
    let rows: RowDataPacket[];
    if (portal) {
      const [r] = await pool.query<RowDataPacket[]>(
        `SELECT s.package_id, p.price, p.currency, p.billing_period_days
         FROM subscribers s
         LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
         WHERE s.id = ? AND s.tenant_id = ?
         LIMIT 1`,
        [subscriberId, tenant]
      );
      rows = r as RowDataPacket[];
    } else if (await hasTable(pool, "rm_users")) {
      const hasSrv = await hasTable(pool, "rm_services");
      const [r] = await pool.query<RowDataPacket[]>(
        hasSrv
          ? `SELECT CAST(u.srvid AS CHAR) AS package_id, p.unitprice AS price, 'USD' AS currency, 30 AS billing_period_days
             FROM rm_users u
             LEFT JOIN rm_services p ON p.srvid = u.srvid
             WHERE u.username = ? LIMIT 1`
          : `SELECT CAST(u.srvid AS CHAR) AS package_id, 0 AS price, 'USD' AS currency, 30 AS billing_period_days
             FROM rm_users u WHERE u.username = ? LIMIT 1`,
        [subscriberId]
      );
      rows = r as RowDataPacket[];
    } else {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const sub = rows[0];
    if (!sub) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const packageId = sub.package_id ? String(sub.package_id) : "";
    const amount = Number(sub.price ?? 0);
    const currency = String(sub.currency ?? "USD").toUpperCase() === "SYP" ? "SYP" : "USD";
    const billingDays = Number(sub.billing_period_days ?? 30);
    if (!packageId || amount <= 0) {
      res.status(400).json({ error: "no_package_price" });
      return;
    }
    const [open] = await pool.query<RowDataPacket[]>(
      `SELECT id, invoice_no, amount, currency, status
       FROM invoices
       WHERE tenant_id = ? AND subscriber_id = ? AND status IN ('draft','sent')
       ORDER BY issue_date DESC, created_at DESC
       LIMIT 1`,
      [tenant, subscriberId]
    );
    if (open[0]) {
      res.json({
        invoice_id: String(open[0].id),
        invoice_no: String(open[0].invoice_no ?? ""),
        amount: Number(open[0].amount ?? 0),
        currency: String(open[0].currency ?? currency),
        created: false,
      });
      return;
    }
    const id = randomUUID();
    const invNo = `PKG-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);
    await pool.execute(
      `INSERT INTO invoices (id, tenant_id, subscriber_id, period, invoice_no, issue_date, due_date,
        amount, currency, status, meta)
       VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, ?, 'sent',
        JSON_OBJECT('billing_days', ?, 'package_id', ?, 'source', 'package'))`,
      [id, tenant, subscriberId, invNo, today, today, amount, currency, billingDays, packageId]
    );
    res.status(201).json({
      invoice_id: id,
      invoice_no: invNo,
      amount,
      currency,
      created: true,
    });
  }
);

router.post(
  "/:id/record-package-payment",
  routePolicy({
    allow: ["admin", "manager", "accountant"],
    managerPermission: "manage_invoices",
    allowAccountantWrite: true,
  }),
  async (req, res) => {
    const tenant = req.auth!.tenantId;
    const subscriberId = req.params.id;
    if (!(await hasTable(pool, "invoices")) || !(await hasTable(pool, "payments"))) {
      res.status(503).json({ error: "billing_tables_missing" });
      return;
    }
    const portal = await usePortalSubscribersData(tenant);
    try {
      const tx = await withTransaction(async (conn) => {
        let subRows: RowDataPacket[];
        if (portal) {
          const [r] = await conn.query<RowDataPacket[]>(
            `SELECT s.package_id, p.price, p.currency, p.billing_period_days, s.expiration_date
             FROM subscribers s
             LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
             WHERE s.id = ? AND s.tenant_id = ?
             LIMIT 1 FOR UPDATE`,
            [subscriberId, tenant]
          );
          subRows = r as RowDataPacket[];
        } else if (await hasTable(pool, "rm_users")) {
          const hasSrv = await hasTable(pool, "rm_services");
          const [r] = await conn.query<RowDataPacket[]>(
            hasSrv
              ? `SELECT CAST(u.srvid AS CHAR) AS package_id, p.unitprice AS price, 'USD' AS currency,
                        30 AS billing_period_days, u.expiration AS expiration_date
                 FROM rm_users u
                 LEFT JOIN rm_services p ON p.srvid = u.srvid
                 WHERE u.username = ? LIMIT 1 FOR UPDATE`
              : `SELECT CAST(u.srvid AS CHAR) AS package_id, 0 AS price, 'USD' AS currency,
                        30 AS billing_period_days, u.expiration AS expiration_date
                 FROM rm_users u WHERE u.username = ? LIMIT 1 FOR UPDATE`,
            [subscriberId]
          );
          subRows = r as RowDataPacket[];
        } else {
          return { kind: "not_found" as const };
        }
        const sub = subRows[0];
        if (!sub) return { kind: "not_found" as const };
        const packageId = sub.package_id ? String(sub.package_id) : "";
        let amount = Number(sub.price ?? 0);
        let currency = String(sub.currency ?? "USD").toUpperCase() === "SYP" ? "SYP" : "USD";
        const billingDays = Number(sub.billing_period_days ?? 30);
        if (!packageId || amount <= 0) return { kind: "no_package_price" as const };

        const [openRows] = await conn.query<RowDataPacket[]>(
          `SELECT id FROM invoices
           WHERE tenant_id = ? AND subscriber_id = ? AND status IN ('draft','sent')
           ORDER BY issue_date DESC, created_at DESC
           LIMIT 1 FOR UPDATE`,
          [tenant, subscriberId]
        );
        let invoiceId: string;
        if (openRows[0]) {
          invoiceId = String(openRows[0].id);
        } else {
          invoiceId = randomUUID();
          const invNo = `PKG-${Date.now()}`;
          const today = new Date().toISOString().slice(0, 10);
          await conn.execute(
            `INSERT INTO invoices (id, tenant_id, subscriber_id, period, invoice_no, issue_date, due_date,
              amount, currency, status, meta)
             VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, ?, 'sent',
              JSON_OBJECT('billing_days', ?, 'package_id', ?, 'source', 'package'))`,
            [
              invoiceId,
              tenant,
              subscriberId,
              invNo,
              today,
              today,
              amount,
              currency,
              billingDays,
              packageId,
            ]
          );
        }

        const [invRows] = await conn.query<RowDataPacket[]>(
          `SELECT * FROM invoices WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
          [invoiceId, tenant]
        );
        const inv = invRows[0];
        if (!inv) return { kind: "not_found" as const };
        if (String(inv.status ?? "").toLowerCase() === "paid") return { kind: "already_paid" as const };

        amount = Number(inv.amount ?? 0);
        currency = String(inv.currency ?? "USD");
        const invoiceNo = String(inv.invoice_no ?? "");

        if (req.auth!.role === "manager") {
          await chargeManagerWalletWithConnection(conn, {
            tenantId: tenant,
            staffId: req.auth!.sub,
            amount,
            currency,
            reason: "invoice_mark_paid",
            subscriberId,
            note: invoiceNo,
          });
        }

        const paidAt = new Date();
        await conn.execute(`UPDATE invoices SET status = 'paid' WHERE id = ? AND tenant_id = ?`, [
          invoiceId,
          tenant,
        ]);
        const payId = randomUUID();
        await conn.execute(
          `INSERT INTO payments (id, tenant_id, invoice_id, amount, method, paid_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [payId, tenant, invoiceId, amount, "manual", paidAt]
        );

        let metaDays = billingDays;
        try {
          const parsedMeta = typeof inv.meta === "string" ? JSON.parse(inv.meta) : inv.meta;
          metaDays = Number((parsedMeta as { billing_days?: unknown } | null)?.billing_days ?? billingDays);
        } catch {
          metaDays = billingDays;
        }
        const current = new Date(sub.expiration_date as string);
        const nextExpiration = extendSubscriptionByDaysNoon(current, metaDays);
        if (portal) {
          await conn.execute(
            `UPDATE subscribers SET expiration_date = ?, status = 'active' WHERE id = ? AND tenant_id = ?`,
            [nextExpiration, subscriberId, tenant]
          );
        } else if (await hasTable(pool, "rm_users")) {
          await conn.execute(`UPDATE rm_users SET expiration = ?, enableuser = 1 WHERE username = ?`, [
            nextExpiration,
            subscriberId,
          ]);
        }

        return {
          kind: "ok" as const,
          paymentId: payId,
          invoiceId,
          amount,
          currency,
          invoiceNo,
          paidAt: paidAt.toISOString(),
          nextExpiration: nextExpiration.toISOString(),
        };
      });

      if (tx.kind === "not_found") {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (tx.kind === "no_package_price") {
        res.status(400).json({ error: "no_package_price" });
        return;
      }
      if (tx.kind === "already_paid") {
        res.status(409).json({ error: "already_paid" });
        return;
      }
      let radiusWarning: string | null = null;
      try {
        const pr = await pushRadiusForSubscriber(pool, radius, tenant, subscriberId);
        if (!pr.ok) {
          radiusWarning = pr.reason;
        } else {
          const un = await resolveUsernameForSubscriberId(tenant, subscriberId);
          if (un) {
            await disconnectBySystemPolicy(tenant, un, "activation");
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        radiusWarning = msg;
        console.error("push radius after package payment failed", error);
      }
      await emitEvent(Events.INVOICE_PAID, {
        tenantId: tenant,
        invoiceId: tx.invoiceId,
        subscriberId,
        invoiceNo: tx.invoiceNo,
        amount: tx.amount,
        currency: tx.currency,
        paidAt: tx.paidAt,
      });
      res.json({ ok: true, payment_id: tx.paymentId, invoice_id: tx.invoiceId, radius_sync: radiusWarning ? "failed" : "ok", radius_reason: radiusWarning });
    } catch (error) {
      if (error instanceof ManagerBalanceError && error.code === "insufficient_balance") {
        res.status(400).json({ error: "insufficient_manager_balance" });
        return;
      }
      console.error("record-package-payment", error);
      res.status(500).json({ error: "package_payment_failed" });
    }
  }
);

const patchBody = z.object({
  nas_server_id: z.string().uuid().nullable().optional(),
  pool: z.string().nullable().optional(),
  mac_address: z.string().nullable().optional(),
  ip_address: z.string().nullable().optional(),
  first_name: z.string().max(128).nullable().optional(),
  last_name: z.string().max(128).nullable().optional(),
  nickname: z.string().max(128).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  address: z.string().max(255).nullable().optional(),
  region_id: z.string().uuid().nullable().optional(),
  package_id: z.string().min(1).max(64).optional(),
  /** RADIUS login password: updates `rm_users.password` (DMA) and/or encrypted column + radcheck when active. */
  password: z.string().min(1).max(128).optional(),
});

router.patch(
  "/:id",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const tenant = req.auth!.tenantId;
    const b = parsed.data;
    if (await isRadiusManagerSubscribersPrimary(pool, tenant)) {
      const [rm0] = await pool.query<RowDataPacket[]>(
        `SELECT username, srvid, enableuser, expiration, staticipcpe, mac FROM rm_users WHERE username = ? LIMIT 1`,
        [req.params.id]
      );
      if (!rm0[0]) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const u = req.params.id;
      const setsRm: string[] = [];
      const valsRm: unknown[] = [];
      if (b.phone !== undefined) {
        setsRm.push("phone = ?");
        valsRm.push(b.phone ?? "");
      }
      if (b.address !== undefined) {
        setsRm.push("address = ?");
        valsRm.push(b.address ?? "");
      }
      if (b.first_name !== undefined) {
        setsRm.push("firstname = ?");
        valsRm.push(b.first_name ?? "");
      }
      if (b.last_name !== undefined) {
        setsRm.push("lastname = ?");
        valsRm.push(b.last_name ?? "");
      }
      if (b.mac_address !== undefined) {
        setsRm.push("mac = ?");
        valsRm.push(b.mac_address ?? "");
      }
      if (b.ip_address !== undefined) {
        setsRm.push("staticipcpe = ?");
        valsRm.push(b.ip_address ?? "");
      }
      if (b.package_id !== undefined) {
        const srv = parseInt(String(b.package_id).trim(), 10);
        if (Number.isFinite(srv)) {
          setsRm.push("srvid = ?");
          valsRm.push(srv);
        }
      }
      if (b.password !== undefined) {
        const rmColPw = await getTableColumns(pool, "rm_users");
        if (!rmColPw.has("password")) {
          res.status(400).json({ error: "password_not_supported" });
          return;
        }
        setsRm.push("password = ?");
        valsRm.push(b.password);
      }
      if (setsRm.length) {
        await pool.query(`UPDATE rm_users SET ${setsRm.join(", ")} WHERE username = ?`, [...valsRm, u]);
      }
      const [rm1] = await pool.query<RowDataPacket[]>(
        `SELECT username, srvid, enableuser, expiration, staticipcpe, mac FROM rm_users WHERE username = ? LIMIT 1`,
        [u]
      );
      const row = rm1[0];
      if (row && Number(row.enableuser) === 1) {
        const pkgId = String(row.srvid ?? "");
        const pkg = await radius.getPackage(tenant, pkgId);
        if (pkg) {
          const password = await radius.getCleartextPassword(String(row.username));
          if (password) {
            const expPatch = new Date(String(row.expiration ?? ""));
            await radius.createRadiusUser({
              username: String(row.username),
              password,
              package: pkg,
              framedIp: row.staticipcpe != null ? String(row.staticipcpe) : null,
              macLock: row.mac != null ? String(row.mac) : null,
              framedPool: b.pool ?? null,
              expirationDate: Number.isNaN(expPatch.getTime()) ? null : expPatch,
            });
            await disconnectBySystemPolicy(tenant, String(row.username), "update");
          }
        }
      }
      const auditRm = { ...parsed.data, ...(parsed.data.password !== undefined ? { password: "[redacted]" } : {}) };
      await writeAuditLog(pool, {
        tenantId: tenant,
        staffId: req.auth!.sub,
        action: "update",
        entityType: "subscriber",
        entityId: req.params.id,
        payload: auditRm,
      });
      res.json({ ok: true });
      return;
    }
    const [subs] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [req.params.id, tenant]
    );
    if (!subs[0]) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    invalidateColumnCache();
    const subCols = await getTableColumns(pool, "subscribers");
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (b.nas_server_id !== undefined && subCols.has("nas_server_id")) {
      sets.push("nas_server_id = ?");
      vals.push(b.nas_server_id);
    }
    if (b.pool !== undefined && subCols.has("pool")) {
      sets.push("pool = ?");
      vals.push(b.pool);
    }
    if (b.mac_address !== undefined && subCols.has("mac_address")) {
      sets.push("mac_address = ?");
      vals.push(b.mac_address);
    }
    if (b.ip_address !== undefined && subCols.has("ip_address")) {
      sets.push("ip_address = ?");
      vals.push(b.ip_address);
    }
    if (b.first_name !== undefined && subCols.has("first_name")) {
      sets.push("first_name = ?");
      vals.push(b.first_name);
    }
    if (b.last_name !== undefined && subCols.has("last_name")) {
      sets.push("last_name = ?");
      vals.push(b.last_name);
    }
    if (b.nickname !== undefined && subCols.has("nickname")) {
      sets.push("nickname = ?");
      vals.push(b.nickname);
    }
    if (b.phone !== undefined && subCols.has("phone")) {
      sets.push("phone = ?");
      vals.push(b.phone);
    }
    if (b.address !== undefined && subCols.has("address")) {
      sets.push("address = ?");
      vals.push(b.address);
    }
    if (b.region_id !== undefined && subCols.has("region_id")) {
      if (b.region_id) {
        const [reg] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM subscriber_regions WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [b.region_id, tenant]
        );
        if (!reg[0]) {
          res.status(400).json({ error: "invalid_region" });
          return;
        }
      }
      sets.push("region_id = ?");
      vals.push(b.region_id);
    }
    if (b.package_id !== undefined && subCols.has("package_id")) {
      sets.push("package_id = ?");
      vals.push(b.package_id);
    }
    if (b.password !== undefined) {
      if (!subCols.has("radius_password_encrypted")) {
        res.status(400).json({ error: "password_not_supported" });
        return;
      }
      sets.push("radius_password_encrypted = ?");
      vals.push(encryptSecret(b.password));
    }
    if (sets.length) {
      const updateSql = `UPDATE subscribers SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`;
      await pool.query(updateSql, [...vals, req.params.id, tenant]);
    }
    const [updated] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [req.params.id, tenant]
    );
    const row = updated[0];
    if (row?.status === "active" && row.package_id) {
      const pkg = await radius.getPackage(tenant, row.package_id as string);
      if (pkg) {
        let password: string | null = null;
        const enc = row.radius_password_encrypted as Buffer | null;
        if (enc && enc.length > 0) {
          try {
            const { decryptSecret } = await import("../services/crypto.service.js");
            password = decryptSecret(Buffer.from(enc));
          } catch {
            password = null;
          }
        }
        if (!password) {
          password = await radius.getCleartextPassword(row.username as string);
        }
        if (password) {
          const expPatch = new Date(String(row.expiration_date ?? ""));
          await radius.createRadiusUser({
            username: row.username as string,
            password,
            package: pkg,
            framedIp: row.ip_address as string | null,
            macLock: row.mac_address as string | null,
            framedPool: row.pool as string | null,
            expirationDate: Number.isNaN(expPatch.getTime()) ? null : expPatch,
          });
          await disconnectBySystemPolicy(tenant, String(row.username), "update");
        }
      }
    }
    const auditSub = { ...parsed.data, ...(parsed.data.password !== undefined ? { password: "[redacted]" } : {}) };
    await writeAuditLog(pool, {
      tenantId: tenant,
      staffId: req.auth!.sub,
      action: "update",
      entityType: "subscriber",
      entityId: req.params.id,
      payload: auditSub,
    });
    res.json({ ok: true });
  }
);

const disableByIdHandler = async (req: Request, res: Response) => {
  const tenant = req.auth!.tenantId;
  let username: string | undefined;
  if (await hasTable(pool, "subscribers")) {
    const [subs] = await pool.query<RowDataPacket[]>(
      `SELECT username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [req.params.id, tenant]
    );
    username = subs[0]?.username != null ? String(subs[0].username) : undefined;
  }
  if (!username && (await hasTable(pool, "rm_users"))) {
    const [rm] = await pool.query<RowDataPacket[]>(
      `SELECT username FROM rm_users WHERE username = ? LIMIT 1`,
      [req.params.id]
    );
    username = rm[0]?.username != null ? String(rm[0].username) : undefined;
  }
  if (!username) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    const rep = await coa.disconnectAllSessions(username, tenant);
    if (rep && !rep.anyOk) {
      console.warn(`[subscribers] disable: disconnect incomplete for ${username}`);
    }
  } catch (e) {
    console.error("[subscribers] coa on disable", e);
  }
  await radius.disableRadiusUser(username);
  if (await usePortalSubscribersData(tenant)) {
    await pool.execute(`UPDATE subscribers SET status = 'disabled' WHERE id = ? AND tenant_id = ?`, [
      req.params.id,
      tenant,
    ]);
  }
  try {
    await pool.execute(`UPDATE rm_users SET enableuser = 0 WHERE username = ?`, [username]);
  } catch {
    /* rm_users may not exist */
  }
  res.json({ ok: true });
};

router.patch(
  "/:id/disable",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  disableByIdHandler
);

router.post(
  "/bulk-delete",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req: Request, res: Response) => {
    const parsed = z
      .object({
        ids: z.array(z.string().min(1).max(64)).min(1).max(500),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const tenant = req.auth!.tenantId;
    const useSubscribersBulkDel = await usePortalSubscribersData(tenant);
    const tableNames = [
      "subscribers",
      "invoices",
      "user_usage_live",
      "user_usage_daily",
      "radcheck",
      "radreply",
      "radusergroup",
      "radacct",
      "radpostauth",
      "rm_users",
    ] as const;
    const available = new Map<string, boolean>();
    await Promise.all(
      tableNames.map(async (name) => {
        available.set(name, await hasTable(pool, name));
      })
    );

    const conn = await pool.getConnection();
    let deleted: string[] = [];
    let missing: string[] = [];
    try {
      await conn.beginTransaction();
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_sub_input_ids`);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_subscriber_ids`);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_usernames`);
      await conn.execute(
        `CREATE TEMPORARY TABLE tmp_bulk_sub_input_ids (
          id VARCHAR(64) PRIMARY KEY
        )`
      );
      const placeholders = parsed.data.ids.map(() => "(?)").join(",");
      await conn.execute(
        `INSERT INTO tmp_bulk_sub_input_ids (id) VALUES ${placeholders}`,
        parsed.data.ids
      );
      await conn.execute(
        `CREATE TEMPORARY TABLE tmp_bulk_subscriber_ids (
          id VARCHAR(64) PRIMARY KEY
        )`
      );
      await conn.execute(
        `CREATE TEMPORARY TABLE tmp_bulk_usernames (
          username VARCHAR(64) PRIMARY KEY
        )`
      );

      if (useSubscribersBulkDel && available.get("subscribers")) {
        await conn.execute(
          `INSERT INTO tmp_bulk_subscriber_ids (id)
           SELECT s.id
           FROM subscribers s
           INNER JOIN tmp_bulk_sub_input_ids i ON i.id = s.id
           WHERE s.tenant_id = ?`,
          [tenant]
        );
        await conn.execute(
          `INSERT INTO tmp_bulk_usernames (username)
           SELECT DISTINCT s.username
           FROM subscribers s
           INNER JOIN tmp_bulk_subscriber_ids d ON d.id = s.id
           WHERE s.tenant_id = ?
             AND s.username IS NOT NULL
             AND s.username <> ''`,
          [tenant]
        );
      } else if (available.get("rm_users")) {
        await conn.execute(
          `INSERT INTO tmp_bulk_usernames (username)
           SELECT DISTINCT u.username
           FROM rm_users u
           INNER JOIN tmp_bulk_sub_input_ids i ON i.id = u.username
           WHERE u.username IS NOT NULL
             AND u.username <> ''`
        );
      }

      const [deletedRows] = await conn.query<RowDataPacket[]>(
        useSubscribersBulkDel && available.get("subscribers")
          ? `SELECT i.id
             FROM tmp_bulk_sub_input_ids i
             INNER JOIN tmp_bulk_subscriber_ids d ON d.id = i.id`
          : `SELECT i.id
             FROM tmp_bulk_sub_input_ids i
             INNER JOIN tmp_bulk_usernames u ON u.username = i.id`
      );
      deleted = deletedRows.map((r) => String(r.id));
      const deletedSet = new Set(deleted);
      missing = parsed.data.ids.filter((id) => !deletedSet.has(id));

      if (!deleted.length) {
        await conn.rollback();
        await writeAuditLog(pool, {
          tenantId: tenant,
          staffId: req.auth!.sub,
          action: "bulk_delete",
          entityType: "subscriber",
          payload: { deleted_count: 0, missing_count: missing.length, ids: parsed.data.ids },
        });
        res.json({ ok: true, deleted, missing });
        return;
      }

      if (available.get("invoices")) {
        if (useSubscribersBulkDel && available.get("subscribers")) {
          await conn.execute(
            `DELETE inv FROM invoices inv
             INNER JOIN tmp_bulk_subscriber_ids d ON d.id = inv.subscriber_id
             WHERE inv.tenant_id = ?`,
            [tenant]
          );
        } else {
          await conn.execute(
            `DELETE inv FROM invoices inv
             INNER JOIN tmp_bulk_usernames u ON u.username = inv.subscriber_id
             WHERE inv.tenant_id = ?`,
            [tenant]
          );
        }
      }
      if (available.get("user_usage_live")) {
        await conn.execute(
          `DELETE ul FROM user_usage_live ul
           INNER JOIN tmp_bulk_usernames u ON u.username = ul.username
           WHERE ul.tenant_id = ?`,
          [tenant]
        );
      }
      if (available.get("user_usage_daily")) {
        await conn.execute(
          `DELETE ud FROM user_usage_daily ud
           INNER JOIN tmp_bulk_usernames u ON u.username = ud.username
           WHERE ud.tenant_id = ?`,
          [tenant]
        );
      }
      if (available.get("radcheck")) {
        await conn.execute(
          `DELETE rc FROM radcheck rc
           INNER JOIN tmp_bulk_usernames u ON u.username = rc.username`
        );
      }
      if (available.get("radreply")) {
        await conn.execute(
          `DELETE rr FROM radreply rr
           INNER JOIN tmp_bulk_usernames u ON u.username = rr.username`
        );
      }
      if (available.get("radusergroup")) {
        await conn.execute(
          `DELETE rg FROM radusergroup rg
           INNER JOIN tmp_bulk_usernames u ON u.username = rg.username`
        );
      }
      if (available.get("radacct")) {
        await conn.execute(
          `DELETE ra FROM radacct ra
           INNER JOIN tmp_bulk_usernames u ON u.username = ra.username`
        );
      }
      if (available.get("radpostauth")) {
        await conn.execute(
          `DELETE rp FROM radpostauth rp
           INNER JOIN tmp_bulk_usernames u ON u.username = rp.username`
        );
      }
      if (available.get("rm_users")) {
        await conn.execute(
          `DELETE ru FROM rm_users ru
           INNER JOIN tmp_bulk_usernames u ON u.username = ru.username`
        );
      }
      if (available.get("subscribers") && useSubscribersBulkDel) {
        await conn.execute(
          `DELETE s FROM subscribers s
           INNER JOIN tmp_bulk_subscriber_ids d ON d.id = s.id
           WHERE s.tenant_id = ?`,
          [tenant]
        );
      }

      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_usernames`);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_subscriber_ids`);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_sub_input_ids`);
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_usernames`).catch(() => {});
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_subscriber_ids`).catch(() => {});
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_sub_input_ids`).catch(() => {});
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "bulk_delete_failed", detail: msg });
      return;
    } finally {
      conn.release();
    }
    await writeAuditLog(pool, {
      tenantId: tenant,
      staffId: req.auth!.sub,
      action: "bulk_delete",
      entityType: "subscriber",
      payload: { deleted_count: deleted.length, missing_count: missing.length, ids: parsed.data.ids },
    });
    res.json({ ok: true, deleted, missing });
  }
);

router.delete(
  "/:id",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req: Request, res: Response) => {
    const tenant = req.auth!.tenantId;
    let subscriberId = req.params.id;
    let username: string | null = null;
    if (await usePortalSubscribersData(tenant)) {
      const [subs] = await pool.query<RowDataPacket[]>(
        `SELECT id, username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [req.params.id, tenant]
      );
      if (!subs[0]) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      subscriberId = String(subs[0].id);
      username = String(subs[0].username);
    } else {
      username = await resolveUsernameForSubscriberId(tenant, req.params.id);
      if (!username) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      subscriberId = username;
    }
    await deleteSubscriberData(tenant, subscriberId, username);
    await writeAuditLog(pool, {
      tenantId: tenant,
      staffId: req.auth!.sub,
      action: "delete",
      entityType: "subscriber",
      entityId: req.params.id,
      payload: { username: String(username) },
    });
    res.json({ ok: true });
  }
);

router.post(
  "/:id/disable",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  disableByIdHandler
);

router.post(
  "/:id/enable",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
  const tenant = req.auth!.tenantId;
  const un = await resolveUsernameForSubscriberId(tenant, req.params.id);
  if (!un) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (await usePortalSubscribersData(tenant)) {
    await pool.execute(`UPDATE subscribers SET status = 'active' WHERE id = ? AND tenant_id = ?`, [
      req.params.id,
      tenant,
    ]);
  }
  try {
    await pool.execute(`UPDATE rm_users SET enableuser = 1 WHERE username = ?`, [un]);
  } catch {
    /* rm_users may not exist */
  }
  const r = await pushRadiusForSubscriber(pool, radius, tenant, req.params.id);
  if (!r.ok) {
    res.status(400).json({ error: r.reason });
    return;
  }
  try {
    await disconnectBySystemPolicy(tenant, un, "activation");
  } catch {
    /* ignore */
  }
  res.json({ ok: true });
  }
);

const renewBody = z.object({
  paid_invoice_id: z.string().uuid().optional(),
  extend_days: z.number().int().min(1).max(365).optional(),
});

router.post(
  "/:id/renew",
  routePolicy({
    allow: ["admin", "manager", "accountant"],
    managerPermission: "renew_subscriptions",
    allowAccountantWrite: true,
  }),
  async (req, res) => {
  const parsed = renewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const tenant = req.auth!.tenantId;
  let subs: RowDataPacket[] = [];
  if (await usePortalSubscribersData(tenant)) {
    const [r] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.expiration_date, p.price, p.currency
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id
       WHERE s.id = ? AND s.tenant_id = ? LIMIT 1`,
      [req.params.id, tenant]
    );
    subs = r as RowDataPacket[];
  }
  if (!subs[0] && (await hasTable(pool, "rm_users"))) {
    const hasSrv = await hasTable(pool, "rm_services");
    const [r] = await pool.query<RowDataPacket[]>(
      hasSrv
        ? `SELECT u.username AS id, u.expiration AS expiration_date, p.unitprice AS price, 'USD' AS currency
           FROM rm_users u
           LEFT JOIN rm_services p ON p.srvid = u.srvid
           WHERE u.username = ? LIMIT 1`
        : `SELECT u.username AS id, u.expiration AS expiration_date, 0 AS price, 'USD' AS currency
           FROM rm_users u WHERE u.username = ? LIMIT 1`,
      [req.params.id]
    );
    subs = r as RowDataPacket[];
  }
  if (!subs[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const current = new Date(subs[0].expiration_date as string);
  if (req.auth!.role === "manager") {
    try {
      await chargeManagerWallet({
        tenantId: tenant,
        staffId: req.auth!.sub,
        amount: Number(subs[0].price ?? 0),
        currency: String(subs[0].currency ?? "USD"),
        reason: "subscriber_renewal",
        subscriberId: String(subs[0].id),
      });
    } catch (error) {
      if (error instanceof ManagerBalanceError && error.code === "insufficient_balance") {
        res.status(400).json({ error: "insufficient_manager_balance" });
        return;
      }
      res.status(500).json({ error: "wallet_charge_failed" });
      return;
    }
  }
  const next = extendSubscriptionByDaysNoon(current, parsed.data.extend_days ?? 30);
  if (await usePortalSubscribersData(tenant)) {
    await pool.execute(
      `UPDATE subscribers SET expiration_date = ?, status = 'active' WHERE id = ? AND tenant_id = ?`,
      [next, req.params.id, tenant]
    );
  } else {
    await pool.execute(`UPDATE rm_users SET expiration = ?, enableuser = 1 WHERE username = ?`, [
      next,
      req.params.id,
    ]);
  }
  try {
    assertRadiusPush(await pushRadiusForSubscriber(pool, radius, tenant, req.params.id));
    const un = await resolveUsernameForSubscriberId(tenant, req.params.id);
    if (un) {
      await disconnectBySystemPolicy(tenant, un, "activation");
    }
  } catch (e) {
    console.error("[subscribers] renew: radius push failed", e);
    res.status(502).json({
      error: "radius_sync_failed",
      detail: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  await writeAuditLog(pool, {
    tenantId: tenant,
    staffId: req.auth!.sub,
    action: "renew",
    entityType: "subscriber",
    entityId: req.params.id,
    payload: { extend_days: parsed.data.extend_days ?? 30, paid_invoice_id: parsed.data.paid_invoice_id ?? null },
  });
  res.json({ expiration_date: next.toISOString() });
  }
);

export default router;
