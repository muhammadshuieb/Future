import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import {
  applyDueDynamicSpeeds,
  createSpeedSchedule,
  deleteSpeedSchedule,
  ensureDynamicSpeedTables,
  listSpeedSchedules,
  updateSpeedSchedule,
} from "../services/dynamic-speed.service.js";

const router = Router();

router.use(requireAuth);

const scheduleBody = z.object({
  package_id: z.string().min(1),
  name: z.string().min(1),
  rate_limit: z.string().min(1),
  days_of_week: z.array(z.number().int().min(0).max(6)).min(1),
  start_time: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/),
  priority: z.number().int().optional(),
  active: z.boolean().optional(),
  disconnect_fallback: z.boolean().optional(),
});

router.get("/schedules", requireRole("admin", "manager", "viewer"), async (req, res) => {
  try {
    const items = await listSpeedSchedules(pool, req.auth!.tenantId);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: "dynamic_speed_list_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

router.post(
  "/schedules",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    const parsed = scheduleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    try {
      const id = await createSpeedSchedule(pool, req.auth!.tenantId, parsed.data);
      res.status(201).json({ id });
    } catch (e) {
      res.status(500).json({ error: "dynamic_speed_create_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.patch(
  "/schedules/:id",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    const parsed = scheduleBody.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    try {
      const ok = await updateSpeedSchedule(pool, req.auth!.tenantId, String(req.params.id), parsed.data);
      if (!ok) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "dynamic_speed_update_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.delete(
  "/schedules/:id",
  requireRole("admin", "manager"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    try {
      const ok = await deleteSpeedSchedule(pool, req.auth!.tenantId, String(req.params.id));
      if (!ok) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "dynamic_speed_delete_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.post("/apply-now", requireRole("admin", "manager"), denyViewerWrites, denyAccountant, async (req, res) => {
  try {
    await ensureDynamicSpeedTables(pool);
    const result = await applyDueDynamicSpeeds(pool, req.auth!.tenantId);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: "dynamic_speed_apply_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
