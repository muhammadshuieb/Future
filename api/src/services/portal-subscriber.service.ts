import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasTable } from "../db/schemaGuards.js";
import { hashPortalPassword, verifyPortalPassword } from "../lib/portal-password.js";
import {
  evaluateSubscriberAccessFromRow,
  loadSubscriberAccessRow,
} from "../lib/subscriber-access-guard.js";
import { AccountingService } from "./accounting.service.js";
import { RadiusSyncService } from "./radius-sync.service.js";
import { getSystemSettings } from "./system-settings.service.js";
import { sendSubscriberFinancialReportWhatsApp } from "./whatsapp.service.js";

export type PortalSubscriberRow = RowDataPacket & {
  id: string;
  tenant_id: string;
  username: string;
  radius_password_plain: string;
};

export async function findPortalLoginCandidates(pool: Pool, username: string): Promise<PortalSubscriberRow[]> {
  const [rows] = await pool.query<PortalSubscriberRow[]>(
    `SELECT s.id, s.tenant_id, s.username, s.status, s.used_bytes, s.expiration_date, s.package_id, s.customer_id,
            s.phone, s.first_name, s.last_name, s.nickname, s.region_id, s.nas_server_id, s.created_at,
            c.password AS radius_password_plain
     FROM subscribers s
     INNER JOIN tenants t ON t.id = s.tenant_id AND t.status = 'active'
     INNER JOIN subscriber_credentials c ON c.subscriber_id = s.id AND c.tenant_id = s.tenant_id
     WHERE s.username = ?`,
    [username]
  );
  return rows;
}

export async function getPortalAccount(pool: Pool, tenantId: string, subscriberId: string) {
  if (!(await hasTable(pool, "subscriber_portal_accounts"))) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM subscriber_portal_accounts WHERE tenant_id = ? AND subscriber_id = ? LIMIT 1`,
    [tenantId, subscriberId]
  );
  return rows[0] ?? null;
}

export async function ensurePortalAccountFromRadiusPassword(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  plainPassword: string
): Promise<void> {
  const hash = await hashPortalPassword(plainPassword);
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO subscriber_portal_accounts (id, tenant_id, subscriber_id, password_hash)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), updated_at = CURRENT_TIMESTAMP(3)`,
    [id, tenantId, subscriberId, hash]
  );
}

export async function portalAudit(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  action: string,
  payload: unknown,
  ip: string | undefined
): Promise<void> {
  if (!(await hasTable(pool, "subscriber_portal_audit_logs"))) return;
  await pool.execute(
    `INSERT INTO subscriber_portal_audit_logs (id, tenant_id, subscriber_id, action, payload, ip)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
    [randomUUID(), tenantId, subscriberId, action, JSON.stringify(payload ?? {}), ip ?? null]
  );
}

export async function verifyPortalCredentials(
  pool: Pool,
  row: PortalSubscriberRow,
  password: string,
  otp?: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const tenantId = String(row.tenant_id);
  const subscriberId = String(row.id);
  const access = await loadSubscriberAccessRow(pool, { tenantId, subscriberId });
  const gate = access ? evaluateSubscriberAccessFromRow(access) : { ok: false as const, reason: "not_found" };
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const acct = await getPortalAccount(pool, tenantId, subscriberId);
  if (acct && String(acct.password_hash ?? "")) {
    const ok = await verifyPortalPassword(password, String(acct.password_hash));
    if (ok) return { ok: true };
    if (otp && acct.otp_enabled && acct.otp_code_hash && acct.otp_expires_at) {
      const exp = new Date(String(acct.otp_expires_at)).getTime();
      if (Date.now() > exp) return { ok: false, reason: "otp_expired" };
      const otpOk = await verifyPortalPassword(otp, String(acct.otp_code_hash));
      if (otpOk) return { ok: true };
    }
    return { ok: false, reason: "invalid_credentials" };
  }

  if (String(row.radius_password_plain ?? "") === password) {
    await ensurePortalAccountFromRadiusPassword(pool, tenantId, subscriberId, password);
    return { ok: true };
  }
  return { ok: false, reason: "invalid_credentials" };
}

export async function getPortalMePayload(pool: Pool, tenantId: string, subscriberId: string, username: string) {
  const accounting = new AccountingService(pool);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.*, p.name AS package_name, p.mikrotik_rate_limit, p.quota_total_bytes AS package_quota_bytes,
            reg.name AS region_name,
            (SELECT MIN(sp.starts_at) FROM subscriber_packages sp WHERE sp.subscriber_id = s.id) AS start_date
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     LEFT JOIN subscriber_regions reg ON reg.id = s.region_id
     WHERE s.id = ? AND s.tenant_id = ?
     LIMIT 1`,
    [subscriberId, tenantId]
  );
  const sub = rows[0];
  if (!sub) return null;
  const usage = await accounting.getUserUsage(username);
  const quota = BigInt(String(sub.package_quota_bytes ?? 0));
  const used = usage?.bytes ?? BigInt(String(sub.used_bytes ?? 0));
  const remaining = quota > 0n ? (quota > used ? quota - used : 0n) : null;

  const online = await accounting.listOnlineSessions(tenantId, username, 1);
  const currentIp = online[0]?.framedipaddress ? String(online[0].framedipaddress) : null;

  return {
    subscriber: sub,
    usage_bytes: used.toString(),
    quota_bytes: quota.toString(),
    remaining_bytes: remaining != null ? remaining.toString() : null,
    current_ip: currentIp,
  };
}

