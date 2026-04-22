import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { emitEvent } from "../events/eventBus.js";
import { Events } from "../events/eventTypes.js";

type WhatsAppTemplateKey = "new_account" | "expiry_soon" | "payment_due" | "usage_threshold";
type WhatsAppLogTemplateKey = WhatsAppTemplateKey | "invoice_paid";

type WhatsAppSettingsRow = RowDataPacket & {
  tenant_id: string;
  enabled: number;
  waha_url: string | null;
  session_name: string | null;
  api_key: string | null;
  reminder_days: number;
  message_interval_seconds: number;
  auto_send_new: number;
  usage_alert_thresholds: string | null;
  last_check_ok: number | null;
  last_check_at: string | null;
  last_error: string | null;
};

type WhatsAppTemplateRow = RowDataPacket & {
  tenant_id: string;
  template_key: WhatsAppTemplateKey;
  body: string;
  updated_at: string;
};

type WhatsAppLogRow = RowDataPacket & {
  id: string;
  tenant_id: string;
  subscriber_id: string | null;
  phone: string;
  template_key: WhatsAppLogTemplateKey | null;
  message_body: string;
  status: "sent" | "failed";
  provider_message_id: string | null;
  error_message: string | null;
  retry_of: string | null;
  created_at: string;
  sent_at: string | null;
};

export type WhatsAppStatus = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  reminder_days: number;
  message_interval_seconds: number;
  auto_send_new: boolean;
  usage_alert_thresholds: number[];
  last_error: string | null;
  last_check_at: string | null;
};

export type WhatsAppSettingsView = {
  enabled: boolean;
  waha_url: string;
  session_name: string;
  api_key: string;
  reminder_days: number;
  message_interval_seconds: number;
  auto_send_new: boolean;
  usage_alert_thresholds: number[];
};

export type WhatsAppTemplateView = {
  template_key: WhatsAppTemplateKey;
  body: string;
  updated_at: string | null;
};

export type WhatsAppLogView = {
  id: string;
  subscriber_id: string | null;
  phone: string;
  template_key: WhatsAppLogTemplateKey | null;
  message_body: string;
  status: "sent" | "failed";
  provider_message_id: string | null;
  error_message: string | null;
  retry_of: string | null;
  created_at: string;
  sent_at: string | null;
};

export type WhatsAppQrView = {
  qr_data_url: string | null;
  connected: boolean;
  message: string | null;
};

export type WhatsAppBroadcastInput = {
  filter_type: "all" | "speed" | "region";
  speed?: string | null;
  region?: string | null;
  message: string;
};

const DEFAULT_TEMPLATES: Record<WhatsAppTemplateKey, string> = {
  new_account:
    "مرحباً {{full_name}}،\nنرحب بك في خدمتنا.\nتم تفعيل اشتراكك بنجاح.\n\n• اسم المستخدم: {{username}}\n• كلمة المرور: {{password}}\n• الباقة: {{package_name}}\n• السرعة: {{speed}}\n• تاريخ الانتهاء: {{expiration_date}}\n\nنتمنى لك تجربة ممتعة.",
  expiry_soon:
    "مرحباً {{full_name}}،\nتنبيه باقتراب انتهاء اشتراكك.\nالمتبقي: {{days_left}} يوم.\n\n• الباقة: {{package_name}}\n• السرعة: {{speed}}\n• تاريخ الانتهاء: {{expiration_date}}\n\nيرجى التجديد قبل انتهاء الاشتراك لضمان استمرار الخدمة.",
  payment_due:
    "مرحباً {{full_name}}،\nنود تذكيرك بوجود ذمة مالية مستحقة على حسابك.\n\n• إجمالي المستحقات: {{due_amount}} {{currency}}\n• عدد الفواتير غير المدفوعة: {{unpaid_count}}\n• أقدم تاريخ استحقاق: {{oldest_due_date}}\n\nيرجى السداد في أقرب وقت لتجنب أي انقطاع بالخدمة. شكراً لتعاونك.",
  usage_threshold:
    "مرحباً {{full_name}}،\nتنبيه استهلاك الباقة: تم استخدام {{usage_percent}}% من إجمالي الحصة.\n\n• اسم المستخدم: {{username}}\n• الاستهلاك: {{used_gb}} GB من أصل {{quota_gb}} GB\n• النسبة المتبقية: {{remaining_percent}}%\n• تاريخ انتهاء الباقة: {{expiration_date}} (المتبقي {{days_left}} يوم)\n\nيرجى شحن/تجديد الباقة قبل نفادها لضمان استمرار الخدمة.",
};

const nextAllowedSendByTenant = new Map<string, number>();
const ALLOWED_USAGE_THRESHOLDS = [10, 20, 30, 50] as const;

function parseUsageThresholds(raw: string | null | undefined): number[] {
  const values = String(raw ?? "10,20,30,50")
    .split(",")
    .map((x) => Number.parseInt(x.trim(), 10))
    .filter((x) => ALLOWED_USAGE_THRESHOLDS.includes(x as (typeof ALLOWED_USAGE_THRESHOLDS)[number]));
  const unique = Array.from(new Set(values)).sort((a, b) => a - b);
  return unique.length ? unique : [10, 20, 30, 50];
}

