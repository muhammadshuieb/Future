import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requestHasMonitoringPermission } from "../lib/monitoring-permissions.js";
import {
  getMonitoringSettings,
  updateMonitoringSettings,
  listNotificationTargets,
  upsertNotificationTarget,
  deleteNotificationTarget,
} from "../services/infrastructure/infrastructure-settings.service.js";
import {
  getGlobalThresholds,
  updateGlobalThresholds,
  getNasThresholds,
  updateNasThresholds,
} from "../services/infrastructure/infrastructure-thresholds.service.js";
import { listRouterHealthSnapshots } from "../services/infrastructure/router-health-collector.service.js";
import { getServerHealthSnapshot } from "../services/infrastructure/server-health-collector.service.js";
import {
  acknowledgeAlert,
  listActiveAlerts,
} from "../services/infrastructure/infrastructure-alert-engine.service.js";
import {
  scheduleRouterAction,
  confirmRouterAction,
} from "../services/infrastructure/router-actions.service.js";
import { runInfrastructureMonitorCycle } from "../services/infrastructure/infrastructure-monitor-cycle.service.js";
import {
  getTelegramConfig,
  saveTelegramConfig,
  testTelegramConnection,
} from "../services/infrastructure/infrastructure-telegram.service.js";
import type { RowDataPacket } from "mysql2";
import { hasTable } from "../db/schemaGuards.js";

const router = Router();
router.use(requireAuth);