export async function getPortalDashboard(pool: Pool, tenantId: string, subscriberId: string, username: string) {
  const me = await getPortalMePayload(pool, tenantId, subscriberId, username);
  if (!me) return null;
  const accounting = new AccountingService(pool);
  const activeSessions = await accounting.countActiveSessions(tenantId, username);

  const [balRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount), 0) AS debt
     FROM invoices
     WHERE tenant_id = ? AND subscriber_id = ? AND LOWER(status) IN ('sent','partial','unpaid','overdue')`,
    [tenantId, subscriberId]
  );
  const balanceDebt = String(balRows[0]?.debt ?? "0");

  return {
    ...me,
    active_sessions: activeSessions,
    balance_debt: balanceDebt,
  };
}

export async function listPortalInvoices(pool: Pool, tenantId: string, subscriberId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, invoice_no, issue_date, due_date, amount, currency, status, period
     FROM invoices
     WHERE tenant_id = ? AND subscriber_id = ?
     ORDER BY issue_date DESC, id DESC
     LIMIT 200`,
    [tenantId, subscriberId]
  );
  return rows;
}

export async function listPaymentMethods(pool: Pool, tenantId: string): Promise<unknown[]> {
  if (!(await hasTable(pool, "system_settings"))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT portal_payment_methods_json FROM system_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  const raw = rows[0]?.portal_payment_methods_json;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function insertSpeedTest(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  body: { latency_ms?: number; download_bps?: bigint | number; upload_bps?: bigint | number; client_meta?: unknown }
) {
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO subscriber_speed_tests (id, tenant_id, subscriber_id, latency_ms, download_bps, upload_bps, client_meta)
     VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      id,
      tenantId,
      subscriberId,
      body.latency_ms ?? null,
      body.download_bps != null ? String(body.download_bps) : null,
      body.upload_bps != null ? String(body.upload_bps) : null,
      JSON.stringify(body.client_meta ?? {}),
    ]
  );
  return id;
}

export async function upsertDevicesFromRadacct(pool: Pool, tenantId: string, subscriberId: string, username: string) {
  if (!(await hasTable(pool, "subscriber_devices"))) return;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT callingstationid AS mac, MAX(COALESCE(acctstoptime, acctupdatetime, acctstarttime)) AS last_seen,
            COUNT(*) AS cnt
     FROM radacct
     WHERE username = ? AND callingstationid IS NOT NULL AND callingstationid <> ''
     GROUP BY callingstationid`,
    [username]
  );
  for (const r of rows) {
    const mac = String(r.mac);
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO subscriber_devices (id, tenant_id, subscriber_id, calling_station_id, first_seen_at, last_seen_at, session_count)
       VALUES (?, ?, ?, ?, COALESCE(?, NOW(3)), COALESCE(?, NOW(3)), ?)
       ON DUPLICATE KEY UPDATE
         last_seen_at = GREATEST(subscriber_devices.last_seen_at, VALUES(last_seen_at)),
         session_count = subscriber_devices.session_count + VALUES(session_count)`,
      [id, tenantId, subscriberId, mac, r.last_seen, r.last_seen, Number(r.cnt ?? 0)]
    );
  }
}

export async function listPortalDevices(pool: Pool, tenantId: string, subscriberId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT calling_station_id, first_seen_at, last_seen_at, session_count
     FROM subscriber_devices
     WHERE tenant_id = ? AND subscriber_id = ?
     ORDER BY last_seen_at DESC
     LIMIT 200`,
    [tenantId, subscriberId]
  );
  return rows;
}

export async function listPortalSessions(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  username: string,
  mode: "active" | "closed"
) {
  const accounting = new AccountingService(pool);
  if (mode === "active") {
    return accounting.listOnlineSessions(tenantId, username, 200);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.radacctid, r.username, r.nasipaddress, r.acctstarttime, r.acctsessiontime,
            r.framedipaddress, r.callingstationid, r.acctinputoctets, r.acctoutputoctets, r.acctstoptime
     FROM radacct r
     INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
     WHERE s.id = ? AND r.username = ? AND r.acctstoptime IS NOT NULL
     ORDER BY r.acctstoptime DESC
     LIMIT 200`,
    [tenantId, subscriberId, username]
  );
  return rows;
}