async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_settings (
      tenant_id CHAR(36) NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      waha_url VARCHAR(255) NULL,
      session_name VARCHAR(128) NULL,
      api_key VARCHAR(255) NULL,
      reminder_days INT NOT NULL DEFAULT 5,
      message_interval_seconds INT NOT NULL DEFAULT 30,
      auto_send_new TINYINT(1) NOT NULL DEFAULT 1,
      usage_alert_thresholds VARCHAR(64) NOT NULL DEFAULT '10,20,30,50',
      last_check_ok TINYINT(1) NULL,
      last_check_at DATETIME NULL,
      last_error TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    SET @sql = (
      SELECT IF(
        EXISTS (
          SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'whatsapp_settings'
            AND COLUMN_NAME = 'message_interval_seconds'
        ),
        'SELECT 1',
        'ALTER TABLE whatsapp_settings ADD COLUMN message_interval_seconds INT NOT NULL DEFAULT 30 AFTER reminder_days'
      )
    );
  `);
  await pool.query(`PREPARE stmt FROM @sql`);
  await pool.query(`EXECUTE stmt`);
  await pool.query(`DEALLOCATE PREPARE stmt`);
  await pool.query(`
    SET @sql = (
      SELECT IF(
        EXISTS (
          SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'whatsapp_settings'
            AND COLUMN_NAME = 'usage_alert_thresholds'
        ),
        'SELECT 1',
        'ALTER TABLE whatsapp_settings ADD COLUMN usage_alert_thresholds VARCHAR(64) NOT NULL DEFAULT ''10,20,30,50'' AFTER auto_send_new'
      )
    );
  `);
  await pool.query(`PREPARE stmt FROM @sql`);
  await pool.query(`EXECUTE stmt`);
  await pool.query(`DEALLOCATE PREPARE stmt`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      tenant_id CHAR(36) NOT NULL,
      template_key ENUM('new_account','expiry_soon','payment_due','usage_threshold') NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, template_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_message_logs (
      id CHAR(36) NOT NULL PRIMARY KEY,
      tenant_id CHAR(36) NOT NULL,
      subscriber_id CHAR(36) NULL,
      phone VARCHAR(32) NOT NULL,
      template_key ENUM('new_account','expiry_soon','payment_due','usage_threshold','invoice_paid') NULL,
      message_body TEXT NOT NULL,
      status ENUM('sent','failed') NOT NULL,
      provider_message_id VARCHAR(255) NULL,
      error_message TEXT NULL,
      retry_of CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME NULL,
      INDEX idx_whatsapp_log_tenant_created (tenant_id, created_at),
      INDEX idx_whatsapp_log_tenant_status (tenant_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    SET @sql = (
      SELECT IF(
        EXISTS (
          SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'whatsapp_templates'
            AND COLUMN_NAME = 'template_key'
            AND LOCATE('usage_threshold', COLUMN_TYPE) > 0
        ),
        'SELECT 1',
        'ALTER TABLE whatsapp_templates MODIFY COLUMN template_key ENUM(''new_account'',''expiry_soon'',''payment_due'',''usage_threshold'') NOT NULL'
      )
    );
  `);
  await pool.query(`PREPARE stmt FROM @sql`);
  await pool.query(`EXECUTE stmt`);
  await pool.query(`DEALLOCATE PREPARE stmt`);
  await pool.query(`
    SET @sql = (
      SELECT IF(
        EXISTS (
          SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'whatsapp_message_logs'
            AND COLUMN_NAME = 'template_key'
            AND LOCATE('usage_threshold', COLUMN_TYPE) > 0
            AND LOCATE('invoice_paid', COLUMN_TYPE) > 0
        ),
        'SELECT 1',
        'ALTER TABLE whatsapp_message_logs MODIFY COLUMN template_key ENUM(''new_account'',''expiry_soon'',''payment_due'',''usage_threshold'',''invoice_paid'') NULL'
      )
    );
  `);
  await pool.query(`PREPARE stmt FROM @sql`);
  await pool.query(`EXECUTE stmt`);
  await pool.query(`DEALLOCATE PREPARE stmt`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_usage_alerts_sent (
      tenant_id CHAR(36) NOT NULL,
      subscriber_id CHAR(36) NOT NULL,
      threshold_percent INT NOT NULL,
      month_key CHAR(7) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, subscriber_id, threshold_percent, month_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureTenantDefaults(tenantId: string): Promise<void> {
  await pool.execute(
    `INSERT INTO whatsapp_settings (tenant_id, enabled, reminder_days, message_interval_seconds, auto_send_new, usage_alert_thresholds)
     VALUES (?, 0, 5, 30, 1, '10,20,30,50')
     ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [tenantId]
  );
  for (const [key, body] of Object.entries(DEFAULT_TEMPLATES)) {
    await pool.execute(
      `INSERT INTO whatsapp_templates (tenant_id, template_key, body)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE template_key = template_key`,
      [tenantId, key, body]
    );
  }
}

function normalizePhone(phone: string): string | null {
  const clean = phone.replace(/[^\d+]/g, "").trim();
  if (!clean) return null;
  return clean.startsWith("+") ? clean.slice(1) : clean;
}

function formatDate(value: Date | string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => vars[key] ?? "");
}

async function getSettingsRow(tenantId: string): Promise<WhatsAppSettingsRow> {
  await ensureSchema();
  await ensureTenantDefaults(tenantId);
  const [rows] = await pool.query<WhatsAppSettingsRow[]>(
    `SELECT * FROM whatsapp_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  if (!rows[0]) throw new Error("whatsapp_settings_not_found");
  const envKey = process.env.WAHA_API_KEY?.trim() || null;
  const envUrl = process.env.WAHA_INTERNAL_URL?.trim() || null;
  const envSession = process.env.WAHA_SESSION_NAME?.trim() || null;
  const row = rows[0];
  // Prefer deployment env values over DB row to avoid stale keys after redeploy.
  const resolvedUrl = envUrl || row.waha_url || null;
  const resolvedSession = envSession || row.session_name || "default";
  const resolvedKey = envKey || row.api_key || null;
  return {
    ...row,
    api_key: resolvedKey,
    waha_url: resolvedUrl,
    session_name: resolvedSession,
  };
}

async function getTemplateMap(tenantId: string): Promise<Record<WhatsAppTemplateKey, string>> {
  await ensureSchema();
  await ensureTenantDefaults(tenantId);
  const [rows] = await pool.query<WhatsAppTemplateRow[]>(
    `SELECT template_key, body FROM whatsapp_templates WHERE tenant_id = ?`,
    [tenantId]
  );
  const map: Record<WhatsAppTemplateKey, string> = {
    new_account: DEFAULT_TEMPLATES.new_account,
    expiry_soon: DEFAULT_TEMPLATES.expiry_soon,
    payment_due: DEFAULT_TEMPLATES.payment_due,
    usage_threshold: DEFAULT_TEMPLATES.usage_threshold,
  };
  for (const row of rows) {
    map[row.template_key] = row.body;
  }
  return map;
}

async function setLastCheck(tenantId: string, ok: boolean, error: string | null): Promise<void> {
  await pool.execute(
    `UPDATE whatsapp_settings
     SET last_check_ok = ?, last_check_at = NOW(), last_error = ?
     WHERE tenant_id = ?`,
    [ok ? 1 : 0, error, tenantId]
  );
}

async function sendWahaMessage(
  settings: WhatsAppSettingsRow,
  phone: string,
  text: string
): Promise<{ providerId: string | null }> {
  const baseUrl = String(settings.waha_url ?? "").replace(/\/+$/, "");
  const session = String(settings.session_name ?? "").trim();
  if (!baseUrl || !session) throw new Error("waha_not_configured");
  const chatId = `${phone}@c.us`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (settings.api_key) {
    headers.Authorization = `Bearer ${settings.api_key}`;
    headers["X-Api-Key"] = settings.api_key;
  }
  const runtime = await getSessionRuntimeStatus(settings);
  if (!runtime.connected) {
    throw new Error(`waha_session_not_ready:${runtime.status ?? "unknown"}`);
  }
  const response = await fetch(`${baseUrl}/api/sendText`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      session,
      chatId,
      text,
    }),
  });
  const textBody = await response.text();
  if (!response.ok) {
    throw new Error(`waha_send_failed: ${response.status} ${textBody.slice(0, 300)}`);
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(textBody);
  } catch {
    parsed = null;
  }
  const providerId =
    typeof parsed === "object" && parsed !== null && "id" in parsed
      ? String((parsed as { id?: unknown }).id ?? "")
      : null;
  return { providerId: providerId || null };
}

