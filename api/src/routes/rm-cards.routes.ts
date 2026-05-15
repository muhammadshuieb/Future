import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import { CoaService } from "../services/coa.service.js";
import { RadiusService } from "../services/radius.service.js";
import { syncRmCardToRadius } from "../services/rm-card-radius-sync.service.js";
import { writeAuditLog } from "../services/audit-log.service.js";
import { writeFinancialAudit } from "../services/financial-audit.service.js";
import { withTransaction } from "../db/transaction.js";
import { requestHasIspPermission } from "../lib/isp-permissions.js";
import { ManagerBalanceError } from "../services/manager-wallet-ledger.service.js";
import {
  bulkDeleteRmCards,
  createRmCardBatch,
  deleteExpiredRmCards,
  deleteRmCard,
  deleteRmCardSeries,
  ensureRmCardsTable,
  getRmCardStats,
  listCardsBySeries,
  listRmCards,
  listRmCardSeries,
  setRmCardEnabled,
  updateRmCard,
} from "../services/rm-cards.service.js";

const router = Router();
router.use(requireAuth);

const listQuery = z.object({
  page: z.coerce.number().int().positive().max(10_000).optional().default(1),
  per_page: z.coerce.number().int().positive().max(500).optional().default(25),
  sort_key: z.string().optional().default("generated_on"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("desc"),
  q: z.string().optional(),
  status: z.enum(["all", "active", "expired", "disabled"]).optional().default("all"),
  service_id: z.string().optional(),
});

const batchBody = z.object({
  quantity: z.number().int().min(1).max(500),
  card_type: z.enum(["classic", "refill"]),
  gross_card_value: z.number().min(0),
  valid_till: z.string().min(1),
  prefix: z.string().min(1).max(16),
  pin_length: z.number().int().min(4).max(16),
  password_length: z.number().int().min(4).max(8),
  package_id: z.string().uuid().optional(),
  service_id: z.union([z.string().uuid(), z.number()]).optional(),
  download_limit_mb: z.number().int().min(0).optional().default(0),
  upload_limit_mb: z.number().int().min(0).optional().default(0),
  total_limit_mb: z.number().int().min(0).optional().default(0),
  online_time_limit: z.number().int().min(0).optional().default(0),
  available_time_from_activation: z.number().int().min(0).optional().default(0),
  simultaneous_use: z.number().int().min(1).max(32).optional().default(1),
  kind: z.enum(["print", "sale"]).optional().default("print"),
  client_batch_key: z.string().min(1).max(64).optional(),
});

const patchCardBody = z.object({
  password: z.string().min(1).max(64).optional(),
  value: z.number().min(0).optional(),
  expiration: z.string().min(1).optional(),
  package_id: z.string().uuid().nullable().optional(),
  active: z.number().int().min(0).max(1).optional(),
  revoked: z.number().int().min(0).max(1).optional(),
});

const bulkDeleteBody = z.object({
  ids: z.array(z.number().int().positive()).optional(),
  all_matching: z.boolean().optional(),
  q: z.string().optional(),
  status: z.enum(["all", "active", "expired", "disabled"]).optional(),
  service_id: z.union([z.string(), z.number()]).optional(),
  exclude_ids: z.array(z.number().int().positive()).optional(),
});

function resolvePackageId(body: { package_id?: string; service_id?: string | number }): string | null {
  if (body.package_id?.trim()) return body.package_id.trim();
  if (typeof body.service_id === "string" && body.service_id.includes("-")) return body.service_id;
  return null;
}

router.get("/cards", requireRole("admin", "manager", "accountant", "viewer"), async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }
    const q = parsed.data;
    const result = await listRmCards(pool, req.auth!.tenantId, {
      page: q.page,
      perPage: q.per_page,
      q: q.q,
      status: q.status === "all" ? undefined : q.status,
      serviceId: q.service_id,
      sortKey: q.sort_key ?? "generated_on",
      sortDir: q.sort_dir,
    });
    res.json({ items: result.items, meta: { total: result.total } });
  } catch (e) {
    next(e);
  }
});

router.delete("/cards-expired", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const deleted = await deleteExpiredRmCards(pool, req.auth!.tenantId, {
      coa: new CoaService(pool),
      radius: new RadiusService(pool),
    });
    res.json({ ok: true, terminated: deleted });
  } catch (e) {
    next(e);
  }
});

router.post("/cards/bulk-delete", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const parsed = bulkDeleteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const deleted = await bulkDeleteRmCards(pool, req.auth!.tenantId, {
      ids: parsed.data.ids,
      all_matching: parsed.data.all_matching,
      q: parsed.data.q,
      status: parsed.data.status,
      service_id: parsed.data.service_id,
      exclude_ids: parsed.data.exclude_ids,
    });
    res.json({ ok: true, deleted });
  } catch (e) {
    next(e);
  }
});

router.get("/cards/:id/stats", requireRole("admin", "manager", "accountant", "viewer"), async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const cardId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(cardId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const stats = await getRmCardStats(pool, req.auth!.tenantId, cardId);
    if (!stats) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(stats);
  } catch (e) {
    next(e);
  }
});