function requireMonitoringView(req: Parameters<typeof requestHasMonitoringPermission>[0], res: import("express").Response, next: import("express").NextFunction) {
  if (!requestHasMonitoringPermission(req, "monitoring:view")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

function requireMonitoringManage(req: Parameters<typeof requestHasMonitoringPermission>[0], res: import("express").Response, next: import("express").NextFunction) {
  if (!requestHasMonitoringPermission(req, "monitoring:manage")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

router.get("/overview", requireRole("admin", "manager", "accountant", "viewer"), requireMonitoringView, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const routers = await listRouterHealthSnapshots(pool, tenantId);
  const server = await getServerHealthSnapshot(pool, tenantId);
  const alerts = await listActiveAlerts(pool, tenantId, 30);
  const firing = alerts.filter((a) => String(a.status) === "firing");
  res.json({
    routers,
    server,
    alerts,
    summary: {
      routers_total: routers.length,
      routers_offline: routers.filter((r) => r.health_status === "offline" || !r.last_sync_ok).length,
      critical_alerts: firing.filter((a) => String(a.severity) === "critical").length,
      warning_alerts: firing.filter((a) => String(a.severity) === "warning").length,
      high_cpu: routers.filter((r) => r.cpu_percent != null && r.cpu_percent >= 80).length,
      high_temperature: routers.filter(
        (r) => r.board_temperature_c != null && r.board_temperature_c >= 65
      ).length,
      low_voltage: routers.filter(
        (r) => r.voltage_supported && r.voltage_v != null && r.voltage_v < 12
      ).length,
    },
  });
});

router.get("/settings", requireRole("admin", "manager"), requireMonitoringManage, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const settings = await getMonitoringSettings(pool, tenantId);
  const thresholds = await getGlobalThresholds(pool, tenantId);
  const targets = await listNotificationTargets(pool, tenantId);
  const telegram = await getTelegramConfig(pool, tenantId);
  res.json({ settings, thresholds, targets, telegram });
});

const settingsBody = z.object({
  infrastructure_alerts_enabled: z.boolean().optional(),
  whatsapp_alerts_enabled: z.boolean().optional(),
  whatsapp_critical_only: z.boolean().optional(),
  alert_cooldown_minutes: z.number().int().min(5).max(1440).optional(),
  router_offline_minutes: z.number().int().min(1).max(60).optional(),
  quiet_hours_enabled: z.boolean().optional(),
  quiet_hours_start: z.string().nullable().optional(),
  quiet_hours_end: z.string().nullable().optional(),
  recovery_notifications_enabled: z.boolean().optional(),
  poll_interval_seconds: z.number().int().min(60).max(3600).optional(),
});

router.put("/settings", requireRole("admin", "manager"), requireMonitoringManage, async (req, res) => {
  const parsed = settingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const settings = await updateMonitoringSettings(pool, req.auth!.tenantId, parsed.data);
  res.json({ settings });
});

const telegramBody = z.object({
  bot_token: z.string().min(20).optional(),
  chat_id: z.string().min(1),
  status_reports_enabled: z.boolean().optional(),
  status_interval_minutes: z.number().int().min(1).max(1440).optional(),
});

router.put("/telegram", requireRole("admin", "manager"), requireMonitoringManage, async (req, res) => {
  const parsed = telegramBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const telegram = await saveTelegramConfig(pool, req.auth!.tenantId, {
      bot_token: parsed.data.bot_token,
      chat_id: parsed.data.chat_id,
      status_reports_enabled: parsed.data.status_reports_enabled,
      status_interval_minutes: parsed.data.status_interval_minutes,
    });
    const settings = await getMonitoringSettings(pool, req.auth!.tenantId);
    res.json({ telegram, settings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "telegram_bot_token_required" || msg === "telegram_chat_id_required") {
      res.status(400).json({ error: msg });
      return;
    }
    if (msg === "telegram_schema_missing") {
      res.status(503).json({ error: "migration_required" });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

router.post("/telegram/send-status-now", requireRole("admin", "manager"), requireMonitoringManage, async (req, res) => {
  const { sendTelegramStatusReportNow } = await import(
    "../services/infrastructure/infrastructure-telegram-status-report.service.js"
  );
  const tenantId = req.auth!.tenantId;
  const result = await sendTelegramStatusReportNow(pool, tenantId);
  if (!result.ok) {
    res.status(400).json({
      ok: false,
      error: result.error ?? "status_report_not_sent",
      detail: result.detail,
    });
    return;
  }
  const telegram = await getTelegramConfig(pool, tenantId);
  res.json({ ok: true, telegram });
});

router.post("/telegram/test", requireRole("admin", "manager"), requireMonitoringManage, async (req, res) => {
  const result = await testTelegramConnection(pool, req.auth!.tenantId);
  if (!result.ok) {
    res.status(400).json({ ok: false, telegram: result.config, error: result.config.last_error ?? "test_failed" });
    return;
  }
  res.json({ ok: true, telegram: result.config });
});

const thresholdBody = z.object({
  cpu_percent_max: z.number().optional(),
  ram_percent_max: z.number().optional(),
  temperature_c_max: z.number().optional(),
  voltage_v_min: z.number().nullable().optional(),
  ppp_session_drop_percent: z.number().optional(),
  traffic_rx_mbps_spike: z.number().nullable().optional(),
  traffic_tx_mbps_spike: z.number().nullable().optional(),
  disk_percent_max: z.number().optional(),
  server_ram_percent_max: z.number().optional(),
  server_cpu_load_multiplier: z.number().optional(),
});

router.put("/thresholds/global", requireRole("admin", "manager"), requireMonitoringManage, async (req, res) => {
  const parsed = thresholdBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const thresholds = await updateGlobalThresholds(pool, req.auth!.tenantId, parsed.data);
  res.json({ thresholds });
});

router.get("/thresholds/nas/:nasId", requireRole("admin", "manager"), requireMonitoringView, async (req, res) => {
  const thresholds = await getNasThresholds(pool, req.auth!.tenantId, req.params.nasId);
  res.json({ thresholds });
});

router.put("/thresholds/nas/:nasId", requireRole("admin", "manager"), requireMonitoringManage, async (req, res) => {
  const parsed = thresholdBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const thresholds = await updateNasThresholds(pool, req.auth!.tenantId, req.params.nasId, parsed.data);
  res.json({ thresholds });
});

const targetBody = z.object({
  id: z.string().optional(),
  label: z.string(),
  phone: z.string().min(6),
  is_group: z.boolean().optional(),
  enabled: z.boolean().optional(),
  receive_critical: z.boolean().optional(),
  receive_warning: z.boolean().optional(),
  receive_info: z.boolean().optional(),
  receive_recovery: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

router.post("/notification-targets", requireRole("admin", "manager"), requireMonitoringManage, async (req, res) => {
  const parsed = targetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const id = await upsertNotificationTarget(pool, req.auth!.tenantId, {
    id: parsed.data.id,
    label: parsed.data.label,
    phone: parsed.data.phone,
    is_group: parsed.data.is_group ?? false,
    enabled: parsed.data.enabled ?? true,
    receive_critical: parsed.data.receive_critical ?? true,
    receive_warning: parsed.data.receive_warning ?? true,
    receive_info: parsed.data.receive_info ?? false,
    receive_recovery: parsed.data.receive_recovery ?? true,
    sort_order: parsed.data.sort_order ?? 0,
  });
  res.json({ id });
});

router.delete("/notification-targets/:id", requireRole("admin", "manager"), requireMonitoringManage, async (req, res) => {
  await deleteNotificationTarget(pool, req.auth!.tenantId, req.params.id);
  res.json({ ok: true });
});

router.get("/alerts", requireRole("admin", "manager", "accountant", "viewer"), requireMonitoringView, async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
  const alerts = await listActiveAlerts(pool, req.auth!.tenantId, limit);
  res.json({ alerts });
});

router.post("/alerts/:id/acknowledge", requireRole("admin", "manager"), async (req, res) => {
  if (!requestHasMonitoringPermission(req, "monitoring:acknowledge_alerts")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const ok = await acknowledgeAlert(pool, req.auth!.tenantId, req.params.id, req.auth!.sub);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/run-cycle", requireRole("admin", "manager"), requireMonitoringManage, async (req, res) => {
  await runInfrastructureMonitorCycle(pool, req.auth!.tenantId);
  res.json({ ok: true });
});

const actionBody = z.object({
  nas_device_id: z.string().uuid(),
  action_type: z.enum(["reboot", "restart_interface", "disable_interface", "enable_interface"]),
  payload: z.record(z.unknown()).optional(),
  scheduled_at: z.string().datetime().optional(),
  requires_confirmation: z.boolean().optional(),
});

router.post("/router-actions", requireRole("admin", "manager"), async (req, res) => {
  if (!requestHasMonitoringPermission(req, "monitoring:execute_router_actions")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const parsed = actionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const scheduledAt = parsed.data.scheduled_at ? new Date(parsed.data.scheduled_at) : new Date();
  const id = await scheduleRouterAction(pool, {
    tenantId: req.auth!.tenantId,
    nasDeviceId: parsed.data.nas_device_id,
    actionType: parsed.data.action_type,
    payload: parsed.data.payload,
    scheduledAt,
    createdBy: req.auth!.sub,
    requiresConfirmation: parsed.data.requires_confirmation,
  });
  res.status(201).json({ id });
});

router.post("/router-actions/:id/confirm", requireRole("admin", "manager"), async (req, res) => {
  if (!requestHasMonitoringPermission(req, "monitoring:execute_router_actions")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const ok = await confirmRouterAction(pool, req.auth!.tenantId, req.params.id, req.auth!.sub);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

router.get("/router-actions", requireRole("admin", "manager"), requireMonitoringView, async (req, res) => {
  if (!(await hasTable(pool, "router_scheduled_actions"))) {
    res.json({ actions: [] });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.*, n.name AS nas_name FROM router_scheduled_actions a
     LEFT JOIN nas_devices n ON n.id = a.nas_device_id
     WHERE a.tenant_id = ? ORDER BY a.created_at DESC LIMIT 50`,
    [req.auth!.tenantId]
  );
  res.json({ actions: rows });
});

export default router;