async function ensureSessionReady(settings: WhatsAppSettingsRow): Promise<void> {
  const baseUrl = String(settings.waha_url ?? "").replace(/\/+$/, "");
  const session = String(settings.session_name ?? "").trim();
  if (!baseUrl || !session) throw new Error("waha_not_configured");
  const headers: Record<string, string> = {};
  if (settings.api_key) {
    headers.Authorization = `Bearer ${settings.api_key}`;
    headers["X-Api-Key"] = settings.api_key;
  }

  const current = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(session)}`, { headers });
  if (current.status === 404) {
    await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: session }),
    });
  }
  await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(session)}/start`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  });
}

async function tryFetchQr(
  settings: WhatsAppSettingsRow
): Promise<{ qrDataUrl: string | null; connected: boolean; message: string | null }> {
  const baseUrl = String(settings.waha_url ?? "").replace(/\/+$/, "");
  const session = String(settings.session_name ?? "").trim();
  if (!baseUrl || !session) return { qrDataUrl: null, connected: false, message: "waha_not_configured" };

  const headers: Record<string, string> = {};
  if (settings.api_key) {
    headers.Authorization = `Bearer ${settings.api_key}`;
    headers["X-Api-Key"] = settings.api_key;
  }

  const endpoints = [
    `/api/${encodeURIComponent(session)}/auth/qr`,
    `/api/sessions/${encodeURIComponent(session)}/qr`,
    `/api/${encodeURIComponent(session)}/qr`,
  ];

  for (const ep of endpoints) {
    try {
      const resp = await fetch(`${baseUrl}${ep}`, { headers });
      if (!resp.ok) continue;
      const contentType = String(resp.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.startsWith("image/")) {
        const mime = contentType.split(";")[0] || "image/png";
        const bytes = Buffer.from(await resp.arrayBuffer());
        return {
          qrDataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
          connected: false,
          message: null,
        };
      }
      const body = await resp.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }

      if (typeof parsed === "string" && parsed.includes("data:image")) {
        return { qrDataUrl: parsed, connected: false, message: null };
      }
      if (typeof parsed === "object" && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        const connected = Boolean(obj.connected ?? obj.isConnected ?? false);
        const qr =
          (typeof obj.qr === "string" ? obj.qr : null) ??
          (typeof obj.qrCode === "string" ? obj.qrCode : null) ??
          (typeof obj.value === "string" ? obj.value : null) ??
          null;
        if (connected) return { qrDataUrl: null, connected: true, message: null };
        if (qr) {
          const qrDataUrl = qr.startsWith("data:image")
            ? qr
            : `data:image/png;base64,${qr.replace(/^data:image\/png;base64,/, "")}`;
          return { qrDataUrl, connected: false, message: null };
        }
      }
    } catch {
      // Try next endpoint
    }
  }

  return { qrDataUrl: null, connected: false, message: "qr_unavailable" };
}

async function getSessionRuntimeStatus(
  settings: WhatsAppSettingsRow
): Promise<{ connected: boolean; status: string | null }> {
  const baseUrl = String(settings.waha_url ?? "").replace(/\/+$/, "");
  const session = String(settings.session_name ?? "").trim();
  if (!baseUrl || !session) return { connected: false, status: null };
  const headers: Record<string, string> = {};
  if (settings.api_key) {
    headers.Authorization = `Bearer ${settings.api_key}`;
    headers["X-Api-Key"] = settings.api_key;
  }
  try {
    const resp = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(session)}`, { headers });
    if (!resp.ok) return { connected: false, status: null };
    const parsed = (await resp.json()) as { status?: unknown; me?: unknown };
    const status = String(parsed.status ?? "").toUpperCase();
    const connected = ["WORKING", "READY", "CONNECTED", "AUTHENTICATED"].includes(status) || Boolean(parsed.me);
    return { connected, status: status || null };
  } catch {
    return { connected: false, status: null };
  }
}

async function getSessionOwnerPhoneFromRuntime(settings: WhatsAppSettingsRow): Promise<string | null> {
  const baseUrl = String(settings.waha_url ?? "").replace(/\/+$/, "");
  const session = String(settings.session_name ?? "").trim();
  if (!baseUrl || !session) return null;
  const headers: Record<string, string> = {};
  if (settings.api_key) {
    headers.Authorization = `Bearer ${settings.api_key}`;
    headers["X-Api-Key"] = settings.api_key;
  }
  try {
    const resp = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(session)}`, { headers });
    if (!resp.ok) return null;
    const parsed = (await resp.json()) as Record<string, unknown>;
    const me = (parsed.me ?? null) as Record<string, unknown> | null;
    const candidates = [
      typeof me?.id === "string" ? me.id : null,
      typeof me?.user === "string" ? me.user : null,
      typeof me?.wid === "string" ? me.wid : null,
      typeof parsed.id === "string" ? parsed.id : null,
    ].filter(Boolean) as string[];
    for (const raw of candidates) {
      const phone = normalizePhone(raw.replace(/@c\.us$/i, ""));
      if (phone) return phone;
    }
    return null;
  } catch {
    return null;
  }
}

async function enforceMessageInterval(tenantId: string, settings: WhatsAppSettingsRow): Promise<void> {
  const sec = Math.max(0, Number(settings.message_interval_seconds ?? 30));
  if (sec <= 0) return;
  const now = Date.now();
  const nextAllowed = nextAllowedSendByTenant.get(tenantId) ?? 0;
  if (nextAllowed > now) {
    await new Promise((resolve) => setTimeout(resolve, nextAllowed - now));
  }
  nextAllowedSendByTenant.set(tenantId, Date.now() + sec * 1000);
}

