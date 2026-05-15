import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
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
    const deleted = await deleteExpiredRmCards(pool, req.auth!.tenantId);
    res.json({ ok: true, deleted });
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
    const packageId = resolvePackageId(parsed.data);
    if (!packageId) {
      res.status(400).json({ error: "package_required" });
      return;
    }
    const result = await createRmCardBatch(pool, req.auth!.tenantId, {
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
    });
    res.status(201).json(result);
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
