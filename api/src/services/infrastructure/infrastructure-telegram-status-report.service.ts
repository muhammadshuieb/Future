import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../../db/schemaGuards.js";
import {
  prepareRoutersForStatusReport,
  type StatusReportRouterPrep,
} from "./router-health-collector.service.js";
import type { RouterHealthSnapshot } from "./infrastructure-types.js";
import { formatUptime } from "./infrastructure-telegram-notify.service.js";
import { formatTrafficMbLine } from "./traffic-metrics.util.js";
import {
  getTelegramCredentials,
  getTelegramCredentialsLoose,
  sendTelegramMessage,
} from "./infrastructure-telegram.service.js";
import { log } from "../logger.service.js";

function routerBlock(snap: RouterHealthSnapshot): string {
  const online = snap.last_sync_ok && snap.health_status === "online";
  const icon = online ? "🟢" : "🔴";
  const lines = [
    `${icon} ${snap.nas_name} (${snap.nas_ip})`,
    online ? `⏱ Uptime: ${formatUptime(snap.uptime_seconds)}` : `❌ ${snap.last_sync_error ?? "غير متصل"}`,
  ];
  if (online) {
    lines.push(`CPU: ${snap.cpu_percent ?? "—"}% | RAM: ${snap.ram_percent ?? "—"}%`);
    if (snap.board_temperature_c != null || snap.voltage_supported) {
      const temp = snap.board_temperature_c != null ? `${snap.board_temperature_c}°C` : "—";
      const volt = snap.voltage_supported
        ? snap.voltage_v != null
          ? `${snap.voltage_v}V`
          : "—"
        : null;
      lines.push(`🌡 ${temp}${volt != null ? ` | ⚡ ${volt}` : ""}`);
    }
    lines.push(`PPPoE: ${snap.ppp_active_sessions} | Hotspot: ${snap.hotspot_active_sessions}`);
    if (snap.interfaces_down > 0) {
      lines.push(`⚠️ واجهات متوقفة: ${snap.interfaces_down}`);
    }
    lines.push(
      formatTrafficMbLine(snap.traffic_rx_mb, snap.traffic_tx_mb, snap.traffic_monitor_interface)
    );
  }
  return lines.join("\n");
}

export function formatStatusReportMessage(
  routers: RouterHealthSnapshot[],
  prep?: Pick<StatusReportRouterPrep, "issue" | "active_nas_count" | "mikrotik_api_count">
): string {
  const now = new Date().toLocaleString("ar-SY", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
  const online = routers.filter((r) => r.last_sync_ok).length;
  const total = routers.length > 0 ? routers.length : prep?.active_nas_count ?? 0;
  const header = `📊 تقرير الراوترات — ${now}\nمتصل: ${online}/${total}\n`;
  if (routers.length === 0) {
    if (prep?.issue === "migration_required") {
      return `${header}\n⚠️ جدول مراقبة الراوترات غير موجود — شغّل migrations البنية التحتية (019+) على قاعدة البيانات ثم أعد «فحص الآن».`;
    }
    if (prep?.issue === "no_active_nas") {
      return `${header}\nلا يوجد راوتر نشط في NAS — أضف جهازاً بحالة active.`;
    }
    if ((prep?.mikrotik_api_count ?? 0) === 0) {
      return `${header}\nيوجد ${prep?.active_nas_count ?? 0} راوتر في NAS لكن MikroTik API غير مفعّل — فعّله من تعديل الجهاز (مستخدم + كلمة مرور API).`;
    }
    return `${header}\nتعذّر جمع بيانات الراوتر — تحقق من IP ومنفذ API من صفحة NAS ثم «فحص الآن» من مركز NOC.`;
  }
  const blocks = routers.map((r) => routerBlock(r));
  return `${header}\n${blocks.join("\n──────────────\n")}`;
}

function splitTelegramMessages(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const next = cur ? `${cur}\n${line}` : line;
    if (next.length > maxLen) {
      if (cur) parts.push(cur);
      cur = line;
    } else {
      cur = next;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

async function dispatchStatusReport(
  pool: Pool,
  tenantId: string,
  creds: { botToken: string; chatId: string },
  collectIfEmpty = false
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const prep = await prepareRoutersForStatusReport(pool, tenantId, collectIfEmpty);
  const body = formatStatusReportMessage(prep.routers, prep);
  for (const chunk of splitTelegramMessages(body)) {
    const send = await sendTelegramMessage(creds.botToken, creds.chatId, chunk);
    if (!send.ok) {
      return { ok: false, error: "telegram_send_failed", detail: send.error };
    }
  }
  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (col.has("telegram_last_status_report_at")) {
    await pool.execute(
      `UPDATE infrastructure_monitoring_settings SET telegram_last_status_report_at = NOW(3) WHERE tenant_id = ?`,
      [tenantId]
    );
  }
  return { ok: true };
}

export async function maybeSendTelegramStatusReport(pool: Pool, tenantId: string): Promise<boolean> {
  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (!col.has("telegram_status_interval_minutes")) return false;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT telegram_status_reports_enabled, telegram_status_interval_minutes, telegram_last_status_report_at,
            telegram_alerts_enabled
     FROM infrastructure_monitoring_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  const r = rows[0];
  if (!r || !Boolean(r.telegram_alerts_enabled ?? 0) || !Boolean(r.telegram_status_reports_enabled ?? 1)) {
    return false;
  }

  const intervalMin = Math.max(1, Math.min(1440, Number(r.telegram_status_interval_minutes ?? 5)));
  const lastAt = r.telegram_last_status_report_at ? new Date(String(r.telegram_last_status_report_at)) : null;
  const elapsedMs = lastAt ? Date.now() - lastAt.getTime() : Infinity;
  if (elapsedMs < intervalMin * 60_000) return false;

  const creds = await getTelegramCredentials(pool, tenantId);
  if (!creds) return false;

  const result = await dispatchStatusReport(pool, tenantId, creds, true);
  if (!result.ok) {
    log.warn(`telegram_status_report_failed tenant=${tenantId} ${result.detail}`, {}, "telegram");
    return false;
  }
  return true;
}

/** Manual send — collects router data when snapshots are missing, then sends. */
export async function sendTelegramStatusReportNow(
  pool: Pool,
  tenantId: string
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const creds = (await getTelegramCredentials(pool, tenantId)) ?? (await getTelegramCredentialsLoose(pool, tenantId));
  if (!creds) {
    return {
      ok: false,
      error: "telegram_not_configured",
      detail: "أدخل Bot Token و Chat ID ثم اضغط «حفظ وتفعيل»",
    };
  }
  return dispatchStatusReport(pool, tenantId, creds, true);
}
