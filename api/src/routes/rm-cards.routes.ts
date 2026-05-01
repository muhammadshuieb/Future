import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import { CoaService } from "../services/coa.service.js";
import { RadiusService } from "../services/radius.service.js";

const router = Router();
const coa = new CoaService(pool);
const radius = new RadiusService(pool);
router.use(requireAuth);
const seriesParamSchema = z.object({
  series: z.string().trim().min(1).max(64),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(500).default(25),
  sort_key: z
    .enum(["series", "card_type", "generated_on", "valid_till", "gross_card_value", "quantity", "service_name"])
    .optional()
    .default("generated_on"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("desc"),
});
const cardsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().trim().max(64).optional(),
  status: z.enum(["all", "active", "expired", "disabled"]).optional().default("all"),
  service_id: z.coerce.number().int().min(0).optional(),
  sort_key: z
    .enum(["id", "cardnum", "series", "service_name", "value", "total_limit_mb", "generated_on", "valid_till", "status"])
    .optional()
    .default("generated_on"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("desc"),
});
const bulkDeleteCardsBody = z.object({
  ids: z.array(z.coerce.number().int().positive()).max(5000).optional(),
  all_matching: z.boolean().optional().default(false),
  q: z.string().trim().max(64).optional(),
  status: z.enum(["all", "active", "expired"]).optional().default("all"),
  service_id: z.coerce.number().int().min(0).optional(),
  exclude_ids: z.array(z.coerce.number().int().positive()).max(5000).optional().default([]),
});
const cardIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
const updateCardBody = z.object({
  password: z.string().trim().min(1).max(64).optional(),
  value: z.coerce.number().min(0).optional(),
  expiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  srvid: z.coerce.number().int().min(0).optional(),
  active: z.coerce.number().int().min(0).max(1).optional(),
  revoked: z.coerce.number().int().min(0).max(1).optional(),
});

function buildCardsWhere(input: {
  q?: string;
  status?: "all" | "active" | "expired" | "disabled";
  service_id?: number;
  exclude_ids?: number[];
}): { where: string[]; params: unknown[] } {
  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  const q = input.q?.trim() ?? "";
  if (q) {
    where.push("(c.cardnum LIKE ? OR c.series LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like);
  }
  if (input.status === "active") {
    where.push("c.expiration >= CURDATE() AND COALESCE(c.revoked,0) = 0 AND COALESCE(c.active,1) = 1");
  } else if (input.status === "expired") {
    where.push("c.expiration < CURDATE()");
  } else if (input.status === "disabled") {
    where.push("c.expiration >= CURDATE() AND (COALESCE(c.revoked,0) = 1 OR COALESCE(c.active,1) = 0)");
  }
  if (input.service_id !== undefined) {
    where.push("c.srvid = ?");
    params.push(input.service_id);
  }
  if (input.exclude_ids && input.exclude_ids.length) {
    const placeholders = input.exclude_ids.map(() => "?").join(",");
    where.push(`c.id NOT IN (${placeholders})`);
    params.push(...input.exclude_ids);
  }
  return { where, params };
}

router.get("/", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  if (!(await hasTable(pool, "rm_cards"))) {
    res.json({ items: [], meta: { page: 1, per_page: parsed.data.per_page, total: 0 } });
    return;
  }
  const page = parsed.data.page;
  const perPage = parsed.data.per_page;
  const sortKey = parsed.data.sort_key;
  const sortDir = parsed.data.sort_dir.toUpperCase() === "ASC" ? "ASC" : "DESC";
  const offset = (page - 1) * perPage;
  const hasServices = await hasTable(pool, "rm_services");
  const joinService = hasServices ? "LEFT JOIN rm_services s ON s.srvid = c.srvid" : "";
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT series) AS c FROM rm_cards`
  );
  const total = Number(countRows[0]?.c ?? 0);
  const serviceExpr = hasServices ? "COALESCE(MIN(s.srvname), CAST(MIN(c.srvid) AS CHAR))" : "CAST(MIN(c.srvid) AS CHAR)";
  const sortExprByKey: Record<string, string> = {
    series: "c.series",
    card_type: "MIN(c.cardtype)",
    generated_on: "MIN(c.date)",
    valid_till: "MIN(c.expiration)",
    gross_card_value: "MIN(c.value)",
    quantity: "COUNT(*)",
    service_name: serviceExpr,
  };
  const sortExpr = sortExprByKey[sortKey] ?? "MIN(c.date)";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       c.series,
       MIN(c.cardtype) AS card_type,
       MIN(c.date) AS generated_on,
       MIN(c.expiration) AS valid_till,
       MIN(c.value) AS gross_card_value,
       COUNT(*) AS quantity,
       MIN(c.downlimit) AS download_limit_mb,
       MIN(c.uplimit) AS upload_limit_mb,
       MIN(c.comblimit) AS total_traffic_limit_mb,
       MIN(c.uptimelimit) AS online_time_limit,
       MIN(c.expiretime) AS available_time_from_activation,
       MIN(c.revoked) AS revoked,
       MIN(c.srvid) AS srvid,
       ${serviceExpr} AS service_name
     FROM rm_cards c
     ${joinService}
     GROUP BY c.series
     ORDER BY ${sortExpr} ${sortDir}, c.series DESC
     LIMIT ? OFFSET ?`,
    [perPage, offset]
  );
  res.json({ items: rows, meta: { page, per_page: perPage, total } });
});

