import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  applyProfessionalArabicTemplates,
  deleteWhatsAppLogs,
  getWhatsAppQr,
  getWhatsAppSettings,
  getWhatsAppStatus,
  listWhatsAppLogs,
  listWhatsAppTemplates,
  resendFailedWhatsAppMessages,
  resendWhatsAppMessage,
  sendWhatsAppBroadcast,
  sendExpiryReminders,
  sendUsageThresholdAlerts,
  testWhatsAppConnection,
  updateWhatsAppSettings,
  updateWhatsAppTemplate,
} from "../services/whatsapp.service.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin", "manager"));

router.get("/status", async (req, res) => {
  try {
    const status = await getWhatsAppStatus(req.auth!.tenantId);
    res.json({ status });
  } catch (e) {
    console.error("whatsapp status", e);
    res.status(500).json({ error: "whatsapp_status_failed" });
  }
});

router.get("/settings", async (req, res) => {
  try {
    const settings = await getWhatsAppSettings(req.auth!.tenantId);
    res.json({ settings });
  } catch (e) {
    console.error("whatsapp settings", e);
    res.status(500).json({ error: "whatsapp_settings_failed" });
  }
});

const settingsBody = z.object({
  enabled: z.boolean(),
  waha_url: z.string().max(255),
  session_name: z.string().max(128),
  api_key: z.string().max(255).optional(),
  reminder_days: z.number().int().min(1).max(30),
  message_interval_seconds: z.number().int().min(0).max(300),
  auto_send_new: z.boolean(),
  usage_alert_thresholds: z.array(z.number().int()).default([10, 20, 30, 50]),
}).refine((x) => x.usage_alert_thresholds.every((n) => [10, 20, 30, 50].includes(n)), {
  message: "invalid_thresholds",
});

router.get("/qr", async (req, res) => {
  try {
    const qr = await getWhatsAppQr(req.auth!.tenantId);
    res.json({ qr });
  } catch (e) {
    console.error("whatsapp qr", e);
    res.status(500).json({ error: "whatsapp_qr_failed" });
  }
});

router.put("/settings", async (req, res) => {
  const parsed = settingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const settings = await updateWhatsAppSettings(req.auth!.tenantId, parsed.data);
    res.json({ settings });
  } catch (e) {
    console.error("whatsapp save settings", e);
    res.status(500).json({ error: "whatsapp_settings_save_failed" });
  }
});

router.post("/test", async (req, res) => {
  try {
    const status = await testWhatsAppConnection(req.auth!.tenantId);
    res.json({ status });
  } catch (e) {
    console.error("whatsapp test", e);
    res.status(500).json({ error: "whatsapp_test_failed" });
  }
});

router.get("/templates", async (req, res) => {
  try {
    const items = await listWhatsAppTemplates(req.auth!.tenantId);
    res.json({ items });
  } catch (e) {
    console.error("whatsapp templates", e);
    res.status(500).json({ error: "whatsapp_templates_failed" });
  }
});

const templateBody = z.object({ body: z.string().min(3).max(4000) });
const templateKey = z.enum(["new_account", "expiry_soon", "payment_due", "usage_threshold"]);

router.put("/templates/:key", async (req, res) => {
  const parsedBody = templateBody.safeParse(req.body);
  const parsedKey = templateKey.safeParse(req.params.key);
  if (!parsedBody.success || !parsedKey.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    await updateWhatsAppTemplate(req.auth!.tenantId, parsedKey.data, parsedBody.data.body);
    res.json({ ok: true });
  } catch (e) {
    console.error("whatsapp update template", e);
    res.status(500).json({ error: "whatsapp_template_save_failed" });
  }
});

router.post("/templates/apply-professional-ar", async (req, res) => {
  try {
    await applyProfessionalArabicTemplates(req.auth!.tenantId);
    res.json({ ok: true });
  } catch (e) {
    console.error("whatsapp apply templates", e);
    res.status(500).json({ error: "whatsapp_apply_templates_failed" });
  }
});

router.get("/logs", async (req, res) => {
  const limit = Number.parseInt(String(req.query.limit ?? "100"), 10);
  try {
    const items = await listWhatsAppLogs(req.auth!.tenantId, Number.isFinite(limit) ? limit : 100);
    res.json({ items });
  } catch (e) {
    console.error("whatsapp logs", e);
    res.status(500).json({ error: "whatsapp_logs_failed" });
  }
});

router.post("/logs/:id/resend", async (req, res) => {
  try {
    const item = await resendWhatsAppMessage(req.auth!.tenantId, req.params.id);
    if (!item) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ item });
  } catch (e) {
    console.error("whatsapp resend", e);
    res.status(500).json({ error: "whatsapp_resend_failed" });
  }
});

const logsDeleteBody = z.object({
  all: z.boolean().optional(),
  failed_only: z.boolean().optional(),
  ids: z.array(z.string().uuid()).optional(),
});

router.delete("/logs", async (req, res) => {
  const parsed = logsDeleteBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const deleted = await deleteWhatsAppLogs(req.auth!.tenantId, {
      all: Boolean(parsed.data.all),
      failedOnly: Boolean(parsed.data.failed_only),
      ids: parsed.data.ids ?? [],
    });
    res.json({ ok: true, deleted });
  } catch (e) {
    console.error("whatsapp logs delete", e);
    res.status(500).json({ error: "whatsapp_logs_delete_failed" });
  }
});

router.post("/logs/resend-failed", async (req, res) => {
  const limit = Number.parseInt(String(req.query.limit ?? "100"), 10);
  try {
    const result = await resendFailedWhatsAppMessages(req.auth!.tenantId, Number.isFinite(limit) ? limit : 100);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("whatsapp resend failed", e);
    res.status(500).json({ error: "whatsapp_resend_failed_bulk_failed" });
  }
});

router.post("/send-expiry-now", async (req, res) => {
  try {
    const result = await sendExpiryReminders(req.auth!.tenantId);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("whatsapp send expiry now", e);
    res.status(500).json({ error: "whatsapp_expiry_send_failed" });
  }
});

router.post("/send-usage-now", async (req, res) => {
  try {
    const result = await sendUsageThresholdAlerts(req.auth!.tenantId);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("whatsapp send usage now", e);
    res.status(500).json({ error: "whatsapp_usage_send_failed" });
  }
});

const broadcastBody = z.object({
  filter_type: z.enum(["all", "speed", "region"]),
  speed: z.string().max(64).optional().nullable(),
  region: z.string().max(255).optional().nullable(),
  message: z.string().min(2).max(4000),
});

router.post("/broadcast/send", async (req, res) => {
  const parsed = broadcastBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const result = await sendWhatsAppBroadcast(req.auth!.tenantId, parsed.data);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("whatsapp broadcast send", e);
    res.status(500).json({ error: "whatsapp_broadcast_failed" });
  }
});

export default router;