async function insertMessageLog(input: {
  tenantId: string;
  subscriberId: string | null;
  phone: string;
  templateKey: WhatsAppLogTemplateKey | null;
  messageBody: string;
  status: "sent" | "failed";
  providerMessageId: string | null;
  errorMessage: string | null;
  retryOf?: string | null;
}): Promise<void> {
  await pool.execute(
    `INSERT INTO whatsapp_message_logs
      (id, tenant_id, subscriber_id, phone, template_key, message_body, status, provider_message_id, error_message, retry_of, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.tenantId,
      input.subscriberId,
      input.phone,
      input.templateKey,
      input.messageBody,
      input.status,
      input.providerMessageId,
      input.errorMessage,
      input.retryOf ?? null,
      input.status === "sent" ? new Date() : null,
    ]
  );
  await emitEvent(Events.WHATSAPP_SENT, {
    tenantId: input.tenantId,
    subscriberId: input.subscriberId,
    phone: input.phone,
    templateKey: input.templateKey,
    status: input.status,
    providerMessageId: input.providerMessageId,
    errorMessage: input.errorMessage,
  }).catch(() => {
    // Event bus failures must not affect delivery path.
  });
}

/**
 * Remove stale WAHA credentials stored in the DB when the deployment provides
 * them via environment variables. Without this, a value persisted from a
 * previous `.env` would shadow the freshly set variables for code paths that
 * read `whatsapp_settings` directly (observability, audit, etc.).
 */
export async function normalizeWhatsAppSettingsFromEnv(): Promise<void> {
  try {
    await ensureSchema();
  } catch (error) {
    console.warn("[whatsapp] normalize schema skipped", (error as Error).message);
    return;
  }
  const envKey = process.env.WAHA_API_KEY?.trim();
  const envUrl = process.env.WAHA_INTERNAL_URL?.trim();
  const envSession = process.env.WAHA_SESSION_NAME?.trim();
  const updates: string[] = [];
  if (envKey) updates.push("api_key = NULL");
  if (envUrl) updates.push("waha_url = NULL");
  if (envSession) updates.push(`session_name = ${pool.escape(envSession)}`);
  if (updates.length === 0) return;
  try {
    await pool.query(`UPDATE whatsapp_settings SET ${updates.join(", ")}`);
  } catch (error) {
    console.warn("[whatsapp] normalize settings skipped", (error as Error).message);
  }
}

export async function getWhatsAppStatus(tenantId: string): Promise<WhatsAppStatus> {
  const settings = await getSettingsRow(tenantId);
  const configured = Boolean(settings.waha_url && settings.session_name);
  let connected = Boolean(settings.enabled && configured && settings.last_check_ok);
  let lastError = settings.last_error ?? null;
  if (settings.enabled && configured) {
    const runtime = await getSessionRuntimeStatus(settings);
    if (runtime.status) {
      connected = runtime.connected;
      if (runtime.connected) {
        await setLastCheck(tenantId, true, null);
        lastError = null;
      } else {
        const runtimeErr = `session_not_ready:${runtime.status}`;
        await setLastCheck(tenantId, false, runtimeErr);
        lastError = runtimeErr;
      }
    } else if (!runtime.connected) {
      connected = false;
      const runtimeErr = "session_unreachable";
      await setLastCheck(tenantId, false, runtimeErr);
      lastError = runtimeErr;
    }
  }
  return {
    enabled: Boolean(settings.enabled),
    configured,
    connected,
    reminder_days: Number(settings.reminder_days ?? 5),
    message_interval_seconds: Number(settings.message_interval_seconds ?? 30),
    auto_send_new: Boolean(settings.auto_send_new),
    usage_alert_thresholds: parseUsageThresholds(settings.usage_alert_thresholds),
    last_error: lastError,
    last_check_at: settings.last_check_at ?? null,
  };
}

export async function getWhatsAppSettings(tenantId: string): Promise<WhatsAppSettingsView> {
  const settings = await getSettingsRow(tenantId);
  return {
    enabled: Boolean(settings.enabled),
    waha_url: String(settings.waha_url ?? ""),
    session_name: String(settings.session_name ?? ""),
    api_key: String(settings.api_key ?? ""),
    reminder_days: Number(settings.reminder_days ?? 5),
    message_interval_seconds: Number(settings.message_interval_seconds ?? 30),
    auto_send_new: Boolean(settings.auto_send_new),
    usage_alert_thresholds: parseUsageThresholds(settings.usage_alert_thresholds),
  };
}

export async function updateWhatsAppSettings(
  tenantId: string,
  input: {
    enabled: boolean;
    waha_url: string;
    session_name: string;
    api_key?: string;
    reminder_days: number;
    message_interval_seconds: number;
    auto_send_new: boolean;
    usage_alert_thresholds: number[];
  }
): Promise<WhatsAppSettingsView> {
  await ensureSchema();
  await ensureTenantDefaults(tenantId);
  await pool.execute(
    `UPDATE whatsapp_settings
     SET enabled = ?, waha_url = ?, session_name = ?, api_key = ?, reminder_days = ?, message_interval_seconds = ?, auto_send_new = ?,
         usage_alert_thresholds = ?,
         last_check_ok = NULL, last_check_at = NULL, last_error = NULL
     WHERE tenant_id = ?`,
    [
      input.enabled ? 1 : 0,
      input.waha_url.trim() || null,
      input.session_name.trim() || null,
      (input.api_key ?? "").trim() || null,
      input.reminder_days,
      input.message_interval_seconds,
      input.auto_send_new ? 1 : 0,
      parseUsageThresholds(input.usage_alert_thresholds.join(",")).join(","),
      tenantId,
    ]
  );
  return getWhatsAppSettings(tenantId);
}

export async function testWhatsAppConnection(tenantId: string): Promise<WhatsAppStatus> {
  const settings = await getSettingsRow(tenantId);
  if (!settings.enabled) {
    await setLastCheck(tenantId, true, null);
    return getWhatsAppStatus(tenantId);
  }
  try {
    const baseUrl = String(settings.waha_url ?? "").replace(/\/+$/, "");
    const headers: Record<string, string> = {};
    if (settings.api_key) {
      headers.Authorization = `Bearer ${settings.api_key}`;
      headers["X-Api-Key"] = settings.api_key;
    }
    const resp = await fetch(`${baseUrl}/api/sessions`, { headers });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`waha_check_failed: ${resp.status} ${text.slice(0, 300)}`);
    }
    await ensureSessionReady(settings);
    const runtime = await getSessionRuntimeStatus(settings);
    if (!runtime.connected) {
      throw new Error(`session_not_ready:${runtime.status ?? "unknown"}`);
    }
    await setLastCheck(tenantId, true, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setLastCheck(tenantId, false, msg.slice(0, 4000));
  }
  return getWhatsAppStatus(tenantId);
}

export async function listWhatsAppTemplates(tenantId: string): Promise<WhatsAppTemplateView[]> {
  await ensureSchema();
  await ensureTenantDefaults(tenantId);
  const [rows] = await pool.query<WhatsAppTemplateRow[]>(
    `SELECT template_key, body, updated_at
     FROM whatsapp_templates
     WHERE tenant_id = ?
     ORDER BY template_key`,
    [tenantId]
  );
  return rows.map((r) => ({
    template_key: r.template_key,
    body: r.body,
    updated_at: r.updated_at ?? null,
  }));
}

export async function updateWhatsAppTemplate(
  tenantId: string,
  key: WhatsAppTemplateKey,
  body: string
): Promise<void> {
  await ensureSchema();
  await ensureTenantDefaults(tenantId);
  await pool.execute(
    `UPDATE whatsapp_templates
     SET body = ?
     WHERE tenant_id = ? AND template_key = ?`,
    [body, tenantId, key]
  );
}

export async function applyProfessionalArabicTemplates(tenantId: string): Promise<void> {
  await updateWhatsAppTemplate(tenantId, "new_account", DEFAULT_TEMPLATES.new_account);
  await updateWhatsAppTemplate(tenantId, "expiry_soon", DEFAULT_TEMPLATES.expiry_soon);
  await updateWhatsAppTemplate(tenantId, "payment_due", DEFAULT_TEMPLATES.payment_due);
  await updateWhatsAppTemplate(tenantId, "usage_threshold", DEFAULT_TEMPLATES.usage_threshold);
}

export async function sendUsageThresholdAlerts(tenantId: string): Promise<{ sent: number; failed: number }> {
  const settings = await getSettingsRow(tenantId);
  if (!settings.enabled) return { sent: 0, failed: 0 };
  const thresholds = parseUsageThresholds(settings.usage_alert_thresholds);
  if (thresholds.length === 0) return { sent: 0, failed: 0 };
  const templates = await getTemplateMap(tenantId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
        s.id,
        s.username,
        s.first_name,
        s.last_name,
        s.nickname,
        s.phone,
        s.expiration_date,
        p.quota_total_bytes,
        COALESCE(u.total_bytes, s.used_bytes, 0) AS used_bytes
      FROM subscribers s
      JOIN packages p ON p.id = s.package_id
      LEFT JOIN user_usage_live u ON u.tenant_id = s.tenant_id AND u.username = s.username
      WHERE s.tenant_id = ?
        AND s.status = 'active'
        AND s.phone IS NOT NULL
        AND s.phone <> ''
        AND p.quota_total_bytes > 0`,
    [tenantId]
  );
  const monthKey = new Date().toISOString().slice(0, 7);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const subscriberId = String(row.id ?? "");
    const phone = normalizePhone(String(row.phone ?? ""));
    if (!phone) continue;
    const quota = Number(row.quota_total_bytes ?? 0);
    const used = Number(row.used_bytes ?? 0);
    if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(used) || used <= 0) continue;
    const usagePercent = Math.max(0, Math.min(100, (used / quota) * 100));
    const reached = thresholds.filter((x) => usagePercent >= x).sort((a, b) => b - a);
    if (reached.length === 0) continue;
    let targetThreshold: number | null = null;
    for (const threshold of reached) {
      const [exists] = await pool.query<RowDataPacket[]>(
        `SELECT subscriber_id
         FROM whatsapp_usage_alerts_sent
         WHERE tenant_id = ? AND subscriber_id = ? AND threshold_percent = ? AND month_key = ?
         LIMIT 1`,
        [tenantId, subscriberId, threshold, monthKey]
      );
      if (!exists[0]) {
        targetThreshold = threshold;
        break;
      }
    }
    if (!targetThreshold) continue;
    const fullName =
      [String(row.first_name ?? ""), String(row.last_name ?? "")]
        .map((x) => x.trim())
        .filter(Boolean)
        .join(" ") ||
      String(row.nickname ?? "").trim() ||
      String(row.username ?? "");
    const expDate = row.expiration_date ? new Date(String(row.expiration_date)) : null;
    const daysLeft =
      expDate && !Number.isNaN(expDate.getTime())
        ? Math.max(
            0,
            Math.ceil((new Date(expDate.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000)
          )
        : 0;
    const msg = interpolate(templates.usage_threshold, {
      full_name: fullName,
      username: String(row.username ?? ""),
      usage_percent: String(targetThreshold),
      used_gb: (used / 1024 ** 3).toFixed(2),
      quota_gb: (quota / 1024 ** 3).toFixed(2),
      remaining_percent: String(Math.max(0, Math.round(100 - usagePercent))),
      expiration_date: formatDate(expDate),
      days_left: String(daysLeft),
    });
    try {
      await enforceMessageInterval(tenantId, settings);
      const result = await sendWahaMessage(settings, phone, msg);
      await insertMessageLog({
        tenantId,
        subscriberId,
        phone,
        templateKey: "usage_threshold",
        messageBody: msg,
        status: "sent",
        providerMessageId: result.providerId,
        errorMessage: null,
      });
      await pool.execute(
        `INSERT INTO whatsapp_usage_alerts_sent (tenant_id, subscriber_id, threshold_percent, month_key)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE created_at = created_at`,
        [tenantId, subscriberId, targetThreshold, monthKey]
      );
      sent += 1;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await insertMessageLog({
        tenantId,
        subscriberId,
        phone,
        templateKey: "usage_threshold",
        messageBody: msg,
        status: "failed",
        providerMessageId: null,
        errorMessage: err.slice(0, 4000),
      });
      failed += 1;
    }
  }
  if (failed > 0) await setLastCheck(tenantId, false, `usage_threshold_failed=${failed}`);
  else await setLastCheck(tenantId, true, null);
  return { sent, failed };
}

