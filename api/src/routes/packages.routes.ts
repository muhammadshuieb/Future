import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { getTableColumns, hasTable, invalidateColumnCache } from "../db/schemaGuards.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const currencySchema = z.enum(["USD", "SYP"]);

router.use(requireAuth);

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  try {
    if (!(await hasTable(pool, "packages"))) {
      res.json({ items: [] });
      return;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM packages WHERE tenant_id = ? ORDER BY name`,
      [req.auth!.tenantId]
    );
    res.json({ items: rows });
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
  rm_srvid: z.number().int().nullable().optional(),
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
      res.status(503).json({
        error: "packages_table_missing",
        detail: "Apply sql/schema_extensions.sql to database `radius`",
      });
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
    push("currency", b.currency ?? "USD");
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

export default router;
