import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import { getSystemSettings, updateSystemSettings } from "../services/system-settings.service.js";
import {
  resolveWhatsAppSessionOwnerPhone,
  sendOperationalAlertWhatsApp,
} from "../services/whatsapp.service.js";

const router = Router();
router.use(requireAuth);

router.get("/", routePolicy({ allow: ["admin", "manager", "accountant", "viewer"] }), async (req, res) => {
  try {
    const settings = await getSystemSettings(req.auth!.tenantId);
    res.json({ settings });
  } catch (e) {
    console.error("system settings get", e);
    res.status(500).json({ error: "system_settings_failed" });
  }
});

const bodySchema = z.object({
  critical_alert_enabled: z.boolean(),
  critical_alert_phone: z.string().max(32),
  critical_alert_use_session_owner: z.boolean(),
  server_log_retention_days: z.number().int().min(3).max(90),
});

router.put("/", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const settings = await updateSystemSettings(req.auth!.tenantId, parsed.data);
    res.json({ settings });
  } catch (e) {
    console.error("system settings put", e);
    res.status(500).json({ error: "system_settings_save_failed" });
  }
});

router.post("/test-alert", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  try {
    const settings = await getSystemSettings(req.auth!.tenantId);
    let target = (settings.critical_alert_phone || "").trim() || null;
    if (settings.critical_alert_use_session_owner) {
      const owner = await resolveWhatsAppSessionOwnerPhone(req.auth!.tenantId).catch(() => null);
      if (owner) target = owner;
    }
    const message =
      "تنبيه تجريبي من النظام: هذا اختبار لقناة تنبيهات الأخطاء الحرجة. إذا وصلك الآن فالإعدادات صحيحة.";
    const result = await sendOperationalAlertWhatsApp(req.auth!.tenantId, target, message, {
      preferSessionOwner: false,
    });
    res.json({ ok: true, result });
  } catch (e) {
    console.error("system settings test alert", e);
    res.status(500).json({ error: "system_settings_test_alert_failed" });
  }
});

export default router;