export async function sendPaymentDueReminders(tenantId: string): Promise<{ sent: number; failed: number }> {
  const settings = await getSettingsRow(tenantId);
  if (!settings.enabled) return { sent: 0, failed: 0 };
  const templates = await getTemplateMap(tenantId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
        s.id,
        s.username,
        s.first_name,
        s.last_name,
        s.nickname,
        s.phone,
        COUNT(i.id) AS unpaid_count,
        COALESCE(SUM(i.amount), 0) AS due_amount,
        MAX(i.currency) AS currency,
        MIN(i.due_date) AS oldest_due_date
      FROM subscribers s
      JOIN invoices i
        ON i.subscriber_id = s.id
       AND i.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?
        AND s.status = 'active'
        AND s.phone IS NOT NULL
        AND s.phone <> ''
        AND i.status <> 'paid'
      GROUP BY s.id, s.username, s.first_name, s.last_name, s.nickname, s.phone
      HAVING COALESCE(SUM(i.amount), 0) > 0`,
    [tenantId]
  );
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const subscriberId = String(row.id ?? "");
    const phone = normalizePhone(String(row.phone ?? ""));
    if (!phone) continue;
    const [alreadyRows] = await pool.query<RowDataPacket[]>(
      `SELECT id
       FROM whatsapp_message_logs
       WHERE tenant_id = ?
         AND subscriber_id = ?
         AND template_key = 'payment_due'
         AND DATE(created_at) = CURDATE()
       LIMIT 1`,
      [tenantId, subscriberId]
    );
    if (alreadyRows[0]) continue;
    const fullName =
      [String(row.first_name ?? ""), String(row.last_name ?? "")]
        .map((x) => x.trim())
        .filter(Boolean)
        .join(" ") ||
      String(row.nickname ?? "").trim() ||
      String(row.username ?? "");
    const message = interpolate(templates.payment_due, {
      full_name: fullName,
      username: String(row.username ?? ""),
      due_amount: Number(row.due_amount ?? 0).toFixed(2),
      currency: String(row.currency ?? "USD").toUpperCase() === "SYP" ? "SYP" : "USD",
      unpaid_count: String(Number(row.unpaid_count ?? 0)),
      oldest_due_date: formatDate(row.oldest_due_date ? String(row.oldest_due_date) : null),
    });
    try {
      await enforceMessageInterval(tenantId, settings);
      const result = await sendWahaMessage(settings, phone, message);
      await insertMessageLog({
        tenantId,
        subscriberId,
        phone,
        templateKey: "payment_due",
        messageBody: message,
        status: "sent",
        providerMessageId: result.providerId,
        errorMessage: null,
      });
      sent += 1;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await insertMessageLog({
        tenantId,
        subscriberId,
        phone,
        templateKey: "payment_due",
        messageBody: message,
        status: "failed",
        providerMessageId: null,
        errorMessage: err.slice(0, 4000),
      });
      failed += 1;
    }
  }
  if (failed > 0) await setLastCheck(tenantId, false, `payment_due_failed=${failed}`);
  else await setLastCheck(tenantId, true, null);
  return { sent, failed };
}

export async function listWhatsAppLogs(tenantId: string, limit = 100): Promise<WhatsAppLogView[]> {
  await ensureSchema();
  const safeLimit = Math.max(1, Math.min(300, limit));
  const [rows] = await pool.query<WhatsAppLogRow[]>(
    `SELECT *
     FROM whatsapp_message_logs
     WHERE tenant_id = ?
     ORDER BY created_at DESC
     LIMIT ${safeLimit}`,
    [tenantId]
  );
  return rows.map((r) => ({
    id: r.id,
    subscriber_id: r.subscriber_id,
    phone: r.phone,
    template_key: r.template_key,
    message_body: r.message_body,
    status: r.status,
    provider_message_id: r.provider_message_id,
    error_message: r.error_message,
    retry_of: r.retry_of,
    created_at: r.created_at,
    sent_at: r.sent_at,
  }));
}

export async function deleteWhatsAppLogs(
  tenantId: string,
  input: { all?: boolean; failedOnly?: boolean; ids?: string[] }
): Promise<number> {
  await ensureSchema();
  const ids = (input.ids ?? []).map((x) => x.trim()).filter(Boolean);
  if (input.all) {
    const [res] = await pool.execute(
      `DELETE FROM whatsapp_message_logs WHERE tenant_id = ?`,
      [tenantId]
    );
    return Number((res as { affectedRows?: number }).affectedRows ?? 0);
  }
  if (input.failedOnly) {
    const [res] = await pool.execute(
      `DELETE FROM whatsapp_message_logs WHERE tenant_id = ? AND status = 'failed'`,
      [tenantId]
    );
    return Number((res as { affectedRows?: number }).affectedRows ?? 0);
  }
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const [res] = await pool.execute(
    `DELETE FROM whatsapp_message_logs WHERE tenant_id = ? AND id IN (${placeholders})`,
    [tenantId, ...ids]
  );
  return Number((res as { affectedRows?: number }).affectedRows ?? 0);
}

export async function resendFailedWhatsAppMessages(
  tenantId: string,
  limit = 100
): Promise<{ attempted: number; sent: number; failed: number }> {
  await ensureSchema();
  const safeLimit = Math.max(1, Math.min(300, limit));
  const [rows] = await pool.query<WhatsAppLogRow[]>(
    `SELECT * FROM whatsapp_message_logs
     WHERE tenant_id = ? AND status = 'failed'
     ORDER BY created_at DESC
     LIMIT ${safeLimit}`,
    [tenantId]
  );
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const retried = await resendWhatsAppMessage(tenantId, row.id);
      if (retried?.status === "sent") sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: rows.length, sent, failed };
}

export async function getWhatsAppQr(tenantId: string): Promise<WhatsAppQrView> {
  const settings = await getSettingsRow(tenantId);
  if (!settings.enabled) {
    return { qr_data_url: null, connected: false, message: "whatsapp_disabled" };
  }
  try {
    await ensureSessionReady(settings);
  } catch {
    // Keep going to QR endpoints; caller will see unavailable state.
  }
  const qr = await tryFetchQr(settings);
  if (!qr.qrDataUrl && !qr.connected) {
    const runtime = await getSessionRuntimeStatus(settings);
    if (runtime.connected) {
      await setLastCheck(tenantId, true, null);
      return { qr_data_url: null, connected: true, message: null };
    }
    await setLastCheck(tenantId, false, `session_not_ready:${runtime.status ?? "unknown"}`);
  }
  if (qr.connected) {
    await setLastCheck(tenantId, true, null);
  }
  return {
    qr_data_url: qr.qrDataUrl,
    connected: qr.connected,
    message: qr.message,
  };
}

export async function sendNewSubscriberWhatsApp(input: {
  tenantId: string;
  subscriberId: string;
  phone?: string | null;
  username: string;
  fullName?: string | null;
  password: string;
  packageName: string;
  speed: string;
  expirationDate: Date | string | null;
}): Promise<void> {
  const settings = await getSettingsRow(input.tenantId);
  if (!settings.enabled || !settings.auto_send_new) return;
  const normalized = normalizePhone(input.phone ?? "");
  if (!normalized) return;
  const templates = await getTemplateMap(input.tenantId);
  const message = interpolate(templates.new_account, {
    username: input.username,
    full_name: input.fullName || input.username,
    password: input.password,
    package_name: input.packageName || "-",
    speed: input.speed || "-",
    expiration_date: formatDate(input.expirationDate),
  });
  try {
    await enforceMessageInterval(input.tenantId, settings);
    const sent = await sendWahaMessage(settings, normalized, message);
    await insertMessageLog({
      tenantId: input.tenantId,
      subscriberId: input.subscriberId,
      phone: normalized,
      templateKey: "new_account",
      messageBody: message,
      status: "sent",
      providerMessageId: sent.providerId,
      errorMessage: null,
    });
    await setLastCheck(input.tenantId, true, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await insertMessageLog({
      tenantId: input.tenantId,
      subscriberId: input.subscriberId,
      phone: normalized,
      templateKey: "new_account",
      messageBody: message,
      status: "failed",
      providerMessageId: null,
      errorMessage: msg.slice(0, 4000),
    });
    await setLastCheck(input.tenantId, false, msg.slice(0, 4000));
  }
}

export async function sendExpiryReminders(tenantId: string): Promise<{ sent: number; failed: number }> {
  const settings = await getSettingsRow(tenantId);
  if (!settings.enabled) return { sent: 0, failed: 0 };
  const reminderDays = Number(settings.reminder_days ?? 5);
  const templates = await getTemplateMap(tenantId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
        s.id,
        s.username,
        s.first_name,
        s.last_name,
        s.nickname,
        s.phone,
        s.expiration_date,
        p.name AS package_name,
        p.mikrotik_rate_limit
      FROM subscribers s
      LEFT JOIN packages p ON p.id = s.package_id
      WHERE s.tenant_id = ?
        AND s.status = 'active'
        AND s.phone IS NOT NULL
        AND s.phone <> ''
        AND DATE(s.expiration_date) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
    [tenantId, reminderDays]
  );
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const subscriberId = String(row.id ?? "");
    const normalized = normalizePhone(String(row.phone ?? ""));
    if (!normalized) continue;
    const [alreadyRows] = await pool.query<RowDataPacket[]>(
      `SELECT id
       FROM whatsapp_message_logs
       WHERE tenant_id = ?
         AND subscriber_id = ?
         AND template_key = 'expiry_soon'
         AND DATE(created_at) = CURDATE()
       LIMIT 1`,
      [tenantId, subscriberId]
    );
    if (alreadyRows[0]) continue;
    const expDate = row.expiration_date ? new Date(String(row.expiration_date)) : null;
    const daysLeft =
      expDate && !Number.isNaN(expDate.getTime())
        ? Math.max(
            0,
            Math.ceil((new Date(expDate.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000)
          )
        : 0;
    const msg = interpolate(templates.expiry_soon, {
      username: String(row.username ?? ""),
      full_name:
        [String(row.first_name ?? ""), String(row.last_name ?? "")]
          .map((x) => x.trim())
          .filter(Boolean)
          .join(" ") ||
        String(row.nickname ?? "").trim() ||
        String(row.username ?? ""),
      package_name: String(row.package_name ?? "-"),
      speed: String(row.mikrotik_rate_limit ?? "-"),
      expiration_date: formatDate(expDate),
      days_left: String(daysLeft),
    });
    try {
      await enforceMessageInterval(tenantId, settings);
      const result = await sendWahaMessage(settings, normalized, msg);
      await insertMessageLog({
        tenantId,
        subscriberId,
        phone: normalized,
        templateKey: "expiry_soon",
        messageBody: msg,
        status: "sent",
        providerMessageId: result.providerId,
        errorMessage: null,
      });
      sent += 1;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await insertMessageLog({
        tenantId,
        subscriberId,
        phone: normalized,
        templateKey: "expiry_soon",
        messageBody: msg,
        status: "failed",
        providerMessageId: null,
        errorMessage: err.slice(0, 4000),
      });
      failed += 1;
    }
  }
  if (failed > 0) {
    await setLastCheck(tenantId, false, `failed_messages=${failed}`);
  } else {
    await setLastCheck(tenantId, true, null);
  }
  return { sent, failed };
}

export async function sendWhatsAppBroadcast(
  tenantId: string,
  input: WhatsAppBroadcastInput
): Promise<{ total: number; sent: number; failed: number }> {
  const settings = await getSettingsRow(tenantId);
  if (!settings.enabled) throw new Error("whatsapp_disabled");
  const message = input.message.trim();
  if (!message) throw new Error("empty_message");

  const filters: string[] = [`s.tenant_id = ?`, `s.status = 'active'`, `s.phone IS NOT NULL`, `s.phone <> ''`];
  const params: (string | number)[] = [tenantId];
  if (input.filter_type === "speed") {
    filters.push(`p.mikrotik_rate_limit = ?`);
    params.push(String(input.speed ?? ""));
  } else if (input.filter_type === "region") {
    filters.push(`(s.address LIKE ? OR s.pool LIKE ?)`);
    params.push(`%${String(input.region ?? "").trim()}%`, `%${String(input.region ?? "").trim()}%`);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.phone
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id
     WHERE ${filters.join(" AND ")}`,
    params
  );

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const phone = normalizePhone(String(row.phone ?? ""));
    if (!phone) continue;
    try {
      await enforceMessageInterval(tenantId, settings);
      const result = await sendWahaMessage(settings, phone, message);
      await insertMessageLog({
        tenantId,
        subscriberId: row.id ? String(row.id) : null,
        phone,
        templateKey: null,
        messageBody: message,
        status: "sent",
        providerMessageId: result.providerId,
        errorMessage: null,
      });
      sent += 1;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await insertMessageLog({
        tenantId,
        subscriberId: row.id ? String(row.id) : null,
        phone,
        templateKey: null,
        messageBody: message,
        status: "failed",
        providerMessageId: null,
        errorMessage: err.slice(0, 4000),
      });
      failed += 1;
    }
  }
  if (failed > 0) await setLastCheck(tenantId, false, `broadcast_failed=${failed}`);
  else await setLastCheck(tenantId, true, null);
  return { total: rows.length, sent, failed };
}