router.get("/cards", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req, res) => {
  const parsed = cardsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  if (!(await hasTable(pool, "rm_cards"))) {
    res.json({ items: [], meta: { page: parsed.data.page, per_page: parsed.data.per_page, total: 0 } });
    return;
  }
  const page = parsed.data.page;
  const perPage = parsed.data.per_page;
  const offset = (page - 1) * perPage;
  const q = parsed.data.q?.trim() ?? "";
  const status = parsed.data.status;
  const serviceId = parsed.data.service_id;
  const sortKey = parsed.data.sort_key;
  const sortDir = parsed.data.sort_dir.toUpperCase() === "ASC" ? "ASC" : "DESC";
  const hasServices = await hasTable(pool, "rm_services");
  const joinService = hasServices ? "LEFT JOIN rm_services s ON s.srvid = c.srvid" : "";
  const { where, params } = buildCardsWhere({ q, status, service_id: serviceId });
  const statusExpr = `CASE
    WHEN c.expiration < CURDATE() THEN 'expired'
    WHEN COALESCE(c.revoked,0) = 1 OR COALESCE(c.active,1) = 0 THEN 'disabled'
    ELSE 'active'
  END`;
  const serviceExpr = hasServices ? "COALESCE(s.srvname, CAST(c.srvid AS CHAR))" : "CAST(c.srvid AS CHAR)";
  const sortExprByKey: Record<string, string> = {
    id: "c.id",
    cardnum: "c.cardnum",
    series: "c.series",
    service_name: serviceExpr,
    value: "c.value",
    total_limit_mb: "COALESCE(c.comblimit,0)",
    generated_on: "c.date",
    valid_till: "c.expiration",
    status: statusExpr,
  };
  const sortExpr = sortExprByKey[sortKey] ?? "c.date";
  const fromSql = ` FROM rm_cards c ${joinService} WHERE ${where.join(" AND ")}`;
  const [countRows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c${fromSql}`, params);
  const total = Number(countRows[0]?.c ?? 0);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       c.id,
       c.cardnum,
       c.password,
       c.series,
       c.value,
       COALESCE(c.comblimit,0) AS total_limit_mb,
       c.expiration,
       c.date,
       c.cardtype,
       c.revoked,
       c.active,
       ${statusExpr} AS status,
       c.srvid,
       ${serviceExpr} AS service_name
     ${fromSql}
     ORDER BY ${sortExpr} ${sortDir}, c.id DESC
     LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  );
  res.json({ items: rows, meta: { page, per_page: perPage, total } });
});

router.post(
  "/cards/bulk-delete",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsed = bulkDeleteCardsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (!(await hasTable(pool, "rm_cards"))) {
      res.status(503).json({ error: "rm_cards_missing" });
      return;
    }
    const body = parsed.data;
    const [
      hasRadcheck,
      hasRadreply,
      hasRadusergroup,
      hasRadacct,
      hasRadpostauth,
      hasUsageLive,
      hasUsageDaily,
      hasSubscribers,
      hasRmUsers,
    ] = await Promise.all([
      hasTable(pool, "radcheck"),
      hasTable(pool, "radreply"),
      hasTable(pool, "radusergroup"),
      hasTable(pool, "radacct"),
      hasTable(pool, "radpostauth"),
      hasTable(pool, "user_usage_live"),
      hasTable(pool, "user_usage_daily"),
      hasTable(pool, "subscribers"),
      hasTable(pool, "rm_users"),
    ]);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_rm_card_ids`);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_rm_usernames`);
      await conn.execute(`CREATE TEMPORARY TABLE tmp_bulk_rm_card_ids (id BIGINT PRIMARY KEY)`);
      if (body.all_matching) {
        const { where, params } = buildCardsWhere({
          q: body.q,
          status: body.status,
          service_id: body.service_id,
          exclude_ids: body.exclude_ids,
        });
        const sqlParams = params as Array<string | number | null>;
        await conn.execute(
          `INSERT INTO tmp_bulk_rm_card_ids (id) SELECT c.id FROM rm_cards c WHERE ${where.join(" AND ")}`,
          sqlParams
        );
      } else if (body.ids?.length) {
        const placeholders = body.ids.map(() => "(?)").join(",");
        const idParams = body.ids as Array<string | number | null>;
        await conn.execute(
          `INSERT INTO tmp_bulk_rm_card_ids (id) VALUES ${placeholders}`,
          idParams
        );
      } else {
        await conn.rollback();
        res.status(400).json({ error: "empty_selection" });
        return;
      }
      const [countRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM tmp_bulk_rm_card_ids`
      );
      const totalIds = Number(countRows[0]?.c ?? 0);
      if (!totalIds) {
        await conn.rollback();
        res.json({ ok: true, deleted_cards: 0 });
        return;
      }
      await conn.execute(`CREATE TEMPORARY TABLE tmp_bulk_rm_usernames (username VARCHAR(64) PRIMARY KEY)`);
      await conn.execute(
        `INSERT INTO tmp_bulk_rm_usernames (username)
         SELECT c.cardnum FROM rm_cards c
         INNER JOIN tmp_bulk_rm_card_ids ids ON ids.id = c.id`
      );
      if (hasRadcheck) await conn.execute(`DELETE rc FROM radcheck rc INNER JOIN tmp_bulk_rm_usernames t ON t.username = rc.username`);
      if (hasRadreply) await conn.execute(`DELETE rr FROM radreply rr INNER JOIN tmp_bulk_rm_usernames t ON t.username = rr.username`);
      if (hasRadusergroup) await conn.execute(`DELETE rug FROM radusergroup rug INNER JOIN tmp_bulk_rm_usernames t ON t.username = rug.username`);
      if (hasRadacct) await conn.execute(`DELETE ra FROM radacct ra INNER JOIN tmp_bulk_rm_usernames t ON t.username = ra.username`);
      if (hasRadpostauth) await conn.execute(`DELETE rpa FROM radpostauth rpa INNER JOIN tmp_bulk_rm_usernames t ON t.username = rpa.username`);
      if (hasUsageLive) await conn.execute(`DELETE uul FROM user_usage_live uul INNER JOIN tmp_bulk_rm_usernames t ON t.username = uul.username`);
      if (hasUsageDaily) await conn.execute(`DELETE uud FROM user_usage_daily uud INNER JOIN tmp_bulk_rm_usernames t ON t.username = uud.username`);
      if (hasSubscribers) await conn.execute(`DELETE s FROM subscribers s INNER JOIN tmp_bulk_rm_usernames t ON t.username = s.username`);
      if (hasRmUsers) await conn.execute(`DELETE u FROM rm_users u INNER JOIN tmp_bulk_rm_usernames t ON t.username = u.username`);
      const [delRes] = await conn.execute(
        `DELETE c FROM rm_cards c INNER JOIN tmp_bulk_rm_card_ids ids ON ids.id = c.id`
      );
      const deletedCards = Number((delRes as { affectedRows?: unknown }).affectedRows ?? 0);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_rm_usernames`);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_rm_card_ids`);
      await conn.commit();
      res.json({ ok: true, deleted_cards: deletedCards });
    } catch (error) {
      await conn.rollback();
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_rm_usernames`).catch(() => {});
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_bulk_rm_card_ids`).catch(() => {});
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "rm_cards_bulk_delete_failed", detail: msg });
    } finally {
      conn.release();
    }
  }
);

