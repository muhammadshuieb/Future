import type { Pool } from "mysql2/promise";
import { sendOperationalAlertWhatsApp } from "../whatsapp.service.js";
import { isInQuietHours, getMonitoringSettings } from "./infrastructure-settings.service.js";
import type { AlertSeverity } from "./infrastructure-types.js";
import type { EvaluatedAlert } from "./infrastructure-alert-engine.service.js";
import { getAlertGuidance } from "./infrastructure-alert-guidance.service.js";
import {
  formatAlertTelegramMessage,
  formatRecoveryTelegramMessage,
} from "./infrastructure-telegram-notify.service.js";
import type { RouterHealthSnapshot } from "./infrastructure-types.js";
import type { ServerHealthSnapshot } from "./server-health-collector.service.js";
import { formatInfraDateTime } from "./infrastructure-status-report-format.service.js";

const SEP = "━━━━━━━━━━━━━━━━";

/** WhatsApp alert with problem, severity, maintenance, and resolution steps. */
export function formatAlertWhatsAppMessage(
  ev: EvaluatedAlert,
  snap?: RouterHealthSnapshot | null,
  serverSnap?: ServerHealthSnapshot | null
): string {
  const guidance = getAlertGuidance(ev.alert_type, ev.severity);
  const icon =
    ev.severity === "critical" ? "🚨 تنبيه حرج" : ev.severity === "warning" ? "⚠️ تنبيه" : "ℹ️ تنبيه";
  const targetLines: string[] =
    ev.nas_name != null
      ? [`📍 ${ev.nas_name}`, ...(snap?.nas_ip ? [`IP: ${snap.nas_ip}`] : [])]
      : ["📍 سيرفر Future Radius"];

  const lines: string[] = [
    `${icon} — Future Radius`,
    SEP,
    ...targetLines,
    "",
    "📋 المشكلة:",
    ev.title,
    ev.message,
    "",
    `🔴 درجة الخطورة: ${guidance.severityLabel}`,
    "",
    `🔧 يحتاج تدخل صيانة: ${guidance.maintenanceText}`,
    "",
    "✅ كيفية الحل:",
    ...guidance.resolutionSteps.map((s, i) => `${i + 1}. ${s}`),
  ];

  const metricsTail = formatAlertTelegramMessage(ev, snap, serverSnap)
    .split("\n")
    .filter((l) => l.startsWith("⏱") || l.startsWith("🌡") || l.startsWith("⚡") || l.startsWith("CPU") || l.startsWith("RAM") || l.startsWith("PPP") || l.startsWith("📡") || l.startsWith("   "));
  if (metricsTail.length > 0) {
    lines.push("", ...metricsTail);
  }

  if (ev.threshold_value) {
    lines.push(`العتبة: ${ev.threshold_value}`);
  }
  lines.push(`الوقت: ${formatInfraDateTime()}`);
  return lines.filter((l) => l !== "").join("\n");
}

export function formatRecoveryWhatsAppMessage(ev: EvaluatedAlert): string {
  return formatRecoveryTelegramMessage(ev);
}

/** Infrastructure WhatsApp always goes to the connected session owner number. */
export async function dispatchInfrastructureWhatsApp(
  pool: Pool,
  tenantId: string,
  severity: AlertSeverity,
  message: string,
  isRecovery: boolean
): Promise<boolean> {
  const settings = await getMonitoringSettings(pool, tenantId);
  if (!settings.infrastructure_alerts_enabled || !settings.whatsapp_alerts_enabled) return false;
  if (isInQuietHours(settings) && severity !== "critical") return false;
  if (settings.whatsapp_critical_only && severity !== "critical" && !isRecovery) return false;

  const r = await sendOperationalAlertWhatsApp(tenantId, null, message, { preferSessionOwner: true });
  return r.sent;
}