export async function resendWhatsAppMessage(tenantId: string, logId: string): Promise<WhatsAppLogView | null> {
  await ensureSchema();
  const settings = await getSettingsRow(tenantId);
  if (!settings.enabled) throw new Error("whatsapp_disabled");
  const [rows] = await pool.query<WhatsAppLogRow[]>(
    `SELECT * FROM whatsapp_message_logs WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [tenantId, logId]
  );
  const row = rows[0];
  if (!row) return null;
  try {
    await enforceMessageInterval(tenantId, settings);
    const result = await sendWahaMessage(settings, row.phone, row.message_body);
    await insertMessageLog({
      tenantId,
      subscriberId: row.subscriber_id,
      phone: row.phone,
      templateKey: row.template_key,
      messageBody: row.message_body,
      status: "sent",
      providerMessageId: result.providerId,
      errorMessage: null,
      retryOf: row.id,
    });
    await setLastCheck(tenantId, true, null);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await insertMessageLog({
      tenantId,
      subscriberId: row.subscriber_id,
      phone: row.phone,
      templateKey: row.template_key,
      messageBody: row.message_body,
      status: "failed",
      providerMessageId: null,
      errorMessage: err.slice(0, 4000),
      retryOf: row.id,
    });
    await setLastCheck(tenantId, false, err.slice(0, 4000));
  }
  const [latestRows] = await pool.query<WhatsAppLogRow[]>(
    `SELECT * FROM whatsapp_message_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
    [tenantId]
  );
  const latest = latestRows[0];
  if (!latest) return null;
  return {
    id: latest.id,
    subscriber_id: latest.subscriber_id,
    phone: latest.phone,
    template_key: latest.template_key,
    message_body: latest.message_body,
    status: latest.status,
    provider_message_id: latest.provider_message_id,
    error_message: latest.error_message,
    retry_of: latest.retry_of,
    created_at: latest.created_at,
    sent_at: latest.sent_at,
  };
}