router.patch(
  "/cards/:id",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsedId = cardIdParamSchema.safeParse(req.params);
    if (!parsedId.success) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsedBody = updateCardBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (!(await hasTable(pool, "rm_cards"))) {
      res.status(503).json({ error: "rm_cards_missing" });
      return;
    }
    const b = parsedBody.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (b.value !== undefined) {
      sets.push("value = ?");
      vals.push(b.value);
    }
    if (b.password !== undefined) {
      sets.push("password = ?");
      vals.push(b.password);
    }
    if (b.expiration !== undefined) {
      sets.push("expiration = ?");
      vals.push(b.expiration);
    }
    if (b.srvid !== undefined) {
      sets.push("srvid = ?");
      vals.push(b.srvid);
    }
    if (b.active !== undefined) {
      sets.push("active = ?");
      vals.push(b.active);
    }
    if (b.revoked !== undefined) {
      sets.push("revoked = ?");
      vals.push(b.revoked);
    }
    if (!sets.length) {
      res.status(400).json({ error: "empty_update" });
      return;
    }
    const updateValues = [...vals, parsedId.data.id] as Array<string | number | null>;
    const [r] = await pool.execute(`UPDATE rm_cards SET ${sets.join(", ")} WHERE id = ?`, updateValues);
    const affected = Number((r as { affectedRows?: unknown }).affectedRows ?? 0);
    if (!affected) {
      res.status(404).json({ error: "card_not_found" });
      return;
    }
    res.json({ ok: true });
  }
);

