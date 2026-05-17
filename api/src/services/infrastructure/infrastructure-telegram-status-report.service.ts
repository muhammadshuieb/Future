import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../../db/schemaGuards.js";
import {
  prepareRoutersForStatusReport,
  type StatusReportRouterPrep,
} from "./router-health-collector.service.js";
import type { RouterHealthSnapshot } from "./infrastructure-types.js";
import { formatTelegramDateTime, formatUptime } from "./infrastructure-telegram-notify.service.js";
import { formatTrafficSection } from "./traffic-metrics.util.js";
import {
  getTelegramCredentials,
  getTelegramCredentialsLoose,
  sendTelegramMessage,
} from "./infrastructure-telegram.service.js";
import { log } from "../logger.service.js";

const SEP = "━━━━━━━━━━━━━━━━";

/** One Telegram message per router. */
export function formatSingleRouterReport(snap: RouterHealthSnapshot): string {
  const online = snap.last_sync_ok && snap.health_status === "online";
  const statusLine = online ? "✅ متصل" : "🔴 غير متصل";
  const lines: string[] = [
    `📊 ${snap.nas_name}`,
    `🕐 ${formatTelegramDateTime()}`,
    statusLine,
    SEP,
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

export function formatEmptyReportMessage(
  prep: Pick<StatusReportRouterPrep, "issue" | "active_nas_count" | "mikrotik_api_count">
): string {
  const header = [`📊 تقرير الراوترات`, `🕐 ${formatTelegramDateTime()}`, ""].join("\n");
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

/** @deprecated combined report; use formatSingleRouterReport */
export function formatStatusReportMessage(
  routers: RouterHealthSnapshot[],
  prep?: Pick<StatusReportRouterPrep, "issue" | "active_nas_count" | "mikrotik_api_count">
): string {
  if (routers.length === 0) {
    return formatEmptyReportMessage(prep ?? { active_nas_count: 0, mikrotik_api_count: 0 });
  }
  return routers.map((r) => formatSingleRouterReport(r)).join("\n\n");
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
  freshCollect = false
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const prep = await prepareRoutersForStatusReport(pool, tenantId, {
    collectIfEmpty: true,
    freshCollect,
  });

  const messages: string[] =
    prep.routers.length > 0
      ? prep.routers.map((r) => formatSingleRouterReport(r))
      : [formatEmptyReportMessage(prep)];

  for (const body of messages) {
    for (const chunk of splitTelegramMessages(body)) {
      const send = await sendTelegramMessage(creds.botToken, creds.chatId, chunk);
      if (!send.ok) {
        return { ok: false, error: "telegram_send_failed", detail: send.error };
      }
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

/** Manual send — fresh collect with instant Mbps, one message per router. */
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