export async function sendInvoicePaidWhatsApp(input: {
  tenantId: string;
  subscriberId: string;
  invoiceNo?: string | null;
  amount?: number | null;
  currency?: string | null;
  paidAt?: Date | string | null;
}): Promise<void> {
  await ensureSchema();
  const settings = await getSettingsRow(input.tenantId);
  if (!settings.enabled) return;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, username, first_name, last_name, nickname, phone
     FROM subscribers
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [input.tenantId, input.subscriberId]
  );
  const row = rows[0];
  if (!row) return;
  const phone = normalizePhone(String(row.phone ?? ""));
  if (!phone) return;
  const fullName =
    [String(row.first_name ?? ""), String(row.last_name ?? "")]
      .map((x) => x.trim())
      .filter(Boolean)
      .join(" ") ||
    String(row.nickname ?? "").trim() ||
    String(row.username ?? "");
  const amountText =
    input.amount != null && Number.isFinite(input.amount)
      ? `${Number(input.amount).toFixed(2)} ${String(input.currency ?? "").trim()}`.trim()
      : null;
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  const paidAtText = Number.isNaN(paidAt.getTime())
    ? String(input.paidAt ?? "")
    : paidAt.toISOString().slice(0, 16).replace("T", " ");
  const message =
    `مرحباً ${fullName}،\n` +
    `تم تأكيد دفع الفاتورة بنجاح.\n` +
    `${input.invoiceNo ? `رقم الفاتورة: ${input.invoiceNo}\n` : ""}` +
    `${amountText ? `المبلغ المدفوع: ${amountText}\n` : ""}` +
    `وقت الدفع: ${paidAtText}\n\n` +
    `شكراً لثقتكم.`;
  try {
    await enforceMessageInterval(input.tenantId, settings);
    const result = await sendWahaMessage(settings, phone, message);
    await insertMessageLog({
      tenantId: input.tenantId,
      subscriberId: input.subscriberId,
      phone,
      templateKey: "invoice_paid",
      messageBody: message,
      status: "sent",
      providerMessageId: result.providerId,
      errorMessage: null,
    });
    await setLastCheck(input.tenantId, true, null);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await insertMessageLog({
      tenantId: input.tenantId,
      subscriberId: input.subscriberId,
      phone,
      templateKey: "invoice_paid",
      messageBody: message,
      status: "failed",
      providerMessageId: null,
      errorMessage: err.slice(0, 4000),
    });
    await setLastCheck(input.tenantId, false, err.slice(0, 4000));
  }
}