router.post(
  "/cards/:id/disable",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsedId = cardIdParamSchema.safeParse(req.params);
    if (!parsedId.success) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    if (!(await hasTable(pool, "rm_cards"))) {
      res.status(503).json({ error: "rm_cards_missing" });
      return;
    }
    const tenant = req.auth!.tenantId;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT cardnum FROM rm_cards WHERE id = ? LIMIT 1`,
      [parsedId.data.id]
    );
    const username = String(rows[0]?.cardnum ?? "");
    if (!username) {
      res.status(404).json({ error: "card_not_found" });
      return;
    }
    try {
      await coa.disconnectAllSessions(username, tenant).catch(() => null);
      await radius.disableRadiusUser(username).catch(() => null);
      await pool.execute(`UPDATE rm_cards SET active = 0, revoked = 1 WHERE id = ?`, [parsedId.data.id]);
      if (await hasTable(pool, "rm_users")) {
        await pool.execute(`UPDATE rm_users SET enableuser = 0 WHERE username = ?`, [username]);
      }
      if (await hasTable(pool, "subscribers")) {
        await pool.execute(`UPDATE subscribers SET status = 'disabled' WHERE username = ?`, [username]);
      }
      res.json({ ok: true, id: parsedId.data.id, username });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "rm_card_disable_failed", detail: msg });
    }
  }
);

router.post(
  "/cards/:id/enable",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsedId = cardIdParamSchema.safeParse(req.params);
    if (!parsedId.success) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    if (!(await hasTable(pool, "rm_cards"))) {
      res.status(503).json({ error: "rm_cards_missing" });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT cardnum, expiration FROM rm_cards WHERE id = ? LIMIT 1`,
      [parsedId.data.id]
    );
    const username = String(rows[0]?.cardnum ?? "");
    const expiration = rows[0]?.expiration ? new Date(String(rows[0].expiration)) : null;
    if (!username) {
      res.status(404).json({ error: "card_not_found" });
      return;
    }
    if (!expiration || Number.isNaN(expiration.getTime()) || expiration.getTime() < Date.now()) {
      res.status(400).json({ error: "card_expired_cannot_enable" });
      return;
    }
    try {
      await pool.execute(`UPDATE rm_cards SET active = 1, revoked = 0 WHERE id = ?`, [parsedId.data.id]);
      if (await hasTable(pool, "rm_users")) {
        await pool.execute(`UPDATE rm_users SET enableuser = 1 WHERE username = ?`, [username]);
      }
      if (await hasTable(pool, "subscribers")) {
        await pool.execute(`UPDATE subscribers SET status = 'active' WHERE username = ?`, [username]);
      }
      res.json({ ok: true, id: parsedId.data.id, username });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "rm_card_enable_failed", detail: msg });
    }
  }
);

