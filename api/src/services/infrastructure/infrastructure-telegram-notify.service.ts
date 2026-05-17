import type { Pool } from "mysql2/promise";
import { isInQuietHours, getMonitoringSettings } from "./infrastructure-settings.service.js";
import type { AlertSeverity, RouterHealthSnapshot } from "./infrastructure-types.js";
import type { EvaluatedAlert } from "./infrastructure-alert-engine.service.js";
import { getTelegramCredentials, sendTelegramMessage } from "./infrastructure-telegram.service.js";

function nowAr(): string {
  return new Date().toLocaleString("ar-SY", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}ي ${hours}س`;
  if (hours > 0) return `${hours}س ${minutes}د`;
  return `${minutes}د`;
}

function metricsBlock(snap: RouterHealthSnapshot | null | undefined): string[] {
  if (!snap) return [];
  const lines: string[] = [];
  lines.push(`⏱ Uptime: ${formatUptime(snap.uptime_seconds)}`);
  if (snap.board_temperature_c != null) {
    lines.push(`🌡 الحرارة: ${snap.board_temperature_c}°C`);
  }
  if (snap.voltage_supported) {
    lines.push(`⚡ الجهد: ${snap.voltage_v != null ? `${snap.voltage_v}V` : "—"}`);
  }
  if (snap.cpu_percent != null) lines.push(`CPU: ${snap.cpu_percent}%`);
  if (snap.ram_percent != null) lines.push(`RAM: ${snap.ram_percent}%`);
  if (snap.ppp_active_sessions > 0) lines.push(`PPP: ${snap.ppp_active_sessions}`);
  return lines;
}

export function formatAlertTelegramMessage(
  ev: EvaluatedAlert,
  snap: RouterHealthSnapshot | null | undefined
): string {
  const icon = ev.severity === "critical" ? "🚨 تنبيه حرج" : ev.severity === "warning" ? "⚠️ تنبيه" : "ℹ️ تنبيه";
  const server = ev.nas_name ? `الراوتر: ${ev.nas_name}` : "Future Radius";
  const ip = snap?.nas_ip ? `IP: ${snap.nas_ip}` : null;
  const lines = [
    icon,
    server,
    ip,
    `المشكلة: ${ev.title}`,
    ev.message,
    ...metricsBlock(snap),
    ev.threshold_value ? `العتبة: ${ev.threshold_value}` : null,
    `الوقت: ${nowAr()}`,
  ].filter(Boolean) as string[];
  return lines.join("\n");
}

export function formatRecoveryTelegramMessage(ev: EvaluatedAlert): string {
  const name = ev.nas_name ?? "Future Radius";
  return [`✅ تم حل المشكلة`, `السيرفر ${name} عاد للعمل بشكل طبيعي.`, `الوقت: ${nowAr()}`].join("\n");
}

export async function dispatchInfrastructureTelegram(
  pool: Pool,
  tenantId: string,
  severity: AlertSeverity,
  message: string,
  isRecovery: boolean
): Promise<boolean> {
  const settings = await getMonitoringSettings(pool, tenantId);
  if (!settings.infrastructure_alerts_enabled || !settings.telegram_configured || !settings.telegram_alerts_enabled) {
    return false;
  }
  if (isInQuietHours(settings) && severity !== "critical") return false;

  const creds = await getTelegramCredentials(pool, tenantId);
  if (!creds) return false;

  const r = await sendTelegramMessage(creds.botToken, creds.chatId, message);
  return r.ok;
}