export async function createPaymentRequest(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  input: { amount: number; currency: string; method: string; invoice_id?: string | null }
) {
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO subscriber_payment_requests (id, tenant_id, subscriber_id, invoice_id, amount, currency, method, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [id, tenantId, subscriberId, input.invoice_id ?? null, input.amount, input.currency, input.method]
  );
  return id;
}

export async function listPaymentRequests(pool: Pool, tenantId: string, subscriberId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM subscriber_payment_requests WHERE tenant_id = ? AND subscriber_id = ? ORDER BY created_at DESC LIMIT 100`,
    [tenantId, subscriberId]
  );
  return rows;
}

export async function portalRenew(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  packageId: string | null,
  radiusSync: RadiusSyncService
): Promise<{ invoice_id: string | null; payment_request_id: string | null }> {
  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT package_id FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [subscriberId, tenantId]
  );
  const targetPackage = packageId ?? String(subRows[0]?.package_id ?? "");
  if (!targetPackage) throw new Error("no_package");
  const [pRows] = await pool.query<RowDataPacket[]>(
    `SELECT price, currency FROM packages WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [targetPackage, tenantId]
  );
  const price = Number(pRows[0]?.price ?? 0);
  const currency = String(pRows[0]?.currency ?? "USD");
  if (price > 0) {
    const invoiceId = randomUUID();
    const invNo = `PORTAL-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);
    await pool.execute(
      `INSERT INTO invoices (id, tenant_id, subscriber_id, period, invoice_no, issue_date, due_date, amount, currency, status, meta)
       VALUES (?, ?, ?, 'one_time', ?, ?, ?, ?, ?, 'sent', JSON_OBJECT('source','portal_renew'))`,
      [invoiceId, tenantId, subscriberId, invNo, today, today, price, currency]
    );
    const payId = await createPaymentRequest(pool, tenantId, subscriberId, {
      amount: price,
      currency,
      method: "portal_renew",
      invoice_id: invoiceId,
    });
    return { invoice_id: invoiceId, payment_request_id: payId };
  }
  await pool.execute(
    `INSERT INTO subscriber_packages (subscriber_id, package_id, starts_at) VALUES (?, ?, NOW())`,
    [subscriberId, targetPackage]
  );
  await radiusSync.syncSubscriber(subscriberId, tenantId);
  return { invoice_id: null, payment_request_id: null };
}

export async function changePortalPassword(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  newPassword: string,
  syncRadius: boolean,
  radiusSync: RadiusSyncService
) {
  const hash = await hashPortalPassword(newPassword);
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO subscriber_portal_accounts (id, tenant_id, subscriber_id, password_hash)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), updated_at = CURRENT_TIMESTAMP(3)`,
    [id, tenantId, subscriberId, hash]
  );
  if (syncRadius) {
    await pool.execute(
      `UPDATE subscriber_credentials SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE subscriber_id = ? AND tenant_id = ?`,
      [newPassword, subscriberId, tenantId]
    );
    await radiusSync.syncSubscriber(subscriberId, tenantId);
  }
}

export async function sendStatementWhatsApp(pool: Pool, tenantId: string, subscriberId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT phone, username, used_bytes, expiration_date FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [subscriberId, tenantId]
  );
  const phone = String(rows[0]?.phone ?? "").trim();
  if (!phone) return { ok: false as const, reason: "missing_phone" };
  const username = String(rows[0]?.username ?? "");
  const used = String(rows[0]?.used_bytes ?? "0");
  const exp = rows[0]?.expiration_date ? String(rows[0].expiration_date).slice(0, 10) : "—";
  const body = `Subscriber statement\nUsername: ${username}\nUsed bytes: ${used}\nExpiry: ${exp}`;
  const r = await sendSubscriberFinancialReportWhatsApp({
    tenantId,
    subscriberId,
    messageBody: body,
  });
  if (!r.sent) return { ok: false as const, reason: r.reason ?? "send_failed" };
  return { ok: true as const };
}

export async function getSupportLinks(pool: Pool, tenantId: string) {
  const settings = await getSystemSettings(tenantId);
  const [w] = await pool.query<RowDataPacket[]>(
    `SELECT accountant_contact_phone FROM system_settings WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  return {
    accountant_phone: String(w[0]?.accountant_contact_phone ?? settings.accountant_contact_phone ?? ""),
    critical_phone: settings.critical_alert_phone ?? "",
  };
}