router.get(
  "/cards/:id/stats",
  routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }),
  async (req, res) => {
    const parsedId = cardIdParamSchema.safeParse(req.params);
    if (!parsedId.success) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    if (!(await hasTable(pool, "rm_cards"))) {
      res.status(503).json({ error: "rm_cards_missing" });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT cardnum, COALESCE(comblimit,0) AS total_limit_mb FROM rm_cards WHERE id = ? LIMIT 1`,
      [parsedId.data.id]
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "card_not_found" });
      return;
    }
    const username = String(row.cardnum ?? "");
    const totalLimitMb = Number(row.total_limit_mb ?? 0);
    if (!(await hasTable(pool, "radacct"))) {
      res.json({ username, total_limit_mb: totalLimitMb, usage_bytes: "0", daily_total_bytes: "0", monthly_total_bytes: "0", sessions: [] });
      return;
    }
    const [usageRows, dailyRows, monthlyRows, sessionRows] = await Promise.all([
      pool.query<RowDataPacket[]>(
        `SELECT (SUM(COALESCE(acctinputoctets,0)) + SUM(COALESCE(acctoutputoctets,0))) AS usage_bytes FROM radacct WHERE username = ?`,
        [username]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT (SUM(COALESCE(acctinputoctets,0)) + SUM(COALESCE(acctoutputoctets,0))) AS daily_total_bytes FROM radacct WHERE username = ? AND DATE(acctstarttime)=CURDATE()`,
        [username]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT (SUM(COALESCE(acctinputoctets,0)) + SUM(COALESCE(acctoutputoctets,0))) AS monthly_total_bytes FROM radacct WHERE username = ? AND DATE_FORMAT(acctstarttime,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')`,
        [username]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT
          radacctid,
          acctstarttime AS start_time,
          acctstoptime AS stop_time,
          GREATEST(COALESCE(acctsessiontime,0), COALESCE(TIMESTAMPDIFF(SECOND, acctstarttime, COALESCE(acctstoptime, NOW())), 0)) AS online_seconds,
          (COALESCE(acctinputoctets,0) + COALESCE(acctoutputoctets,0)) AS total_bytes,
          nasipaddress AS nas_ip,
          CASE WHEN acctstoptime IS NULL THEN 1 ELSE 0 END AS is_active
         FROM radacct
         WHERE username = ?
         ORDER BY acctstarttime DESC
         LIMIT 20`,
        [username]
      ),
    ]);
    res.json({
      username,
      total_limit_mb: totalLimitMb,
      usage_bytes: String(usageRows[0][0]?.usage_bytes ?? 0),
      daily_total_bytes: String(dailyRows[0][0]?.daily_total_bytes ?? 0),
      monthly_total_bytes: String(monthlyRows[0][0]?.monthly_total_bytes ?? 0),
      sessions: (sessionRows[0] ?? []).map((s) => ({
        radacctid: String(s.radacctid ?? ""),
        start_time: s.start_time ? String(s.start_time) : null,
        stop_time: s.stop_time ? String(s.stop_time) : null,
        online_seconds: Number(s.online_seconds ?? 0),
        total_bytes: String(s.total_bytes ?? 0),
        nas_ip: s.nas_ip ? String(s.nas_ip) : null,
        is_active: Number(s.is_active ?? 0) > 0,
      })),
    });
  }
);

router.delete(
  "/cards/:id",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsedId = cardIdParamSchema.safeParse(req.params);
    if (!parsedId.success) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    if (!(await hasTable(pool, "rm_cards"))) {
      res.status(503).json({ error: "rm_cards_missing" });
      return;
    }
    const [
      hasRadcheck,
      hasRadreply,
      hasRadusergroup,
      hasRadacct,
      hasRadpostauth,
      hasUsageLive,
      hasUsageDaily,
      hasSubscribers,
      hasRmUsers,
    ] = await Promise.all([
      hasTable(pool, "radcheck"),
      hasTable(pool, "radreply"),
      hasTable(pool, "radusergroup"),
      hasTable(pool, "radacct"),
      hasTable(pool, "radpostauth"),
      hasTable(pool, "user_usage_live"),
      hasTable(pool, "user_usage_daily"),
      hasTable(pool, "subscribers"),
      hasTable(pool, "rm_users"),
    ]);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT cardnum FROM rm_cards WHERE id = ? LIMIT 1`,
        [parsedId.data.id]
      );
      const username = String(rows[0]?.cardnum ?? "");
      if (!username) {
        await conn.rollback();
        res.status(404).json({ error: "card_not_found" });
        return;
      }
      if (hasRadcheck) await conn.execute(`DELETE FROM radcheck WHERE username = ?`, [username]);
      if (hasRadreply) await conn.execute(`DELETE FROM radreply WHERE username = ?`, [username]);
      if (hasRadusergroup) await conn.execute(`DELETE FROM radusergroup WHERE username = ?`, [username]);
      if (hasRadacct) await conn.execute(`DELETE FROM radacct WHERE username = ?`, [username]);
      if (hasRadpostauth) await conn.execute(`DELETE FROM radpostauth WHERE username = ?`, [username]);
      if (hasUsageLive) await conn.execute(`DELETE FROM user_usage_live WHERE username = ?`, [username]);
      if (hasUsageDaily) await conn.execute(`DELETE FROM user_usage_daily WHERE username = ?`, [username]);
      if (hasSubscribers) await conn.execute(`DELETE FROM subscribers WHERE username = ?`, [username]);
      if (hasRmUsers) await conn.execute(`DELETE FROM rm_users WHERE username = ?`, [username]);
      await conn.execute(`DELETE FROM rm_cards WHERE id = ?`, [parsedId.data.id]);
      await conn.commit();
      res.json({ ok: true, id: parsedId.data.id });
    } catch (error) {
      await conn.rollback();
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "rm_card_delete_failed", detail: msg });
    } finally {
      conn.release();
    }
  }
);

