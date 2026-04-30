import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { getTableColumns, hasTable, invalidateColumnCache } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const currencySchema = z.enum(["USD", "SYP", "TRY"]);
const accountTypeSchema = z.enum(["subscriptions", "cards"]);
const rmServiceScopesSchema = z.object({
  allowed_nas_ids: z.array(z.string()).optional(),
  available_manager_names: z.array(z.string()).optional(),
});
const packagesQuerySchema = z.object({
  account_type: z.enum(["all", "subscriptions", "cards"]).optional().default("all"),
});

router.use(requireAuth);

function normalizeCurrencyCode(raw: unknown): "USD" | "SYP" | "TRY" {
  const c = String(raw ?? "").trim().toUpperCase();
  if (c === "TRY" || c === "TL" || c === "TR") return "TRY";
  if (c === "SYP") return "SYP";
  return "USD";
}

async function syncRmServiceScopes(
  srvid: number,
  input: { allowed_nas_ids?: string[]; available_manager_names?: string[] }
): Promise<void> {
  if (input.allowed_nas_ids !== undefined && (await hasTable(pool, "rm_allowednases"))) {
    await pool.execute(`DELETE FROM rm_allowednases WHERE srvid = ?`, [srvid]);
    const uniqueNasIds = Array.from(
      new Set(
        input.allowed_nas_ids
          .map((v) => Number.parseInt(String(v), 10))
          .filter((v) => Number.isFinite(v) && v >= 0)
      )
    );
    for (const nasid of uniqueNasIds) {
      await pool.execute(`INSERT INTO rm_allowednases (srvid, nasid) VALUES (?, ?)`, [srvid, nasid]);
    }
  }
  if (input.available_manager_names !== undefined && (await hasTable(pool, "rm_allowedmanagers"))) {
    await pool.execute(`DELETE FROM rm_allowedmanagers WHERE srvid = ?`, [srvid]);
    const uniqueManagers = Array.from(
      new Set(input.available_manager_names.map((v) => String(v ?? "").trim()).filter(Boolean))
    );
    for (const managername of uniqueManagers) {
      await pool.execute(`INSERT INTO rm_allowedmanagers (srvid, managername) VALUES (?, ?)`, [
        srvid,
        managername,
      ]);
    }
  }
}

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  try {
    const queryParsed = packagesQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }
    const accountTypeFilter = queryParsed.data.account_type;
    if (await hasTable(pool, "packages")) {
      const packageCols = await getTableColumns(pool, "packages");
      const where = [`tenant_id = ?`];
      const params: unknown[] = [req.auth!.tenantId];
      if (packageCols.has("account_type") && accountTypeFilter !== "all") {
        where.push(`COALESCE(account_type, 'subscriptions') = ?`);
        params.push(accountTypeFilter);
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM packages WHERE ${where.join(" AND ")} ORDER BY name`,
        params
      );
      res.json({ items: rows });
      return;
    }
    if (!(await hasTable(pool, "rm_services"))) {
      res.json({ items: [] });
      return;
    }
    let rmDefaultCurrency: "USD" | "SYP" | "TRY" = "USD";
    if (await hasTable(pool, "rm_settings")) {
      const [rmSettingsRows] = await pool.query<RowDataPacket[]>(
        `SELECT currency FROM rm_settings LIMIT 1`
      );
      rmDefaultCurrency = normalizeCurrencyCode(rmSettingsRows[0]?.currency);
    }
    const rmWhere = accountTypeFilter === "cards" ? "AND srvtype = 1" : accountTypeFilter === "subscriptions" ? "AND srvtype <> 1" : "";
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT CAST(srvid AS CHAR) AS id,
              srvname AS name,
              unitprice AS price,
              ? AS currency,
              CONCAT(COALESCE(downrate,0), '/', COALESCE(uprate,0)) AS mikrotik_rate_limit,
              poolname AS default_framed_pool,
              30 AS billing_period_days,
              1 AS simultaneous_use,
              CASE WHEN srvtype = 1 THEN 'cards' ELSE 'subscriptions' END AS account_type,
              srvtype AS rm_srvtype,
              descr,
              downrate,
              uprate,
              poolname,
              combquota AS quota_total_bytes
       FROM rm_services
       WHERE srvid <> 0
       ${rmWhere}
       ORDER BY srvname`
      ,
      [rmDefaultCurrency]
    );
    const allowedNasMap = new Map<number, string[]>();
    if (await hasTable(pool, "rm_allowednases")) {
      const [allowedNasRows] = await pool.query<RowDataPacket[]>(
        `SELECT srvid, CAST(nasid AS CHAR) AS nasid FROM rm_allowednases`
      );
      for (const r of allowedNasRows) {
        const key = Number(r.srvid ?? -1);
        if (!allowedNasMap.has(key)) allowedNasMap.set(key, []);
        allowedNasMap.get(key)!.push(String(r.nasid ?? ""));
      }
    }
    const allowedMgrMap = new Map<number, string[]>();
    if (await hasTable(pool, "rm_allowedmanagers")) {
      const [allowedMgrRows] = await pool.query<RowDataPacket[]>(
        `SELECT srvid, managername FROM rm_allowedmanagers`
      );
      for (const r of allowedMgrRows) {
        const key = Number(r.srvid ?? -1);
        if (!allowedMgrMap.has(key)) allowedMgrMap.set(key, []);
        allowedMgrMap.get(key)!.push(String(r.managername ?? ""));
      }
    }
    const options = {
      nases: [] as { id: string; name: string }[],
      managers: [] as { id: string; name: string }[],
    };
    if (await hasTable(pool, "nas")) {
      const nasCols = await getTableColumns(pool, "nas");
      const idExpr = nasCols.has("id")
        ? "CAST(id AS CHAR)"
        : nasCols.has("nasname")
          ? "CAST(nasname AS CHAR)"
          : "'0'";
      const primaryNameExpr = nasCols.has("shortname")
        ? "NULLIF(TRIM(shortname), '')"
        : nasCols.has("description")
          ? "NULLIF(TRIM(description), '')"
          : nasCols.has("nasname")
            ? "NULLIF(TRIM(nasname), '')"
            : null;
      const fallbackNameExpr = nasCols.has("description")
        ? "NULLIF(TRIM(description), '')"
        : nasCols.has("nasname")
          ? "NULLIF(TRIM(nasname), '')"
          : nasCols.has("shortname")
            ? "NULLIF(TRIM(shortname), '')"
          : "'NAS'";
      const nameExpr = primaryNameExpr
        ? `COALESCE(${primaryNameExpr}, ${fallbackNameExpr}, ${idExpr}, 'NAS')`
        : `COALESCE(${fallbackNameExpr}, 'NAS')`;
      const orderExpr = nasCols.has("nasname")
        ? "nasname"
        : nasCols.has("shortname")
          ? "shortname"
          : nasCols.has("id")
            ? "id"
            : "1";
      const [nasRows] = await pool.query<RowDataPacket[]>(
        `SELECT ${idExpr} AS id, ${nameExpr} AS name FROM nas ORDER BY ${orderExpr}`
      );
      options.nases = nasRows.map((r) => ({
        id: String(r.id ?? ""),
        name: String(r.name ?? ""),
      }));
    }
    if (await hasTable(pool, "rm_managers")) {
      const [managerRows] = await pool.query<RowDataPacket[]>(
        `SELECT managername FROM rm_managers ORDER BY managername`
      );
      options.managers = managerRows.map((r) => ({
        id: String(r.managername ?? ""),
        name: String(r.managername ?? ""),
      }));
    }
    const items = rows.map((row) => {
      const srvid = Number(row.id ?? -1);
      return {
        ...row,
        allowed_nas_ids: allowedNasMap.get(srvid) ?? [],
        available_manager_names: allowedMgrMap.get(srvid) ?? [],
      };
    });
    res.json({ items, options });
  } catch (e) {
    console.error("packages GET", e);
    res.status(500).json({
      error: "db_error",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

const pkgBody = z.object({
  name: z.string().min(1),
  mikrotik_rate_limit: z.string().nullable().optional(),
  framed_ip_address: z.string().nullable().optional(),
  mikrotik_address_list: z.string().nullable().optional(),
  default_framed_pool: z.string().nullable().optional(),
  simultaneous_use: z.number().int().min(1).optional(),
  quota_total_bytes: z.string().optional(),
  billing_period_days: z.number().int().optional(),
  price: z.number().optional(),
  currency: currencySchema.optional(),
  account_type: accountTypeSchema.optional(),
  rm_srvid: z.number().int().nullable().optional(),
  allowed_nas_ids: z.array(z.string()).optional(),
  available_manager_names: z.array(z.string()).optional(),
});

router.post("/", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  const parsed = pkgBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = randomUUID();
  const t = req.auth!.tenantId;
  const b = parsed.data;
  let quotaBytes: bigint;
  try {
    quotaBytes = b.quota_total_bytes ? BigInt(b.quota_total_bytes) : 0n;
  } catch {
    res.status(400).json({ error: "invalid_quota", detail: "quota_total_bytes must be a whole number" });
    return;
  }
  try {
    if (!(await hasTable(pool, "packages"))) {
      if (!(await hasTable(pool, "rm_services"))) {
        res.status(503).json({
          error: "packages_table_missing",
          detail: "Neither packages nor rm_services tables are available.",
        });
        return;
      }
      const [maxRows] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(MAX(srvid), -1) + 1 AS next_id FROM rm_services`
      );
      const nextSrvid = Number(maxRows[0]?.next_id ?? 0);
      const [templateRows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM rm_services ORDER BY srvid ASC LIMIT 1`
      );
      const template = templateRows[0];
      if (!template) {
        res.status(500).json({
          error: "rm_services_template_missing",
          detail: "rm_services has no template row to clone.",
        });
        return;
      }
      const row = { ...template } as Record<string, unknown>;
      row.srvid = nextSrvid;
      row.srvname = b.name;
      row.descr = b.name;
      row.unitprice = Number(b.price ?? 0);
      row.combquota = Number(quotaBytes);
      row.srvtype = b.account_type === "cards" ? 1 : 0;
      row.monthly = 1;
      row.enableservice = 1;
      if (typeof b.mikrotik_rate_limit === "string" && b.mikrotik_rate_limit.includes("/")) {
        const [down, up] = b.mikrotik_rate_limit.split("/");
        const downNum = Number(down);
        const upNum = Number(up);
        if (Number.isFinite(downNum)) row.downrate = Math.max(0, Math.trunc(downNum));
        if (Number.isFinite(upNum)) row.uprate = Math.max(0, Math.trunc(upNum));
      }
      if (typeof b.default_framed_pool === "string") {
        row.poolname = b.default_framed_pool;
      }
      const cols = Object.keys(row);
      const values = cols.map((c) => row[c] as string | number | null);
      await pool.execute(
        `INSERT INTO rm_services (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        values
      );
      await syncRmServiceScopes(nextSrvid, {
        allowed_nas_ids: b.allowed_nas_ids,
        available_manager_names: b.available_manager_names,
      });
      res.status(201).json({ id: String(nextSrvid), rm_srvid: nextSrvid, rm_services_mode: true });
      return;
    }
    invalidateColumnCache();
    const col = await getTableColumns(pool, "packages");
    if (!col.has("id") || !col.has("tenant_id") || !col.has("name")) {
      res.status(500).json({
        error: "packages_schema",
        detail: "Table packages must have id, tenant_id, name",
      });
      return;
    }
    const fields: string[] = [];
    const vals: (string | number | Buffer | null)[] = [];
    const push = (f: string, v: string | number | Buffer | null) => {
      if (col.has(f)) {
        fields.push(f);
        vals.push(v);
      }
    };
    push("id", id);
    push("tenant_id", t);
    push("name", b.name);
    push("mikrotik_rate_limit", b.mikrotik_rate_limit ?? null);
    push("framed_ip_address", b.framed_ip_address ?? null);
    push("mikrotik_address_list", b.mikrotik_address_list ?? null);
    push("default_framed_pool", b.default_framed_pool ?? null);
    push("simultaneous_use", b.simultaneous_use ?? 1);
    push("quota_total_bytes", quotaBytes.toString());
    push("billing_period_days", b.billing_period_days ?? 30);
    push("price", b.price ?? 0);
    push("currency", normalizeCurrencyCode(b.currency ?? "USD"));
    push("account_type", b.account_type ?? "subscriptions");
    push("rm_srvid", b.rm_srvid ?? null);
    push("active", 1);
    if (fields.length < 3) {
      res.status(500).json({ error: "packages_schema", detail: "no insertable columns" });
      return;
    }
    await pool.execute(
      `INSERT INTO packages (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
      vals
    );
    res.status(201).json({ id });
  } catch (e) {
    console.error("packages POST", e);
    res.status(500).json({
      error: "db_error",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

const pkgPatch = pkgBody.partial();

router.patch(
  "/:id",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    const parsed = pkgPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (!(await hasTable(pool, "packages"))) {
      if (!(await hasTable(pool, "rm_services"))) {
        res.status(503).json({ error: "packages_table_missing" });
        return;
      }
      const srvId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(srvId)) {
        res.status(400).json({ error: "invalid_package_id" });
        return;
      }
      const [exists] = await pool.query<RowDataPacket[]>(
        `SELECT srvid FROM rm_services WHERE srvid = ? LIMIT 1`,
        [srvId]
      );
      if (!exists[0]) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const bRm = parsed.data;
      const setsRm: string[] = [];
      const valsRm: unknown[] = [];
      if (bRm.name !== undefined) {
        setsRm.push("srvname = ?", "descr = ?");
        valsRm.push(bRm.name, bRm.name);
      }
      if (bRm.price !== undefined) {
        setsRm.push("unitprice = ?");
        valsRm.push(Number(bRm.price));
      }
      if (bRm.account_type !== undefined) {
        setsRm.push("srvtype = ?");
        valsRm.push(bRm.account_type === "cards" ? 1 : 0);
      }
      if (bRm.quota_total_bytes !== undefined) {
        try {
          setsRm.push("combquota = ?");
          valsRm.push(BigInt(bRm.quota_total_bytes || "0").toString());
        } catch {
          res.status(400).json({ error: "invalid_quota" });
          return;
        }
      }
      if (bRm.default_framed_pool !== undefined) {
        setsRm.push("poolname = ?");
        valsRm.push(bRm.default_framed_pool ?? "");
      }
      if (bRm.mikrotik_rate_limit !== undefined && bRm.mikrotik_rate_limit?.includes("/")) {
        const [down, up] = bRm.mikrotik_rate_limit.split("/");
        const downNum = Number(down);
        const upNum = Number(up);
        if (Number.isFinite(downNum)) {
          setsRm.push("downrate = ?");
          valsRm.push(Math.max(0, Math.trunc(downNum)));
        }
        if (Number.isFinite(upNum)) {
          setsRm.push("uprate = ?");
          valsRm.push(Math.max(0, Math.trunc(upNum)));
        }
      }
      if (!setsRm.length) {
        const scopeParsed = rmServiceScopesSchema.safeParse(parsed.data);
        if (scopeParsed.success) {
          await syncRmServiceScopes(srvId, scopeParsed.data);
        }
        res.json({ ok: true });
        return;
      }
      await pool.execute(
        `UPDATE rm_services SET ${setsRm.join(", ")} WHERE srvid = ?`,
        [...valsRm, srvId] as Array<string | number | null>
      );
      const scopeParsed = rmServiceScopesSchema.safeParse(parsed.data);
      if (scopeParsed.success) {
        await syncRmServiceScopes(srvId, scopeParsed.data);
      }
      res.json({ ok: true, rm_services_mode: true });
      return;
    }
    const t = req.auth!.tenantId;
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM packages WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [req.params.id, t]
    );
    if (!existing[0]) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const b = parsed.data;
    invalidateColumnCache();
    const dbCol = await getTableColumns(pool, "packages");
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (cname: string, v: unknown) => {
      if (!dbCol.has(cname)) return;
      sets.push(`${cname} = ?`);
      vals.push(v);
    };
    if (b.name !== undefined) set("name", b.name);
    if (b.mikrotik_rate_limit !== undefined) set("mikrotik_rate_limit", b.mikrotik_rate_limit);
    if (b.framed_ip_address !== undefined) set("framed_ip_address", b.framed_ip_address);
    if (b.mikrotik_address_list !== undefined) set("mikrotik_address_list", b.mikrotik_address_list);
    if (b.default_framed_pool !== undefined) set("default_framed_pool", b.default_framed_pool);
    if (b.simultaneous_use !== undefined) set("simultaneous_use", b.simultaneous_use);
    if (b.quota_total_bytes !== undefined) {
      try {
        set("quota_total_bytes", BigInt(b.quota_total_bytes || "0").toString());
      } catch {
        res.status(400).json({ error: "invalid_quota" });
        return;
      }
    }
    if (b.billing_period_days !== undefined) set("billing_period_days", b.billing_period_days);
    if (b.price !== undefined) set("price", b.price);
    if (b.currency !== undefined) set("currency", b.currency);
    if (b.account_type !== undefined) set("account_type", b.account_type);
    if (b.rm_srvid !== undefined) set("rm_srvid", b.rm_srvid);
    if (!sets.length) {
      res.json({ ok: true });
      return;
    }
    try {
      await pool.query(`UPDATE packages SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, [
        ...vals,
        req.params.id,
        t,
      ]);
      res.json({ ok: true });
    } catch (e) {
      console.error("packages PATCH", e);
      res.status(500).json({
        error: "db_error",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
);

async function deletePackageById(req: Request, res: Response, rawId: string) {
  if (!(await hasTable(pool, "packages"))) {
    if (!(await hasTable(pool, "rm_services"))) {
      res.status(503).json({ error: "packages_table_missing" });
      return;
    }
    const srvId = Number.parseInt(String(rawId), 10);
    if (!Number.isFinite(srvId)) {
      res.status(400).json({ error: "invalid_package_id" });
      return;
    }
    if (srvId === 0) {
      res.status(400).json({ error: "invalid_package_id", detail: "default_template_service_protected" });
      return;
    }
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT srvid FROM rm_services WHERE srvid = ? LIMIT 1`,
      [srvId]
    );
    if (!existing[0]) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await pool.execute(`DELETE FROM rm_allowednases WHERE srvid = ?`, [srvId]);
    await pool.execute(`DELETE FROM rm_allowedmanagers WHERE srvid = ?`, [srvId]);
    await pool.execute(`DELETE FROM rm_services WHERE srvid = ?`, [srvId]);
    res.json({ ok: true, rm_services_mode: true });
    return;
  }
  const t = req.auth!.tenantId;
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM packages WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [rawId, t]
  );
  if (!existing[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await pool.execute(`DELETE FROM packages WHERE id = ? AND tenant_id = ?`, [rawId, t]);
  res.json({ ok: true });
}

router.delete(
  "/:id",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    try {
      await deletePackageById(req, res, String(req.params.id ?? ""));
    } catch (e) {
      console.error("packages DELETE", e);
      res.status(500).json({
        error: "db_error",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
);

router.delete(
  "/",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    const body = (req.body ?? {}) as { id?: string; package_id?: string; srvid?: string | number };
    const rawId = String(body.id ?? body.package_id ?? body.srvid ?? "").trim();
    if (!rawId) {
      res.status(400).json({ error: "invalid_package_id" });
      return;
    }
    try {
      await deletePackageById(req, res, rawId);
    } catch (e) {
      console.error("packages DELETE", e);
      res.status(500).json({
        error: "db_error",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
);

export default router;
