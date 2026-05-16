import type { Pool } from "mysql2/promise";
import { sendOperationalAlertWhatsApp } from "../whatsapp.service.js";
import { isInQuietHours, listNotificationTargets } from "./infrastructure-settings.service.js";
import { getMonitoringSettings } from "./infrastructure-settings.service.js";
import type { AlertSeverity } from "./infrastructure-types.js";
import type { EvaluatedAlert } from "./infrastructure-alert-engine.service.js";

function nowAr(): string {
  return new Date().toLocaleString("ar-SY", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatAlertWhatsAppMessage(ev: EvaluatedAlert): string {
  const icon = ev.severity === "critical" ? "🚨 تنبيه حرج" : ev.severity === "warning" ? "⚠️ تنبيه" : "ℹ️ تنبيه";
  const server = ev.nas_name ? `السيرفر: ${ev.nas_name}` : "السيرفر: Future Radius";
  return [icon, server, `المشكلة: ${ev.title}`, ev.message, `الوقت: ${nowAr()}`].filter(Boolean).join("\n");
}

export function formatRecoveryWhatsAppMessage(ev: EvaluatedAlert): string {
  const name = ev.nas_name ?? "Future Radius";
  return [`✅ تم حل المشكلة`, `السيرفر ${name} عاد للعمل بشكل طبيعي.`, `الوقت: ${nowAr()}`].join("\n");
}

export async function dispatchInfrastructureWhatsApp(
  pool: Pool,
  tenantId: string,
  severity: AlertSeverity,
  message: string,
  isRecovery: boolean
): Promise<boolean> {
  const settings = await getMonitoringSettings(pool, tenantId);
  if (!settings.whatsapp_alerts_enabled) return false;
  if (isInQuietHours(settings) && severity !== "critical") return false;
  if (settings.whatsapp_critical_only && severity !== "critical" && !isRecovery) return false;

  const targets = await listNotificationTargets(pool, tenantId);
  const enabled = targets.filter((t) => {
    if (!t.enabled) return false;
    if (isRecovery) return t.receive_recovery;
    if (severity === "critical") return t.receive_critical;
    if (severity === "warning") return t.receive_warning;
    return t.receive_info;
  });

  if (enabled.length === 0) {
    const r = await sendOperationalAlertWhatsApp(tenantId, null, message, { preferSessionOwner: true });
    return r.sent;
  }

  let anySent = false;
  for (const t of enabled) {
    const r = await sendOperationalAlertWhatsApp(tenantId, t.phone, message, { preferSessionOwner: false });
    if (r.sent) anySent = true;
  }
  return anySent;
}