router.delete(
  "/cards-expired",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (_req, res) => {
    if (!(await hasTable(pool, "rm_cards"))) {
      res.status(503).json({ error: "rm_cards_missing" });
      return;
    }
    const [
      hasRadcheck,
      hasRadreply,
      hasRadusergroup,
      hasRadacct,
      hasRadpostauth,
      hasUsageLive,
      hasUsageDaily,
      hasSubscribers,
      hasRmUsers,
    ] = await Promise.all([
      hasTable(pool, "radcheck"),
      hasTable(pool, "radreply"),
      hasTable(pool, "radusergroup"),
      hasTable(pool, "radacct"),
      hasTable(pool, "radpostauth"),
      hasTable(pool, "user_usage_live"),
      hasTable(pool, "user_usage_daily"),
      hasTable(pool, "subscribers"),
      hasTable(pool, "rm_users"),
    ]);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_expired_cards_usernames`);
      await conn.execute(
        `CREATE TEMPORARY TABLE tmp_expired_cards_usernames (username VARCHAR(64) PRIMARY KEY)`
      );
      await conn.execute(
        `INSERT INTO tmp_expired_cards_usernames (username)
         SELECT cardnum FROM rm_cards
         WHERE expiration < CURDATE() OR COALESCE(revoked,0) = 1 OR COALESCE(active,1) = 0`
      );
      const [countRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM tmp_expired_cards_usernames`
      );
      const totalUsers = Number(countRows[0]?.c ?? 0);
      if (!totalUsers) {
        await conn.rollback();
        res.json({ ok: true, deleted_series: 0, deleted_cards: 0 });
        return;
      }
      if (hasRadcheck) await conn.execute(`DELETE rc FROM radcheck rc INNER JOIN tmp_expired_cards_usernames t ON t.username = rc.username`);
      if (hasRadreply) await conn.execute(`DELETE rr FROM radreply rr INNER JOIN tmp_expired_cards_usernames t ON t.username = rr.username`);
      if (hasRadusergroup) await conn.execute(`DELETE rug FROM radusergroup rug INNER JOIN tmp_expired_cards_usernames t ON t.username = rug.username`);
      if (hasRadacct) await conn.execute(`DELETE ra FROM radacct ra INNER JOIN tmp_expired_cards_usernames t ON t.username = ra.username`);
      if (hasRadpostauth) await conn.execute(`DELETE rpa FROM radpostauth rpa INNER JOIN tmp_expired_cards_usernames t ON t.username = rpa.username`);
      if (hasUsageLive) await conn.execute(`DELETE uul FROM user_usage_live uul INNER JOIN tmp_expired_cards_usernames t ON t.username = uul.username`);
      if (hasUsageDaily) await conn.execute(`DELETE uud FROM user_usage_daily uud INNER JOIN tmp_expired_cards_usernames t ON t.username = uud.username`);
      if (hasSubscribers) await conn.execute(`DELETE s FROM subscribers s INNER JOIN tmp_expired_cards_usernames t ON t.username = s.username`);
      if (hasRmUsers) await conn.execute(`DELETE u FROM rm_users u INNER JOIN tmp_expired_cards_usernames t ON t.username = u.username`);
      const [seriesRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT series) AS c FROM rm_cards
         WHERE expiration < CURDATE() OR COALESCE(revoked,0) = 1 OR COALESCE(active,1) = 0`
      );
      const deletedSeries = Number(seriesRows[0]?.c ?? 0);
      const [deleteRes] = await conn.execute(
        `DELETE FROM rm_cards
         WHERE expiration < CURDATE() OR COALESCE(revoked,0) = 1 OR COALESCE(active,1) = 0`
      );
      const deletedCards = Number((deleteRes as { affectedRows?: unknown }).affectedRows ?? 0);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_expired_cards_usernames`);
      await conn.commit();
      res.json({ ok: true, deleted_series: deletedSeries, deleted_cards: deletedCards });
    } catch (error) {
      await conn.rollback();
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_expired_cards_usernames`).catch(() => {});
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "rm_cards_delete_expired_failed", detail: msg });
    } finally {
      conn.release();
    }
  }
);

router.get(
  "/:series/cards",
  routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }),
  async (req, res) => {
    const parsed = seriesParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_series" });
      return;
    }
    if (!(await hasTable(pool, "rm_cards"))) {
      res.status(503).json({ error: "rm_cards_missing" });
      return;
    }
    const hasServices = await hasTable(pool, "rm_services");
    const joinService = hasServices ? "LEFT JOIN rm_services s ON s.srvid = c.srvid" : "";
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         c.id,
         c.series,
         c.cardnum,
         c.password,
         c.value,
         c.expiration,
         c.date,
         c.cardtype,
         c.srvid,
         ${hasServices ? "COALESCE(s.srvname, CAST(c.srvid AS CHAR))" : "CAST(c.srvid AS CHAR)"} AS service_name
       FROM rm_cards c
       ${joinService}
       WHERE c.series = ?
       ORDER BY c.id ASC`,
      [parsed.data.series]
    );
    if (!rows.length) {
      res.status(404).json({ error: "series_not_found" });
      return;
    }
    res.json({ items: rows });
  }
);

