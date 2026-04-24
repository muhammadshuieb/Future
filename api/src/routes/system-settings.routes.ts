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
  wireguard_vpn_enabled: z.boolean().optional(),
  wireguard_server_host: z.string().max(128).optional(),
  wireguard_server_port: z.number().int().min(1).max(65535).optional(),
  wireguard_interface_cidr: z.string().max(64).optional(),
  wireguard_client_dns: z.string().max(128).optional(),
  wireguard_persistent_keepalive: z.number().int().min(0).max(300).optional(),
  wireguard_server_public_key: z.string().max(64).optional(),
  wireguard_server_private_key: z.string().max(64).optional(),
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
      wireguard_vpn_enabled: parsed.data.wireguard_vpn_enabled ?? cur.wireguard_vpn_enabled,
      wireguard_server_host: parsed.data.wireguard_server_host ?? cur.wireguard_server_host,
      wireguard_server_port: parsed.data.wireguard_server_port ?? cur.wireguard_server_port,
      wireguard_interface_cidr: parsed.data.wireguard_interface_cidr ?? cur.wireguard_interface_cidr,
      wireguard_client_dns: parsed.data.wireguard_client_dns ?? cur.wireguard_client_dns,
      wireguard_persistent_keepalive:
        parsed.data.wireguard_persistent_keepalive ?? cur.wireguard_persistent_keepalive,
      wireguard_server_public_key: parsed.data.wireguard_server_public_key ?? cur.wireguard_server_public_key,
      wireguard_server_private_key: parsed.data.wireguard_server_private_key,
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
