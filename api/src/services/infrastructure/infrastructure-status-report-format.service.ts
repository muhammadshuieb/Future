import { config } from "../../config.js";
import type { RouterHealthSnapshot } from "./infrastructure-types.js";
import type { ServerHealthSnapshot } from "./server-health-collector.service.js";
import { formatTrafficSection } from "./traffic-metrics.util.js";

export const REPORT_SEP = "━━━━━━━━━━━━━━━━";

/** mm/dd/yyyy HH:mm in app timezone. */
export function formatInfraDateTime(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.appTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("month")}/${get("day")}/${get("year")} ${get("hour")}:${get("minute")}`;
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

export function formatServerStatusReport(snap: ServerHealthSnapshot): string {
  const statusLine =
    snap.health_status === "online"
      ? "✅ متصل"
      : snap.health_status === "degraded"
        ? "⚠️ متدهور"
        : "🔴 غير متصل";
  const lines: string[] = [
    "🖥 سيرفر Future Radius",
    `🕐 ${formatInfraDateTime()}`,
    statusLine,
    REPORT_SEP,
    `⏱ Uptime: ${formatUptime(snap.uptime_seconds)}`,
    `💻 حمل CPU: ${snap.cpu_load_1m ?? "—"} / ${snap.cpu_count ?? "—"} أنوية`,
    `💾 الذاكرة: ${snap.ram_percent ?? "—"}%`,
    `💿 القرص: ${snap.disk_percent ?? "—"}%`,
    "",
    `MySQL: ${snap.mysql_ok ? "✅" : "❌"}`,
    `Redis: ${snap.redis_ok ? "✅" : "❌"}`,
    `Worker: ${snap.worker_ok ? "✅" : "❌"}`,
    `FreeRADIUS: ${snap.freeradius_ok ? "✅" : "❌"}`,
  ];
  const dockerDown = snap.docker.filter((c) => !String(c.state).toLowerCase().startsWith("up"));
  if (dockerDown.length > 0) {
    lines.push("", "⚠️ حاويات متوقفة:");
    for (const c of dockerDown.slice(0, 8)) {
      lines.push(`• ${c.name}: ${c.state}`);
    }
  }
  return lines.join("\n");
}

export function formatSingleRouterReport(snap: RouterHealthSnapshot): string {
  const online = snap.last_sync_ok && snap.health_status === "online";
  const statusLine = online ? "✅ متصل" : "🔴 غير متصل";
  const lines: string[] = [
    `📊 ${snap.nas_name}`,
    `🕐 ${formatInfraDateTime()}`,
    statusLine,
    REPORT_SEP,
    `📍 ${snap.nas_ip}`,
  ];

  if (!online) {
    lines.push(`❌ ${snap.last_sync_error ?? "تعذّر الاتصال"}`);
    return lines.join("\n");
  }

  lines.push(
    `⏱ Uptime: ${formatUptime(snap.uptime_seconds)}`,
    "",
    `💻 المعالج: ${snap.cpu_percent ?? "—"}%`,
    `💾 الذاكرة: ${snap.ram_percent ?? "—"}%`,
    ""
  );

  if (snap.board_temperature_c != null || snap.voltage_supported) {
    if (snap.board_temperature_c != null) {
      lines.push(`🌡 الحرارة: ${snap.board_temperature_c}°C`);
    }
    if (snap.voltage_supported) {
      lines.push(`⚡ الجهد: ${snap.voltage_v != null ? `${snap.voltage_v}V` : "—"}`);
    }
    lines.push("");
  }

  lines.push(`👥 PPPoE: ${snap.ppp_active_sessions}`, `📶 Hotspot: ${snap.hotspot_active_sessions}`);

  if (snap.interfaces_down > 0) {
    lines.push(`⚠️ واجهات متوقفة: ${snap.interfaces_down}`);
  }

  lines.push("", ...formatTrafficSection(snap));
  return lines.join("\n");
}

export function formatEmptyReportMessage(prep: {
  issue?: "migration_required" | "no_active_nas";
  active_nas_count: number;
  mikrotik_api_count: number;
}): string {
  const header = [`📊 تقرير الراوترات`, `🕐 ${formatInfraDateTime()}`, ""].join("\n");
  if (prep.issue === "migration_required") {
    return `${header}⚠️ جدول مراقبة الراوترات غير موجود — شغّل migrations (019+) ثم أعد المحاولة.`;
  }
  if (prep.issue === "no_active_nas") {
    return `${header}لا يوجد راوتر نشط في NAS.`;
  }
  if ((prep.mikrotik_api_count ?? 0) === 0) {
    return `${header}يوجد ${prep.active_nas_count ?? 0} راوتر لكن MikroTik API غير مفعّل.`;
  }
  return `${header}تعذّر جمع البيانات — تحقق من IP ومنفذ API.`;
}