const createBatchBody = z.object({
  quantity: z.number().int().min(1).max(500),
  card_type: z.enum(["classic", "refill"]).default("classic"),
  valid_till: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gross_card_value: z.number().min(0),
  prefix: z.string().trim().max(16).optional(),
  pin_length: z.number().int().min(4).max(16).default(6),
  password_length: z.number().int().min(4).max(8).default(6),
  service_id: z.number().int().min(0),
  download_limit_mb: z.number().int().min(0).default(0),
  upload_limit_mb: z.number().int().min(0).default(0),
  total_limit_mb: z.number().int().min(0).default(0),
  online_time_limit: z.number().int().min(0).default(0),
  available_time_from_activation: z.number().int().min(0).default(0),
});

function randomDigits(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += String(Math.floor(Math.random() * 10));
  if (out[0] === "0" && len > 1) out = "1" + out.slice(1);
  return out;
}

router.post(
  "/batch",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsed = createBatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (!(await hasTable(pool, "rm_cards"))) {
      res.status(503).json({ error: "rm_cards_missing" });
      return;
    }
    const body = parsed.data;
    const today = new Date().toISOString().slice(0, 10);
    const owner = String(req.auth?.sub ?? "admin").slice(0, 64);
    const seriesCore = body.prefix?.trim() || `${today.replaceAll("-", "")}`;
    const series = `${seriesCore}-${Math.floor(Date.now() / 1000).toString().slice(-4)}`.slice(0, 16);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [maxRows] = await conn.query<RowDataPacket[]>(`SELECT COALESCE(MAX(id), 0) AS max_id FROM rm_cards`);
      let nextId = Number(maxRows[0]?.max_id ?? 0);
      const createdCards: { id: number; cardnum: string; password: string }[] = [];
      for (let i = 0; i < body.quantity; i++) {
        nextId += 1;
        const cardnum = randomDigits(body.pin_length).slice(0, 16);
        const password = randomDigits(body.password_length).slice(0, 8);
        await conn.execute(
          `INSERT INTO rm_cards
             (id, cardnum, password, value, expiration, series, date, owner, used, cardtype, revoked,
              downlimit, uplimit, comblimit, uptimelimit, srvid, transid, active, expiretime, timebaseexp, timebaseonline)
           VALUES
             (?, ?, ?, ?, ?, ?, ?, ?, '1970-01-01 00:00:00', ?, 0, ?, ?, ?, ?, ?, '', 1, ?, 0, 0)`,
          [
            nextId,
            cardnum,
            password,
            body.gross_card_value,
            body.valid_till,
            series,
            today,
            owner,
            body.card_type === "refill" ? 1 : 0,
            body.download_limit_mb,
            body.upload_limit_mb,
            body.total_limit_mb,
            body.online_time_limit,
            body.service_id,
            body.available_time_from_activation,
          ]
        );
        createdCards.push({ id: nextId, cardnum, password });
      }
      await conn.commit();
      res.status(201).json({ series, created: createdCards.length, cards: createdCards });
    } catch (error) {
      await conn.rollback();
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "rm_cards_create_failed", detail: msg });
    } finally {
      conn.release();
    }
  }
);

