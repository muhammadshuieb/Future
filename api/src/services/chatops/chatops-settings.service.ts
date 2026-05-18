import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { config } from "../../config.js";
import { hasTable } from "../../db/schemaGuards.js";

export type ChatOpsSettingsView = {
  enabled: boolean;
  whatsapp_enabled: boolean;
  telegram_enabled: boolean;
  telegram_configured: boolean;
  allow_whatsapp_groups: boolean;
  allow_telegram_groups: boolean;
  commands_per_minute: number;
  failed_attempts_before_lockout: number;
  lockout_minutes: number;
  max_prepaid_cards_per_command: number;
  max_financial_amount_non_admin: number;
};

function aesKey(): Buffer | null {
  const hex = config.aesSecretKeyHex.trim();
  if (!hex || hex.length < 64) return null;
  return Buffer.from(hex.slice(0, 64), "hex");
}

function encryptToken(plain: string): Buffer | null {
  const key = aesKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decryptToken(blob: Buffer | Uint8Array | null): string | null {
  if (!blob || blob.length < 28) return null;
  const key = aesKey();
  if (!key) return null;
  const buf = Buffer.from(blob);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function ensureChatOpsSettingsRow(pool: Pool, tenantId: string): Promise<void> {
  if (!(await hasTable(pool, "chatops_settings"))) return;
  await pool.execute(
    `INSERT IGNORE INTO chatops_settings (tenant_id, enabled) VALUES (?, 0)`,
    [tenantId]
  );
}

export async function getChatOpsSettings(pool: Pool, tenantId: string): Promise<ChatOpsSettingsView> {
  const defaults: ChatOpsSettingsView = {
    enabled: false,
    whatsapp_enabled: true,
    telegram_enabled: true,
    telegram_configured: false,
    allow_whatsapp_groups: false,
    allow_telegram_groups: false,
    commands_per_minute: 20,
    failed_attempts_before_lockout: 5,
    lockout_minutes: 15,
    max_prepaid_cards_per_command: 50,
    max_financial_amount_non_admin: 500,
  };
  if (!(await hasTable(pool, "chatops_settings"))) return defaults;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM chatops_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  const r = rows[0];
  if (!r) return defaults;
  const envToken = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  return {
    enabled: Boolean(r.enabled),
    whatsapp_enabled: Boolean(r.whatsapp_enabled ?? 1),
    telegram_enabled: Boolean(r.telegram_enabled ?? 1),
    telegram_configured: Boolean(envToken || decryptToken(r.telegram_bot_token_encrypted as Buffer)),
    allow_whatsapp_groups: Boolean(r.allow_whatsapp_groups),
    allow_telegram_groups: Boolean(r.allow_telegram_groups),
    commands_per_minute: Number(r.commands_per_minute ?? 20),
    failed_attempts_before_lockout: Number(r.failed_attempts_before_lockout ?? 5),
    lockout_minutes: Number(r.lockout_minutes ?? 15),
    max_prepaid_cards_per_command: Number(r.max_prepaid_cards_per_command ?? 50),
    max_financial_amount_non_admin: Number(r.max_financial_amount_non_admin ?? 500),
  };
}

export async function saveChatOpsSettings(
  pool: Pool,
  tenantId: string,
  input: Partial<ChatOpsSettingsView> & { telegram_bot_token?: string | null }
): Promise<ChatOpsSettingsView> {
  await ensureChatOpsSettingsRow(pool, tenantId);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const map: Array<[keyof ChatOpsSettingsView, string]> = [
    ["enabled", "enabled"],
    ["whatsapp_enabled", "whatsapp_enabled"],
    ["telegram_enabled", "telegram_enabled"],
    ["allow_whatsapp_groups", "allow_whatsapp_groups"],
    ["allow_telegram_groups", "allow_telegram_groups"],
    ["commands_per_minute", "commands_per_minute"],
    ["failed_attempts_before_lockout", "failed_attempts_before_lockout"],
    ["lockout_minutes", "lockout_minutes"],
    ["max_prepaid_cards_per_command", "max_prepaid_cards_per_command"],
    ["max_financial_amount_non_admin", "max_financial_amount_non_admin"],
  ];
  for (const [k, col] of map) {
    if (input[k] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(input[k]);
    }
  }
  if (input.telegram_bot_token !== undefined) {
    const tok = (input.telegram_bot_token ?? "").trim();
    if (tok) {
      const enc = encryptToken(tok);
      sets.push("telegram_bot_token_encrypted = ?");
      vals.push(enc);
    } else {
      sets.push("telegram_bot_token_encrypted = NULL");
    }
  }
  if (sets.length) {
    vals.push(tenantId);
    await pool.execute(
      `UPDATE chatops_settings SET ${sets.join(", ")} WHERE tenant_id = ?`,
      vals as (string | number | Buffer | null)[]
    );
  }
  return getChatOpsSettings(pool, tenantId);
}

export async function resolveTelegramBotToken(pool: Pool, tenantId: string): Promise<string | null> {
  const env = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (env) return env;
  if (!(await hasTable(pool, "chatops_settings"))) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT telegram_bot_token_encrypted FROM chatops_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  return decryptToken(rows[0]?.telegram_bot_token_encrypted as Buffer) ?? null;
}

export async function resolveTelegramWebhookSecret(pool: Pool, tenantId: string): Promise<string> {
  const env = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (env) return env;
  if (!(await hasTable(pool, "chatops_settings"))) return "";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT telegram_webhook_secret FROM chatops_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  return String(rows[0]?.telegram_webhook_secret ?? "").trim();
}
