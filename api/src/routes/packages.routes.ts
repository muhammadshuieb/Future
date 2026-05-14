import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { parseRateLimitToBitsPerSecPair } from "../lib/radius-attr-format.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import { RadiusSyncService } from "../services/radius-sync.service.js";

const router = Router();
const radiusSync = new RadiusSyncService(pool);

router.use(requireAuth);

const currencySchema = z.enum(["USD", "SYP", "TRY"]);
const accountTypeSchema = z.enum(["subscriptions", "cards"]);

const packagesQuerySchema = z.object({
  account_type: z.enum(["all", "subscriptions", "cards"]).optional().default("all"),
});

const packageBody = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  mikrotik_rate_limit: z.string().nullable().optional(),
  framed_ip_address: z.string().nullable().optional(),
  mikrotik_address_list: z.string().nullable().optional(),
  default_framed_pool: z.string().nullable().optional(),
  simultaneous_use: z.number().int().min(1).optional(),
  quota_total_bytes: z.union([z.string(), z.number()]).optional(),
  billing_period_days: z.number().int().min(1).optional(),
  price: z.number().optional(),
  currency: currencySchema.optional(),
  account_type: accountTypeSchema.optional(),
  active: z.boolean().optional(),
});

function normalizeCurrency(raw: unknown): "USD" | "SYP" | "TRY" {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "SYP" || value === "TRY") return value;
  return "USD";
}

function quotaToString(value: unknown): string {
  if (value == null || value === "") return "0";
  try {
    return BigInt(String(value)).toString();
  } catch {
    throw new Error("quota_total_bytes must be a whole number");
  }
}

function rowBitsPerSec(value: unknown): number {
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** When `mikrotik_rate_limit` is set, derive DL/UL bit/s for the panel so it matches the string (legacy downrate/uprate are often 0). */
function enrichPackageRow(row: RowDataPacket): RowDataPacket {
  const pair = parseRateLimitToBitsPerSecPair(String(row.mikrotik_rate_limit ?? "").trim());
  const hasParsed = pair != null && (pair.down > 0 || pair.up > 0);
  if (hasParsed && pair) {
    return { ...row, downrate: pair.down, uprate: pair.up };
  }
  return { ...row, downrate: rowBitsPerSec(row.downrate), uprate: rowBitsPerSec(row.uprate) };
}

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res) => {
  const parsed = packagesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  const where = ["tenant_id = ?"];
  const params: unknown[] = [req.auth!.tenantId];
  if (parsed.data.account_type !== "all") {
    where.push("account_type = ?");
    params.push(parsed.data.account_type);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM packages WHERE ${where.join(" AND ")} ORDER BY name`,
    params
  );
  res.json({ items: rows.map((row) => enrichPackageRow(row)) });
});

router.post("/", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  const parsed = packageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = randomUUID();
  const body = parsed.data;
  let quota: string;
  try {
    quota = quotaToString(body.quota_total_bytes);
  } catch (error) {
    res.status(400).json({ error: "invalid_quota", detail: (error as Error).message });
    return;
  }
  const fields = [
    "id",
    "tenant_id",
    "name",
    "description",
    "mikrotik_rate_limit",
    "framed_ip_address",
    "mikrotik_address_list",
    "default_framed_pool",
    "simultaneous_use",
    "quota_total_bytes",
    "billing_period_days",
    "price",
    "currency",
    "account_type",
    "active",
  ] as const;
  const row: Array<string | number | null> = [
    id,
    req.auth!.tenantId,
    body.name,
    body.description ?? null,
    body.mikrotik_rate_limit ?? null,
    body.framed_ip_address ?? null,
    body.mikrotik_address_list ?? null,
    body.default_framed_pool ?? null,
    body.simultaneous_use ?? 1,
    quota,
    body.billing_period_days ?? 30,
    body.price ?? 0,
    normalizeCurrency(body.currency),
    body.account_type ?? "subscriptions",
    body.active === false ? 0 : 1,
  ];
  await pool.execute(
    `INSERT INTO packages (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
    row
  );
  await radiusSync.syncPackage(id, req.auth!.tenantId);
  res.status(201).json({ id });
});

router.patch("/:id", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  const parsed = packageBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM packages WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [req.params.id, req.auth!.tenantId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const body = parsed.data;
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (body.name !== undefined) set("name", body.name);
  if (body.description !== undefined) set("description", body.description);
  if (body.mikrotik_rate_limit !== undefined) set("mikrotik_rate_limit", body.mikrotik_rate_limit);
  if (body.framed_ip_address !== undefined) set("framed_ip_address", body.framed_ip_address);
  if (body.mikrotik_address_list !== undefined) set("mikrotik_address_list", body.mikrotik_address_list);
  if (body.default_framed_pool !== undefined) set("default_framed_pool", body.default_framed_pool);
  if (body.simultaneous_use !== undefined) set("simultaneous_use", body.simultaneous_use);
  if (body.quota_total_bytes !== undefined) {
    try {
      set("quota_total_bytes", quotaToString(body.quota_total_bytes));
    } catch (error) {
      res.status(400).json({ error: "invalid_quota", detail: (error as Error).message });
      return;
    }
  }
  if (body.billing_period_days !== undefined) set("billing_period_days", body.billing_period_days);
  if (body.price !== undefined) set("price", body.price);
  if (body.currency !== undefined) set("currency", normalizeCurrency(body.currency));
  if (body.account_type !== undefined) set("account_type", body.account_type);
  if (body.active !== undefined) set("active", body.active ? 1 : 0);
  if (sets.length) {
    await pool.execute(
      `UPDATE packages SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      [...values, req.params.id, req.auth!.tenantId] as Array<string | number | null>
    );
    await radiusSync.syncPackage(req.params.id, req.auth!.tenantId);
  }
  res.json({ ok: true });
});

router.delete("/:id", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  await pool.execute(`DELETE FROM packages WHERE id = ? AND tenant_id = ?`, [req.params.id, req.auth!.tenantId]);
  await radiusSync.syncAll(req.auth!.tenantId);
  res.json({ ok: true });
});

export default router;
