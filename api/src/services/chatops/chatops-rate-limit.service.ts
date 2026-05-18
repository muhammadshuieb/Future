import type { Pool } from "mysql2/promise";
import { hasTable } from "../../db/schemaGuards.js";
import type { ChatOpsChannel } from "./chatops-types.js";
import type { ChatOpsSettingsView } from "./chatops-settings.service.js";

export async function checkChatOpsRateLimit(
  pool: Pool,
  tenantId: string,
  channel: ChatOpsChannel,
  externalSenderId: string,
  settings: ChatOpsSettingsView
): Promise<{ allowed: boolean; reason?: string }> {
  if (!(await hasTable(pool, "chatops_rate_limits"))) return { allowed: true };
  const [rows] = await pool.query(
    `SELECT command_count, failed_count, locked_until, window_start
     FROM chatops_rate_limits
     WHERE tenant_id = ? AND channel = ? AND external_sender_id = ?
     LIMIT 1`,
    [tenantId, channel, externalSenderId]
  );
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (row?.locked_until) {
    const lockedUntil = new Date(String(row.locked_until));
    if (lockedUntil.getTime() > Date.now()) {
      return { allowed: false, reason: "تم قفل الأوامر مؤقتاً بسبب محاولات فاشلة." };
    }
  }
  const windowStart = row?.window_start ? new Date(String(row.window_start)) : null;
  const now = Date.now();
  let count = Number(row?.command_count ?? 0);
  if (!windowStart || now - windowStart.getTime() > 60_000) {
    count = 0;
  }
  if (count >= settings.commands_per_minute) {
    return { allowed: false, reason: "تجاوزت حد الأوامر في الدقيقة. حاول لاحقاً." };
  }
  return { allowed: true };
}

export async function bumpChatOpsRateLimit(
  pool: Pool,
  tenantId: string,
  channel: ChatOpsChannel,
  externalSenderId: string,
  failed: boolean,
  settings: ChatOpsSettingsView
): Promise<void> {
  if (!(await hasTable(pool, "chatops_rate_limits"))) return;
  const [rows] = await pool.query(
    `SELECT command_count, failed_count, window_start FROM chatops_rate_limits
     WHERE tenant_id = ? AND channel = ? AND external_sender_id = ? LIMIT 1`,
    [tenantId, channel, externalSenderId]
  );
  const row = (rows as Array<Record<string, unknown>>)[0];
  const now = new Date();
  let count = 1;
  let failedCount = failed ? 1 : 0;
  if (row) {
    const ws = new Date(String(row.window_start));
    if (now.getTime() - ws.getTime() <= 60_000) {
      count = Number(row.command_count ?? 0) + 1;
      failedCount = Number(row.failed_count ?? 0) + (failed ? 1 : 0);
    }
  }
  let lockedUntil: Date | null = null;
  if (failedCount >= settings.failed_attempts_before_lockout) {
    lockedUntil = new Date(Date.now() + settings.lockout_minutes * 60_000);
    failedCount = 0;
  }
  await pool.execute(
    `INSERT INTO chatops_rate_limits (tenant_id, channel, external_sender_id, window_start, command_count, failed_count, locked_until)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       window_start = VALUES(window_start),
       command_count = VALUES(command_count),
       failed_count = VALUES(failed_count),
       locked_until = VALUES(locked_until)`,
    [tenantId, channel, externalSenderId, now, count, failedCount, lockedUntil]
  );
}