router.patch("/cards/:id", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const cardId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(cardId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = patchCardBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const ok = await updateRmCard(pool, req.auth!.tenantId, cardId, parsed.data);
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete("/cards/:id", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const cardId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(cardId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const ok = await deleteRmCard(pool, req.auth!.tenantId, cardId);
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/cards/:id/enable", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const cardId = Number.parseInt(req.params.id, 10);
    const ok = await setRmCardEnabled(pool, req.auth!.tenantId, cardId, true);
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/cards/:id/disable", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const cardId = Number.parseInt(req.params.id, 10);
    const ok = await setRmCardEnabled(pool, req.auth!.tenantId, cardId, false);
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/", requireRole("admin", "manager", "accountant", "viewer"), async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }
    const q = parsed.data;
    const result = await listRmCardSeries(pool, req.auth!.tenantId, {
      page: q.page,
      perPage: q.per_page,
      sortKey: q.sort_key ?? "generated_on",
      sortDir: q.sort_dir,
    });
    res.json({ items: result.items, meta: { total: result.total } });
  } catch (e) {
    next(e);
  }
});

router.post("/batch", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const parsed = batchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const kind = parsed.data.kind ?? "print";
    if (req.auth!.role === "manager") {
      if (kind === "sale" && !requestHasIspPermission(req, "prepaid_cards:sell")) {
        res.status(403).json({ error: "forbidden", detail: "prepaid_cards:sell" });
        return;
      }
      if (kind !== "sale" && !requestHasIspPermission(req, "prepaid_cards:print")) {
        res.status(403).json({ error: "forbidden", detail: "prepaid_cards:print" });
        return;
      }
    }
    const packageId = resolvePackageId(parsed.data);
    if (!packageId) {
      res.status(400).json({ error: "package_required" });
      return;
    }
    const tenantId = req.auth!.tenantId;
    let result: Awaited<ReturnType<typeof createRmCardBatch>>;
    try {
      result = await withTransaction(async (conn) =>
        createRmCardBatch(conn, pool, tenantId, {
          quantity: parsed.data.quantity,
          card_type: parsed.data.card_type,
          gross_card_value: parsed.data.gross_card_value,
          valid_till: parsed.data.valid_till,
          prefix: parsed.data.prefix,
          pin_length: parsed.data.pin_length,
          password_length: parsed.data.password_length,
          package_id: packageId,
          download_limit_mb: parsed.data.download_limit_mb ?? 0,
          upload_limit_mb: parsed.data.upload_limit_mb ?? 0,
          total_limit_mb: parsed.data.total_limit_mb ?? 0,
          online_time_limit: parsed.data.online_time_limit ?? 0,
          available_time_from_activation: parsed.data.available_time_from_activation ?? 0,
          simultaneous_use: parsed.data.simultaneous_use ?? 1,
        }, {
          role: req.auth!.role,
          sub: req.auth!.sub,
          kind,
          client_batch_key: parsed.data.client_batch_key ?? null,
        })
      );
    } catch (e) {
      if (e instanceof ManagerBalanceError && e.code === "insufficient_balance") {
        res.status(402).json({ error: "insufficient_manager_balance" });
        return;
      }
      if (e instanceof Error && e.message === "prepaid_print_disabled") {
        res.status(403).json({ error: "prepaid_print_disabled" });
        return;
      }
      if (e instanceof Error && e.message === "prepaid_sell_disabled") {
        res.status(403).json({ error: "prepaid_sell_disabled" });
        return;
      }
      throw e;
    }
    for (const task of result.syncTasks) {
      await syncRmCardToRadius(pool, task).catch((err) => {
        console.error("[rm-cards] radius sync after batch failed", err);
      });
    }
    if (!result.idempotent) {
      void writeFinancialAudit(pool, {
        tenantId: req.auth!.tenantId,
        staffId: req.auth!.sub,
        action: "prepaid_card_batch",
        entityType: "prepaid_card_batches",
        entityId: result.batch_id,
        payload: {
          series: result.series,
          created: result.created,
          kind,
          idempotent: false,
          ledger_id: result.ledger_id,
        },
        ip: req.ip,
      });
      void writeAuditLog(pool, {
        tenantId: req.auth!.tenantId,
        staffId: req.auth!.sub,
        action: "prepaid_card_batch",
        entityType: "rm_cards_series",
        entityId: result.series,
        payload: { created: result.created, batch_id: result.batch_id, kind },
      });
    }
    const status = result.idempotent ? 200 : 201;
    res.status(status).json({
      created: result.created,
      series: result.series,
      batch_id: result.batch_id,
      ledger_id: result.ledger_id,
      idempotent: result.idempotent ?? false,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "package_not_found") {
      res.status(400).json({ error: "package_not_found" });
      return;
    }
    next(e);
  }
});

router.get("/:series/cards", requireRole("admin", "manager", "accountant", "viewer"), async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const items = await listCardsBySeries(pool, req.auth!.tenantId, req.params.series);
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

router.delete("/:series", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res, next) => {
  try {
    await ensureRmCardsTable(pool);
    const deleted = await deleteRmCardSeries(pool, req.auth!.tenantId, req.params.series);
    if (!deleted) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true, deleted });
  } catch (e) {
    next(e);
  }
});

export default router;
