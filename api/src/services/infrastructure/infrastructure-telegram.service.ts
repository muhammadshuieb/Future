import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../../db/schemaGuards.js";
import { encryptSecret, tryDecryptSecret } from "../crypto.service.js";

export type TelegramConfigPublic = {
  configured: boolean;
  chat_id: string | null;
  alerts_enabled: boolean;
  status_reports_enabled: boolean;
  status_interval_minutes: number;
  last_status_report_at: string | null;
  last_test_ok: boolean | null;
  last_error: string | null;
};

export type TelegramConfigSave = {
  bot_token?: string;
  chat_id?: string;
  status_reports_enabled?: boolean;
  status_interval_minutes?: number;
};

function tokenFromRow(row: RowDataPacket): string | null {
  const blob = row.telegram_bot_token_encrypted as Buffer | Uint8Array | null | undefined;
  if (!blob || (!(blob instanceof Buffer) && !(blob instanceof Uint8Array))) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return tryDecryptSecret(buf);
}

export async function getTelegramConfig(pool: Pool, tenantId: string): Promise<TelegramConfigPublic> {
  const empty: TelegramConfigPublic = {
    configured: false,
    chat_id: null,
    alerts_enabled: false,
    status_reports_enabled: true,
    status_interval_minutes: 5,
    last_status_report_at: null,
    last_test_ok: null,
    last_error: null,
  };
  if (!(await hasTable(pool, "infrastructure_monitoring_settings"))) return empty;
  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (!col.has("telegram_chat_id")) return empty;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT telegram_chat_id, telegram_bot_token_encrypted, telegram_alerts_enabled,
            telegram_last_test_ok, telegram_last_error,
            telegram_status_reports_enabled, telegram_status_interval_minutes, telegram_last_status_report_at
     FROM infrastructure_monitoring_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  const r = rows[0];
  if (!r) return empty;
  const chatId = r.telegram_chat_id != null ? String(r.telegram_chat_id).trim() : "";
  const token = tokenFromRow(r);
  const configured = Boolean(token && chatId);
  return {
    configured,
    chat_id: chatId || null,
    alerts_enabled: Boolean(r.telegram_alerts_enabled ?? 0),
    status_reports_enabled: col.has("telegram_status_reports_enabled")
      ? Boolean(r.telegram_status_reports_enabled ?? 1)
      : true,
    status_interval_minutes: col.has("telegram_status_interval_minutes")
      ? Math.max(1, Math.min(1440, Number(r.telegram_status_interval_minutes ?? 5)))
      : 5,
    last_status_report_at:
      col.has("telegram_last_status_report_at") && r.telegram_last_status_report_at
        ? new Date(String(r.telegram_last_status_report_at)).toISOString()
        : null,
    last_test_ok: r.telegram_last_test_ok != null ? Boolean(r.telegram_last_test_ok) : null,
    last_error: r.telegram_last_error != null ? String(r.telegram_last_error) : null,
  };
}

export async function saveTelegramConfig(
  pool: Pool,
  tenantId: string,
  input: TelegramConfigSave
): Promise<TelegramConfigPublic> {
  await pool.execute(
    `INSERT INTO infrastructure_monitoring_settings (tenant_id) VALUES (?) ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [tenantId]
  );

  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (!col.has("telegram_chat_id")) {
    throw new Error("telegram_schema_missing");
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT telegram_bot_token_encrypted, telegram_chat_id FROM infrastructure_monitoring_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  const existing = rows[0];
  const chatId = (input.chat_id ?? String(existing?.telegram_chat_id ?? "")).trim();
  let token = input.bot_token?.trim() || tokenFromRow(existing ?? {}) || "";

  if (!chatId) {
    throw new Error("telegram_chat_id_required");
  }
  if (!token) {
    throw new Error("telegram_bot_token_required");
  }

  const configured = Boolean(token && chatId);
  const statusEnabled = input.status_reports_enabled ?? true;
  const statusInterval = Math.max(
    1,
    Math.min(1440, Number(input.status_interval_minutes ?? 5))
  );

  const sets = [
    "telegram_chat_id = ?",
    "telegram_bot_token_encrypted = ?",
    "telegram_alerts_enabled = ?",
    "infrastructure_alerts_enabled = 1",
    "telegram_last_test_ok = NULL",
    "telegram_last_error = NULL",
  ];
  const vals: (string | number | Buffer)[] = [chatId, encryptSecret(token), configured ? 1 : 0];

  if (col.has("telegram_status_reports_enabled")) {
    sets.push("telegram_status_reports_enabled = ?", "telegram_status_interval_minutes = ?");
    vals.push(statusEnabled ? 1 : 0, statusInterval);
  }

  vals.push(tenantId);
  await pool.execute(
    `UPDATE infrastructure_monitoring_settings SET ${sets.join(", ")} WHERE tenant_id = ?`,
    vals
  );

  const test = await testTelegramConnection(pool, tenantId);
  return test.config;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${botToken.trim()}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: text.slice(0, 4096),
        disable_web_page_preview: true,
      }),
    });
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.description ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getTelegramCredentials(
  pool: Pool,
  tenantId: string
): Promise<{ botToken: string; chatId: string } | null> {
  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (!col.has("telegram_chat_id")) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT telegram_chat_id, telegram_bot_token_encrypted, telegram_alerts_enabled
     FROM infrastructure_monitoring_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  const r = rows[0];
  if (!r || !Boolean(r.telegram_alerts_enabled ?? 0)) return null;
  const chatId = String(r.telegram_chat_id ?? "").trim();
  const token = tokenFromRow(r);
  if (!token || !chatId) return null;
  return { botToken: token, chatId };
}

export async function testTelegramConnection(
  pool: Pool,
  tenantId: string
): Promise<{ ok: boolean; config: TelegramConfigPublic }> {
  const creds = await getTelegramCredentials(pool, tenantId);
  if (!creds) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT telegram_chat_id, telegram_bot_token_encrypted FROM infrastructure_monitoring_settings WHERE tenant_id = ? LIMIT 1`,
      [tenantId]
    );
    const r = rows[0];
    const token = r ? tokenFromRow(r) : null;
    const chatId = r ? String(r.telegram_chat_id ?? "").trim() : "";
    if (!token || !chatId) {
      const config = await getTelegramConfig(pool, tenantId);
      return { ok: false, config };
    }
    const send = await sendTelegramMessage(
      token,
      chatId,
      "✅ Future Radius — اختبار إشعارات Telegram ناجح."
    );
    const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
    if (col.has("telegram_last_test_ok")) {
      await pool.execute(
        `UPDATE infrastructure_monitoring_settings SET telegram_last_test_ok = ?, telegram_last_error = ? WHERE tenant_id = ?`,
        [send.ok ? 1 : 0, send.ok ? null : (send.error ?? "failed").slice(0, 512), tenantId]
      );
    }
    return { ok: send.ok, config: await getTelegramConfig(pool, tenantId) };
  }

  const send = await sendTelegramMessage(
    creds.botToken,
    creds.chatId,
    "✅ Future Radius — اختبار إشعارات Telegram ناجح."
  );
  const col = await getTableColumns(pool, "infrastructure_monitoring_settings");
  if (col.has("telegram_last_test_ok")) {
    await pool.execute(
      `UPDATE infrastructure_monitoring_settings SET telegram_last_test_ok = ?, telegram_last_error = ? WHERE tenant_id = ?`,
      [send.ok ? 1 : 0, send.ok ? null : (send.error ?? "failed").slice(0, 512), tenantId]
    );
  }
  return { ok: send.ok, config: await getTelegramConfig(pool, tenantId) };
}
