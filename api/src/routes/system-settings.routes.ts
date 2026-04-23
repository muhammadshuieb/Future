import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { routePolicy } from "../middleware/policy.js";
import { getSystemSettings, updateSystemSettings, type SystemSettingsInput } from "../services/system-settings.service.js";
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
  user_idle_timeout_minutes: z.number().int().min(2).max(10080).optional(),
  mikrotik_interim_update_minutes: z.number().int().min(1).max(60).optional(),
  disconnect_on_activation: z.boolean().optional(),
  disconnect_on_update: z.boolean().optional(),
  subscription_license_note: z.string().max(512).optional(),
  accountant_contact_phone: z.string().max(32).optional(),
});

router.put("/", routePolicy({ allow: ["admin", "manager"] }), async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const cur = await getSystemSettings(req.auth!.tenantId);
    const next: SystemSettingsInput = {
      ...cur,
      ...parsed.data,
      user_idle_timeout_minutes: parsed.data.user_idle_timeout_minutes ?? cur.user_idle_timeout_minutes,
      mikrotik_interim_update_minutes:
        parsed.data.mikrotik_interim_update_minutes ?? cur.mikrotik_interim_update_minutes,
      disconnect_on_activation: parsed.data.disconnect_on_activation ?? cur.disconnect_on_activation,
      disconnect_on_update: parsed.data.disconnect_on_update ?? cur.disconnect_on_update,
      subscription_license_note: parsed.data.subscription_license_note ?? cur.subscription_license_note,
      accountant_contact_phone: parsed.data.accountant_contact_phone ?? cur.accountant_contact_phone,
    };
    const settings = await updateSystemSettings(req.auth!.tenantId, next);
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
