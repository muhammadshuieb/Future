import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns } from "../../db/schemaGuards.js";
import { listRouterHealthSnapshots } from "./router-health-collector.service.js";
import { buildScheduledStatusMessages } from "./infrastructure-status-report-build.service.js";
import {
  formatEmptyReportMessage,
  formatSingleRouterReport,
} from "./infrastructure-status-report-format.service.js";
import {
  getTelegramCredentials,
  getTelegramCredentialsLoose,
  sendTelegramMessage,
} from "./infrastructure-telegram.service.js";
import { log } from "../logger.service.js";
import type { RouterHealthSnapshot } from "./infrastructure-types.js";
import type { StatusReportRouterPrep } from "./router-health-collector.service.js";

export {
  formatSingleRouterReport,
  formatEmptyReportMessage,
} from "./infrastructure-status-report-format.service.js";

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
  const { messages } = await buildScheduledStatusMessages(pool, tenantId, freshCollect);

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

const SNAPSHOT_MAX_AGE_MS = 3 * 60_000;

async function shouldFreshCollectForReport(pool: Pool, tenantId: string): Promise<boolean> {
  const routers = await listRouterHealthSnapshots(pool, tenantId);
  if (routers.length === 0) return true;
  let newest = 0;
  for (const r of routers) {
    const raw = r.last_sync_at ?? r.last_seen_at;
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest === 0 || Date.now() - newest > SNAPSHOT_MAX_AGE_MS;
}

export async function maybeSendTelegramStatusReport(
  pool: Pool,
  tenantId: string,
  options: { freshCollect?: boolean } = {}
): Promise<boolean> {
  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (!col.has("telegram_status_interval_minutes")) return false;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT telegram_status_reports_enabled, telegram_status_interval_minutes, telegram_last_status_report_at
     FROM infrastructure_monitoring_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  const r = rows[0];
  if (!r || !Boolean(r.telegram_status_reports_enabled ?? 1)) {
    return false;
  }

  const intervalMin = Math.max(1, Math.min(1440, Number(r.telegram_status_interval_minutes ?? 5)));
  const lastAt = r.telegram_last_status_report_at ? new Date(String(r.telegram_last_status_report_at)) : null;
  const elapsedMs = lastAt ? Date.now() - lastAt.getTime() : Infinity;
  if (elapsedMs < intervalMin * 60_000) return false;

  const creds =
    (await getTelegramCredentials(pool, tenantId)) ??
    (await getTelegramCredentialsLoose(pool, tenantId));
  if (!creds) {
    log.warn(`telegram_status_report_skip_no_creds tenant=${tenantId}`, {}, "telegram");
    return false;
  }

  const freshCollect =
    options.freshCollect ?? (await shouldFreshCollectForReport(pool, tenantId));
  const result = await dispatchStatusReport(pool, tenantId, creds, freshCollect);
  if (!result.ok) {
    log.warn(`telegram_status_report_failed tenant=${tenantId} ${result.detail}`, {}, "telegram");
    return false;
  }
  log.info(`telegram_status_report_sent tenant=${tenantId}`, {}, "telegram");
  return true;
}

export async function runTelegramStatusReportsDue(
  pool: Pool
): Promise<{ checked: number; sent: number }> {
  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (!col.has("telegram_status_interval_minutes")) return { checked: 0, sent: 0 };

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT tenant_id FROM infrastructure_monitoring_settings
     WHERE COALESCE(telegram_status_reports_enabled, 0) = 1
       AND telegram_chat_id IS NOT NULL AND TRIM(telegram_chat_id) <> ''
       AND telegram_bot_token_encrypted IS NOT NULL`
  );

  let sent = 0;
  for (const row of rows) {
    const tenantId = String(row.tenant_id);
    try {
      if (await maybeSendTelegramStatusReport(pool, tenantId)) sent += 1;
    } catch (err) {
      log.warn(`telegram_status_report_tick_failed tenant=${tenantId} ${String(err)}`, {}, "telegram");
    }
  }
  return { checked: rows.length, sent };
}

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