export async function resolveWhatsAppSessionOwnerPhone(tenantId: string): Promise<string | null> {
  const settings = await getSettingsRow(tenantId);
  return getSessionOwnerPhoneFromRuntime(settings);
}

export async function sendOperationalAlertWhatsApp(
  tenantId: string,
  phoneOverride: string | null,
  message: string,
  options?: { preferSessionOwner?: boolean }
): Promise<{ sent: boolean; reason?: string; phone?: string | null }> {
  const settings = await getSettingsRow(tenantId);
  if (!settings.enabled) return { sent: false, reason: "whatsapp_disabled" };
  let target = normalizePhone(phoneOverride ?? "");
  if (options?.preferSessionOwner) {
    const owner = await getSessionOwnerPhoneFromRuntime(settings);
    if (owner) target = owner;
  }
  if (!target) return { sent: false, reason: "missing_target_phone" };
  try {
    await enforceMessageInterval(tenantId, settings);
    const result = await sendWahaMessage(settings, target, message);
    await insertMessageLog({
      tenantId,
      subscriberId: null,
      phone: target,
      templateKey: null,
      messageBody: message,
      status: "sent",
      providerMessageId: result.providerId,
      errorMessage: null,
    });
    await setLastCheck(tenantId, true, null);
    return { sent: true, phone: target };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await insertMessageLog({
      tenantId,
      subscriberId: null,
      phone: target,
      templateKey: null,
      messageBody: message,
      status: "failed",
      providerMessageId: null,
      errorMessage: err.slice(0, 4000),
    });
    await setLastCheck(tenantId, false, err.slice(0, 4000));
    return { sent: false, reason: err.slice(0, 400), phone: target };
  }
}
