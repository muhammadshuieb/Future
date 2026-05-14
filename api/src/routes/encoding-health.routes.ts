import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import { hasTable } from "../db/schemaGuards.js";
import {
  approveEncodingRepair,
  ignoreEncodingIssue,
  rollbackEncodingRepair,
  runEncodingScan,
} from "../services/encoding-scan.service.js";
import {
  buildCharsetVerificationReport,
  verifyRedisUtf8Roundtrip,
  verifyWhatsAppUtf8Configured,
} from "../services/encoding-verification.service.js";
import { glyphAndEncodingPrintHint } from "../lib/encoding-mojibake.js";
import { createRedisClient } from "../lib/redis-connection.js";

const router = Router();
router.use(requireAuth);

const scanBody = z.object({
  exclude_tables: z.array(z.string().max(64)).max(80).optional(),
  limit_per_table: z.coerce.number().int().min(100).max(500_000).optional(),
  max_issues: z.coerce.number().int().min(1).max(200_000).optional(),
  dry_run: z.boolean().optional(),
});

/** Admin-only: encoding repair can change subscriber PII and financial text. */
router.use(routePolicy({ allow: ["admin"] }));

router.get("/summary", async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  if (!(await hasTable(pool, "encoding_issues"))) {
    res.json({
      ok: true,
      tables_ready: false,
      totals: { open: 0, manual_review: 0, repaired: 0, ignored: 0, superseded: 0 },
      last_scan: null,
    });
    return;
  }
  const [totals] = await pool.query<RowDataPacket[]>(
    `SELECT status, COUNT(*) AS c FROM encoding_issues WHERE tenant_id <=> ? GROUP BY status`,
    [tenantId]
  );
  const map: Record<string, number> = {};
  for (const r of totals) map[String(r.status)] = Number(r.c ?? 0);

  const [last] = await pool.query<RowDataPacket[]>(
    `SELECT id, started_at, finished_at, rows_scanned, issues_found, status
     FROM encoding_scan_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 1`,
    [tenantId]
  );
  res.json({
    ok: true,
    tables_ready: true,
    totals: {
      open: map.open ?? 0,
      manual_review: map.manual_review ?? 0,
      repaired: map.repaired ?? 0,
      ignored: map.ignored ?? 0,
      superseded: map.superseded ?? 0,
    },
    last_scan: last[0] ?? null,
  });
});

router.get("/verification", async (_req: Request, res: Response) => {
  const report = await buildCharsetVerificationReport(pool);
  let redisCheck: { ok: boolean; detail?: string } = { ok: true, detail: "skipped" };
  try {
    const redis = createRedisClient("encoding-health");
    redisCheck = await verifyRedisUtf8Roundtrip(redis);
    redis.disconnect();
  } catch {
    redisCheck = { ok: false, detail: "redis_client_failed" };
  }
  res.json({
    charset: report,
    redis_utf8: redisCheck,
    whatsapp: verifyWhatsAppUtf8Configured(),
  });
});

router.get("/diagnostics", (_req: Request, res: Response) => {
  const sample = "مرحبا — Future Radius · UTF-8 · ١٢٣";
  res.json({
    arabic_rtl_sample: sample,
    whatsapp_preview: `*تنبيه*\n${sample}\n_اختبار اتجاه النص_`,
    print_hint: glyphAndEncodingPrintHint(`${sample}\nط§ظ„ط®ط·ط£`),
    invoice_line_sample: `فاتورة #1024 — ${sample}`,
    prepaid_card_line: `بطاقة: USER123 · ${sample}`,
  });
});

router.post("/scan", async (req: Request, res: Response) => {
  const parsed = scanBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  try {
    const progress = await runEncodingScan(pool, {
      tenantId: req.auth!.tenantId,
      staffId: req.auth!.sub,
      excludeTables: parsed.data.exclude_tables,
      limitPerTable: parsed.data.limit_per_table,
      maxIssues: parsed.data.max_issues,
      dryRun: parsed.data.dry_run ?? false,
    });
    res.json({ ok: true, progress });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(40),
  status: z.enum(["open", "manual_review", "repaired", "ignored", "superseded", "all"]).default("open"),
});

router.get("/issues", async (req: Request, res: Response) => {
  if (!(await hasTable(pool, "encoding_issues"))) {
    res.json({ items: [], meta: { total: 0 } });
    return;
  }
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  const tenantId = req.auth!.tenantId;
  const { page, per_page, status } = parsed.data;
  const offset = (page - 1) * per_page;
  const where =
    status === "all" ? "WHERE tenant_id <=> ?" : "WHERE tenant_id <=> ? AND status = ?";
  const params: unknown[] = status === "all" ? [tenantId] : [tenantId, status];
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM encoding_issues ${where}`,
    params
  );
  const total = Number(countRows[0]?.c ?? 0);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, table_name, column_name, row_id, original_preview, proposed_preview, issue_type,
            confidence_score, status, repaired, detected_at, repaired_at, repair_strategy
     FROM encoding_issues ${where}
     ORDER BY detected_at DESC
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );
  res.json({ items: rows, meta: { total, page, per_page } });
});

router.post("/issues/:id/preview", async (req: Request, res: Response) => {
  const r = await approveEncodingRepair(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    issueId: req.params.id,
    commit: false,
  });
  if (!r.ok) {
    res.status(r.error === "issue_not_found" ? 404 : 400).json(r);
    return;
  }
  res.json(r);
});

router.post("/issues/:id/repair", async (req: Request, res: Response) => {
  const body = z.object({ commit: z.boolean().default(false) }).safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const r = await approveEncodingRepair(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    issueId: req.params.id,
    commit: body.data.commit,
  });
  if (!r.ok) {
    res.status(400).json(r);
    return;
  }
  res.json(r);
});

router.post("/issues/:id/rollback", async (req: Request, res: Response) => {
  const r = await rollbackEncodingRepair(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    issueId: req.params.id,
  });
  if (!r.ok) {
    res.status(400).json(r);
    return;
  }
  res.json({ ok: true });
});

router.post("/issues/:id/ignore", async (req: Request, res: Response) => {
  await ignoreEncodingIssue(pool, {
    tenantId: req.auth!.tenantId,
    staffId: req.auth!.sub,
    issueId: req.params.id,
  });
  res.json({ ok: true });
});

const bulkBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  commit: z.boolean().default(false),
});

router.post("/issues/bulk-repair", async (req: Request, res: Response) => {
  const parsed = bulkBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of parsed.data.ids) {
    const r = await approveEncodingRepair(pool, {
      tenantId: req.auth!.tenantId,
      staffId: req.auth!.sub,
      issueId: id,
      commit: parsed.data.commit,
    });
    results.push({ id, ok: r.ok, error: r.error });
  }
  res.json({ ok: true, results });
});

router.get("/export", async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  if (!(await hasTable(pool, "encoding_issues"))) {
    res.status(404).end();
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM encoding_issues WHERE tenant_id <=> ? ORDER BY detected_at DESC LIMIT 50000`,
    [tenantId]
  );
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="encoding-issues-${tenantId}.json"`);
  res.send(JSON.stringify(rows, null, 2));
});

export default router;
