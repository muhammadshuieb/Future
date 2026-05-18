import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { denyAccountant, denyViewerWrites } from "../middleware/capabilities.js";
import { requireSpeedProfilePermission } from "../middleware/speed-profile-auth.js";
import {
  applyActiveSpeedSchedules,
  createSpeedProfile,
  createSpeedSchedule,
  createSubscriberOverride,
  deleteSpeedProfile,
  deleteSpeedSchedule,
  deleteSubscriberOverride,
  getLiveSpeedDashboard,
  listSpeedProfileLogs,
  listSpeedProfiles,
  listSpeedSchedules,
  reconcileSpeedRadreply,
  resolveEffectiveSpeedProfile,
  speedProfilesSchemaReady,
  updateSpeedProfile,
  updateSpeedSchedule,
} from "../services/speed-profile.service.js";

const router = Router();
router.use(requireAuth);

const profileBody = z.object({
  name: z.string().min(1).max(160),
  branch_id: z.string().uuid().nullable().optional(),
  download_rate: z.string().min(1).max(64),
  upload_rate: z.string().min(1).max(64),
  burst_download_rate: z.string().max(64).nullable().optional(),
  burst_upload_rate: z.string().max(64).nullable().optional(),
  burst_threshold_download: z.string().max(64).nullable().optional(),
  burst_threshold_upload: z.string().max(64).nullable().optional(),
  burst_time: z.string().max(64).nullable().optional(),
  priority: z.number().int().min(0).max(99).optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

const scheduleBody = z.object({
  name: z.string().min(1).max(160),
  branch_id: z.string().uuid().nullable().optional(),
  target_type: z.enum(["package", "subscriber", "branch", "tenant"]),
  target_id: z.string().uuid().nullable().optional(),
  speed_profile_id: z.string().uuid(),
  fallback_speed_profile_id: z.string().uuid().nullable().optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  days_of_week: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  time_start: z.string().nullable().optional(),
  time_end: z.string().nullable().optional(),
  timezone: z.string().max(64).optional(),
  priority: z.number().int().optional(),
  repeat_mode: z.enum(["once", "daily", "weekly", "monthly"]).optional(),
  condition_type: z.enum(["always", "off_peak", "debt_status", "quota_status", "custom"]).optional(),
  is_active: z.boolean().optional(),
  coa_disconnect_on_rate_fail: z.boolean().optional(),
  notify_subscriber_whatsapp: z.boolean().optional(),
});

router.get("/", requireSpeedProfilePermission("view_speed_profiles"), async (req, res) => {
  try {
    if (!(await speedProfilesSchemaReady(pool))) {
      res.json({ items: [], schema: "missing" });
      return;
    }
    const items = await listSpeedProfiles(pool, req.auth!.tenantId);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: "speed_profiles_list_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

router.post(
  "/",
  requireSpeedProfilePermission("create_speed_profile"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    const parsed = profileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    try {
      const id = await createSpeedProfile(pool, req.auth!.tenantId, parsed.data);
      res.status(201).json({ id });
    } catch (e) {
      res.status(500).json({ error: "speed_profile_create_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.get("/schedules", requireSpeedProfilePermission("view_speed_profiles"), async (req, res) => {
  try {
    const items = await listSpeedSchedules(pool, req.auth!.tenantId);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: "speed_schedules_list_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

router.post(
  "/schedules",
  requireSpeedProfilePermission("manage_speed_schedules"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    const parsed = scheduleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    try {
      const id = await createSpeedSchedule(pool, req.auth!.tenantId, parsed.data as Record<string, unknown>, req.auth!.sub);
      res.status(201).json({ id });
    } catch (e) {
      res.status(500).json({ error: "speed_schedule_create_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.get("/schedules/:id", requireSpeedProfilePermission("view_speed_profiles"), async (req, res) => {
  try {
    const items = await listSpeedSchedules(pool, req.auth!.tenantId);
    const row = items.find((r) => String(r.id) === String(req.params.id));
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: "speed_schedule_get_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

router.put(
  "/schedules/:id",
  requireSpeedProfilePermission("manage_speed_schedules"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    const parsed = scheduleBody.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    try {
      const ok = await updateSpeedSchedule(pool, req.auth!.tenantId, String(req.params.id), parsed.data as Record<string, unknown>);
      if (!ok) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "speed_schedule_update_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.delete(
  "/schedules/:id",
  requireSpeedProfilePermission("manage_speed_schedules"),
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
      res.status(500).json({ error: "speed_schedule_delete_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

const overrideBody = z.object({
  speed_profile_id: z.string().uuid(),
  reason: z.string().max(255).nullable().optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  notify_subscriber_whatsapp: z.boolean().optional(),
});

router.post(
  "/subscribers/:subscriberId/override",
  requireSpeedProfilePermission("apply_speed_override"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    const parsed = overrideBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    try {
      const id = await createSubscriberOverride(
        pool,
        req.auth!.tenantId,
        String(req.params.subscriberId),
        parsed.data,
        req.auth!.sub
      );
      res.status(201).json({ id });
    } catch (e) {
      res.status(500).json({ error: "speed_override_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.delete(
  "/subscribers/:subscriberId/override",
  requireSpeedProfilePermission("apply_speed_override"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    try {
      await deleteSubscriberOverride(pool, req.auth!.tenantId, String(req.params.subscriberId));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "speed_override_delete_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.post(
  "/apply-now",
  requireSpeedProfilePermission("manage_speed_schedules"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    try {
      const result = await applyActiveSpeedSchedules(pool, req.auth!.tenantId);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: "speed_apply_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.post(
  "/reconcile",
  requireSpeedProfilePermission("edit_speed_profile"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    try {
      const result = await reconcileSpeedRadreply(pool, req.auth!.tenantId, 2000);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: "speed_reconcile_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.get("/subscribers/:subscriberId/effective", requireSpeedProfilePermission("view_speed_profiles"), async (req, res) => {
  try {
    const effective = await resolveEffectiveSpeedProfile(pool, req.auth!.tenantId, String(req.params.subscriberId));
    res.json({ effective });
  } catch (e) {
    res.status(500).json({ error: "speed_effective_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/logs", requireSpeedProfilePermission("view_speed_profile_logs"), async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"), 10) || 100));
    const subscriberId = typeof req.query.subscriber_id === "string" ? req.query.subscriber_id : null;
    const items = await listSpeedProfileLogs(pool, req.auth!.tenantId, { limit, subscriberId });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: "speed_logs_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/live/summary", requireSpeedProfilePermission("view_speed_profiles"), async (req, res) => {
  try {
    const dash = await getLiveSpeedDashboard(pool, req.auth!.tenantId);
    res.json(dash);
  } catch (e) {
    res.status(500).json({ error: "speed_live_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/:id", requireSpeedProfilePermission("view_speed_profiles"), async (req, res) => {
  try {
    const items = await listSpeedProfiles(pool, req.auth!.tenantId);
    const row = items.find((r) => String(r.id) === String(req.params.id));
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: "speed_profile_get_failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

router.put(
  "/:id",
  requireSpeedProfilePermission("edit_speed_profile"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    const parsed = profileBody.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    try {
      const ok = await updateSpeedProfile(pool, req.auth!.tenantId, String(req.params.id), parsed.data);
      if (!ok) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "speed_profile_update_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.delete(
  "/:id",
  requireSpeedProfilePermission("delete_speed_profile"),
  denyViewerWrites,
  denyAccountant,
  async (req, res) => {
    try {
      const ok = await deleteSpeedProfile(pool, req.auth!.tenantId, String(req.params.id));
      if (!ok) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("profile_in_use")) {
        res.status(409).json({ error: "profile_in_use" });
        return;
      }
      res.status(500).json({ error: "speed_profile_delete_failed", detail: msg });
    }
  }
);

export default router;