router.delete(
  "/:series",
  routePolicy({ allow: ["admin", "manager"], managerPermission: "manage_subscribers" }),
  async (req, res) => {
    const parsed = seriesParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_series" });
      return;
    }
    if (!(await hasTable(pool, "rm_cards"))) {
      res.status(503).json({ error: "rm_cards_missing" });
      return;
    }
    const series = parsed.data.series;
    const [
      hasRadcheck,
      hasRadreply,
      hasRadusergroup,
      hasRadacct,
      hasRadpostauth,
      hasUsageLive,
      hasUsageDaily,
      hasSubscribers,
      hasRmUsers,
      hasInvoices,
      hasPayments,
    ] = await Promise.all([
      hasTable(pool, "radcheck"),
      hasTable(pool, "radreply"),
      hasTable(pool, "radusergroup"),
      hasTable(pool, "radacct"),
      hasTable(pool, "radpostauth"),
      hasTable(pool, "user_usage_live"),
      hasTable(pool, "user_usage_daily"),
      hasTable(pool, "subscribers"),
      hasTable(pool, "rm_users"),
      hasTable(pool, "invoices"),
      hasTable(pool, "payments"),
    ]);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [checkRows] = await conn.query<RowDataPacket[]>(
        `SELECT 1 FROM rm_cards WHERE series = ? LIMIT 1`,
        [series]
      );
      if (!checkRows[0]) {
        await conn.rollback();
        res.status(404).json({ error: "series_not_found" });
        return;
      }
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_series_cards_usernames`);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_series_subscriber_ids`);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_series_invoice_ids`);
      await conn.execute(`CREATE TEMPORARY TABLE tmp_series_cards_usernames (username VARCHAR(64) PRIMARY KEY)`);
      await conn.execute(
        `INSERT INTO tmp_series_cards_usernames (username)
         SELECT cardnum FROM rm_cards WHERE series = ?`,
        [series]
      );
      await conn.execute(
        `CREATE TEMPORARY TABLE tmp_series_subscriber_ids (id VARCHAR(64) PRIMARY KEY)`
      );
      if (hasSubscribers) {
        await conn.execute(
          `INSERT INTO tmp_series_subscriber_ids (id)
           SELECT CAST(s.id AS CHAR)
           FROM subscribers s
           INNER JOIN tmp_series_cards_usernames t ON t.username = s.username`
        );
      }
      await conn.execute(
        `CREATE TEMPORARY TABLE tmp_series_invoice_ids (id VARCHAR(64) PRIMARY KEY)`
      );
      if (hasInvoices) {
        await conn.execute(
          `INSERT INTO tmp_series_invoice_ids (id)
           SELECT CAST(i.id AS CHAR)
           FROM invoices i
           INNER JOIN tmp_series_subscriber_ids sids ON sids.id = CAST(i.subscriber_id AS CHAR)`
        );
      }
      if (hasRadcheck) {
        await conn.execute(
          `DELETE rc FROM radcheck rc
           INNER JOIN tmp_series_cards_usernames t ON t.username = rc.username`
        );
      }
      if (hasRadreply) {
        await conn.execute(
          `DELETE rr FROM radreply rr
           INNER JOIN tmp_series_cards_usernames t ON t.username = rr.username`
        );
      }
      if (hasRadusergroup) {
        await conn.execute(
          `DELETE rug FROM radusergroup rug
           INNER JOIN tmp_series_cards_usernames t ON t.username = rug.username`
        );
      }
      if (hasUsageLive) {
        await conn.execute(
          `DELETE uul FROM user_usage_live uul
           INNER JOIN tmp_series_cards_usernames t ON t.username = uul.username`
        );
      }
      if (hasUsageDaily) {
        await conn.execute(
          `DELETE uud FROM user_usage_daily uud
           INNER JOIN tmp_series_cards_usernames t ON t.username = uud.username`
        );
      }
      if (hasSubscribers) {
        await conn.execute(
          `DELETE s FROM subscribers s
           INNER JOIN tmp_series_cards_usernames t ON t.username = s.username`
        );
      }
      if (hasRmUsers) {
        await conn.execute(
          `DELETE u FROM rm_users u
           INNER JOIN tmp_series_cards_usernames t ON t.username = u.username`
        );
      }
      if (hasRadacct) {
        await conn.execute(
          `DELETE ra FROM radacct ra
           INNER JOIN tmp_series_cards_usernames t ON t.username = ra.username`
        );
      }
      if (hasRadpostauth) {
        await conn.execute(
          `DELETE rpa FROM radpostauth rpa
           INNER JOIN tmp_series_cards_usernames t ON t.username = rpa.username`
        );
      }
      if (hasPayments) {
        await conn.execute(
          `DELETE p FROM payments p
           INNER JOIN tmp_series_invoice_ids iids ON iids.id = CAST(p.invoice_id AS CHAR)`
        );
      }
      if (hasInvoices) {
        await conn.execute(
          `DELETE i FROM invoices i
           INNER JOIN tmp_series_subscriber_ids sids ON sids.id = CAST(i.subscriber_id AS CHAR)`
        );
      }
      const [result] = await conn.execute(`DELETE FROM rm_cards WHERE series = ?`, [series]);
      const deletedCards = Number((result as { affectedRows?: unknown }).affectedRows ?? 0);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_series_invoice_ids`);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_series_subscriber_ids`);
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_series_cards_usernames`);
      await conn.commit();
      res.json({ ok: true, deleted_cards: deletedCards, series, full_cleanup: true });
    } catch (error) {
      await conn.rollback();
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_series_invoice_ids`).catch(() => {});
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_series_subscriber_ids`).catch(() => {});
      await conn.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_series_cards_usernames`).catch(() => {});
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "rm_cards_delete_failed", detail: msg });
    } finally {
      conn.release();
    }
  }
);

export default router;
