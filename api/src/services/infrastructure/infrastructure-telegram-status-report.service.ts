import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../../db/schemaGuards.js";
import { listRouterHealthSnapshots } from "./router-health-collector.service.js";
import type { RouterHealthSnapshot } from "./infrastructure-types.js";
import { formatUptime } from "./infrastructure-telegram-notify.service.js";
import {
  getTelegramCredentials,
  getTelegramCredentialsLoose,
  sendTelegramMessage,
} from "./infrastructure-telegram.service.js";
import { log } from "../logger.service.js";

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

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
    const ifaceLabel = snap.traffic_monitor_interface
      ? ` (${snap.traffic_monitor_interface})`
      : "";
    lines.push(
      `📡 Traffic${ifaceLabel} RX: ${formatBytes(snap.traffic_rx_bps)} | TX: ${formatBytes(snap.traffic_tx_bps)}`
    );
  }
  return lines.join("\n");
}

export function formatStatusReportMessage(routers: RouterHealthSnapshot[]): string {
  const now = new Date().toLocaleString("ar-SY", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
  const online = routers.filter((r) => r.last_sync_ok).length;
  const header = `📊 تقرير الراوترات — ${now}\nمتصل: ${online}/${routers.length}\n`;
  if (routers.length === 0) {
    return `${header}\nلا توجد بيانات راوتر — فعّل MikroTik API على أجهزة NAS ثم شغّل «فحص الآن» من مركز NOC.`;
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
  creds: { botToken: string; chatId: string }
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const routers = await listRouterHealthSnapshots(pool, tenantId);
  const body = formatStatusReportMessage(routers);
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

  const result = await dispatchStatusReport(pool, tenantId, creds);
  if (!result.ok) {
    log.warn(`telegram_status_report_failed tenant=${tenantId} ${result.detail}`, {}, "telegram");
    return false;
  }
  return true;
}

/** Manual send — fast path using last snapshots (no router API collect on HTTP request). */
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
  return dispatchStatusReport(pool, tenantId, creds);
}
