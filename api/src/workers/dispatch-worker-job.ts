import type { Job } from "bullmq";
import type { Pool } from "mysql2/promise";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { CoaService } from "../services/coa.service.js";
import { NasHealthService } from "../services/nas-health.service.js";
import { maybeRunScheduledBackup } from "../services/backup.service.js";
import {
  sendOperationalAlertWhatsApp,
  resolveWhatsAppSessionOwnerPhone,
  sendExpiryReminders,
  sendInvoicePaidWhatsApp,
  sendNewSubscriberWhatsApp,
  sendPaymentDueReminders,
  sendUsageThresholdAlerts,
  testWhatsAppConnection,
} from "../services/whatsapp.service.js";
import { pruneOldLogs } from "../services/logger.service.js";
import { runUsageAndExpiryCycle } from "../worker/usage.worker.js";
import {
  QueueJobNames,
  type CoaDisconnectJobData,
  type WahaInvoiceReceiptJobData,
  type WahaNewSubscriberJobData,
} from "../services/task-queue.service.js";
import { getSystemSettings } from "../services/system-settings.service.js";
import { hasTable } from "../db/schemaGuards.js";
import { pruneRadpostauth } from "../services/radpostauth-retention.service.js";
import { runPackageDynamicSpeedApplyAllTenants } from "../services/dynamic-speed.service.js";
import {
  runSpeedProfileApplyAllTenants,
  runSpeedProfileRevertAllTenants,
  runSpeedProfileReconcileAllTenants,
} from "../services/speed-profile.service.js";
import { runQoeCycle, runRadiusMonitorCycle, recordCoaEvent } from "./enterprise-analytics.worker.js";
import { log } from "../services/logger.service.js";

export type WorkerDispatchContext = {
  pool: Pool;
  coa: CoaService;
  nasHealth: NasHealthService;
};

async function closeRadacctAfterDisconnect(pool: Pool, payload: CoaDisconnectJobData): Promise<void> {
  const params: string[] = [payload.username, payload.nasIp];
  let where = "username = ? AND nasipaddress = ? AND acctstoptime IS NULL";
  if (payload.acctSessionId) {
    where += " AND acctsessionid = ?";
    params.push(payload.acctSessionId);
  } else if (payload.framedIp) {
    where += " AND framedipaddress = ?";
    params.push(payload.framedIp);
  }
  await pool.execute(
    `UPDATE radacct
     SET acctstoptime = NOW(),
         acctsessiontime = GREATEST(0, TIMESTAMPDIFF(SECOND, acctstarttime, NOW())),
         acctterminatecause = CASE
           WHEN COALESCE(acctterminatecause, '') = '' THEN 'Admin-Reset'
           ELSE acctterminatecause
         END
     WHERE ${where}`,
    params
  );
}

async function generateMonthlyInvoices(pool: Pool): Promise<void> {
  if (false) return;
  const tenantId = config.defaultTenantId;
  if (!(await hasTable(pool, "subscribers")) || !(await hasTable(pool, "packages"))) {
    return;
  }
  const [packs] = await pool.query<RowDataPacket[]>(
    `SELECT s.id AS subscriber_id, p.price, p.billing_period_days, p.currency
     FROM subscribers s
     JOIN packages p ON p.id = s.package_id
     WHERE s.tenant_id = ? AND s.status = 'active' AND p.price > 0`,
    [tenantId]
  );
  const today = new Date().toISOString().slice(0, 10);
  for (const p of packs) {
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM invoices WHERE tenant_id = ? AND subscriber_id = ? AND issue_date = ? AND period = 'monthly' LIMIT 1`,
      [tenantId, p.subscriber_id, today]
    );
    if (existing[0]) continue;
    const id = randomUUID();
    const invNo = `AUTO-${today}-${String(p.subscriber_id).slice(0, 8)}`;
    await pool.execute(
      `INSERT INTO invoices (id, tenant_id, subscriber_id, period, invoice_no, issue_date, due_date,
        amount, currency, status, meta)
       VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, ?, 'sent', JSON_OBJECT('billing_days', ?))`,
      [
        id,
        tenantId,
        p.subscriber_id,
        invNo,
        today,
        today,
        p.price,
        String(p.currency ?? "USD"),
        p.billing_period_days ?? 30,
      ]
    );
  }
}

function isCriticalLogMessage(message: string): boolean {
  const low = message.toLowerCase();
  return (
    low.includes("access denied") ||
    low.includes("uncaughtexception") ||
    low.includes("unhandledrejection") ||
    low.includes("db_error") ||
    low.includes("er_no_such_table") ||
    low.includes("econnrefused") ||
    low.includes("etimedout") ||
    low.includes("waha_send_failed") ||
    low.includes("session_not_ready") ||
    low.includes("worker bootstrap failed") ||
    low.includes("job_failed") ||
    low.includes("illegal mix of collations") ||
    (low.includes("migrations") && low.includes("failed")) ||
    low.includes("freeradius") ||
    low.includes("radius-user") ||
    low.includes("bootstrap failed") ||
    low.includes("socket hang up") ||
    low.includes("no reply from server") ||
    low.includes("eai_again") ||
    low.includes("enotfound")
  );
}

async function sendCriticalOpsAlerts(pool: Pool, tenantId: string): Promise<void> {
  if (!(await hasTable(pool, "server_logs")) || !(await hasTable(pool, "server_log_alerts"))) return;
  const systemSettings = await getSystemSettings(tenantId);
  if (!systemSettings.critical_alert_enabled) return;
  let targetPhone = systemSettings.critical_alert_phone || "";
  if (systemSettings.critical_alert_use_session_owner) {
    const owner = await resolveWhatsAppSessionOwnerPhone(tenantId).catch(() => null);
    if (owner) targetPhone = owner;
  }
  if (!targetPhone) return;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, l.created_at, l.source, l.category, l.message
     FROM server_logs l
     LEFT JOIN server_log_alerts a ON a.log_id = l.id
     WHERE l.level = 'error'
       AND l.created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
       AND a.log_id IS NULL
     ORDER BY l.id ASC
     LIMIT 8`
  );
  for (const row of rows) {
    const message = String(row.message ?? "");
    if (!isCriticalLogMessage(message)) {
      await pool.execute(
        `INSERT INTO server_log_alerts (id, log_id, tenant_id, status, error_message)
         VALUES (?, ?, ?, 'skipped', ?)`,
        [randomUUID(), Number(row.id), tenantId, "not_critical_pattern"]
      );
      continue;
    }
    const stamp = new Date(row.created_at as string | Date).toISOString().replace("T", " ").slice(0, 19);
    const body =
      "تنبيه صيانة عاجل\n" +
      `الوقت: ${stamp}\n` +
      `المصدر: ${String(row.source ?? "system")}${row.category ? `/${String(row.category)}` : ""}\n` +
      `الخطأ: ${message.slice(0, 280)}`;
    const sent = await sendOperationalAlertWhatsApp(tenantId, targetPhone, body, {
      preferSessionOwner: false,
    });
    await pool.execute(
      `INSERT INTO server_log_alerts (id, log_id, tenant_id, status, error_message)
       VALUES (?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        Number(row.id),
        tenantId,
        sent.sent ? "sent" : "failed",
        sent.sent ? null : (sent.reason ?? "send_failed").slice(0, 4000),
      ]
    );
  }
}

export async function dispatchWorkerJob(ctx: WorkerDispatchContext, job: Job): Promise<unknown | void> {
  const { pool, coa, nasHealth } = ctx;
  const tenantId = config.defaultTenantId;
  switch (job.name) {
    case "update-usage":
      await runUsageAndExpiryCycle();
      break;
    case "nas-health":
      await nasHealth.probeAll(tenantId);
      break;
    case "apply-dynamic-speeds":
      await runPackageDynamicSpeedApplyAllTenants(pool);
      break;
    case "speed-profile-apply-cycle":
      await runSpeedProfileApplyAllTenants(pool);
      break;
    case "speed-profile-revert-cycle":
      await runSpeedProfileRevertAllTenants(pool);
      break;
    case "speed-profile-reconcile-cycle":
      await runSpeedProfileReconcileAllTenants(pool);
      break;
    case "generate-invoices":
      await generateMonthlyInvoices(pool);
      break;
    case "backup-scheduler":
      await maybeRunScheduledBackup(tenantId, config.appTimezone);
      break;
    case "whatsapp-expiry-reminders":
      await sendExpiryReminders(tenantId);
      break;
    case "whatsapp-payment-due-reminders":
      await sendPaymentDueReminders(tenantId);
      break;
    case "whatsapp-usage-alerts":
      await sendUsageThresholdAlerts(tenantId);
      break;
    case "whatsapp-health-check":
      await testWhatsAppConnection(tenantId);
      break;
    case "prune-server-logs":
      await pruneOldLogs((await getSystemSettings(tenantId)).server_log_retention_days);
      break;
    case "ops-critical-alerts":
      await sendCriticalOpsAlerts(pool, tenantId);
      break;
    case "prune-radpostauth":
      try {
        const result = await pruneRadpostauth(tenantId);
        log.info(
          `prune_radpostauth_cron ran=${result.ran} deleted=${result.deleted} cutoff=${result.cutoff ?? "-"}`,
          result,
          "radpostauth-retention"
        );
      } catch (error) {
        log.error(
          `prune_radpostauth_cron_failed ${(error as Error)?.message ?? String(error)}`,
          {},
          "radpostauth-retention"
        );
      }
      break;
    case "qoe-cycle":
      await runQoeCycle(pool, tenantId);
      break;
    case "radius-monitor-cycle":
      await runRadiusMonitorCycle(pool, tenantId);
      break;
    case QueueJobNames.WAHA_SEND_INVOICE_RECEIPT: {
      const payload = job.data as WahaInvoiceReceiptJobData;
      await sendInvoicePaidWhatsApp({
        tenantId: payload.tenantId,
        subscriberId: payload.subscriberId,
        invoiceNo: payload.invoiceNo,
        amount: payload.amount,
        currency: payload.currency,
        paidAt: payload.paidAt,
      });
      return { ok: true };
    }
    case QueueJobNames.WAHA_SEND_NEW_SUBSCRIBER: {
      const payload = job.data as WahaNewSubscriberJobData;
      await sendNewSubscriberWhatsApp({
        tenantId: payload.tenantId,
        subscriberId: payload.subscriberId,
        phone: payload.phone,
        username: payload.username,
        fullName: payload.fullName,
        password: payload.password,
        packageName: payload.packageName,
        speed: payload.speed,
        expirationDate: payload.expirationDate,
      });
      return { ok: true };
    }
    case QueueJobNames.COA_DISCONNECT: {
      const payload = job.data as CoaDisconnectJobData;
      const result = await coa.disconnectUserForTenant(
        payload.username,
        payload.nasIp,
        payload.tenantId,
        payload.acctSessionId,
        payload.framedIp
      );
      await recordCoaEvent(pool, payload.tenantId, payload.nasIp, payload.username, result.ok, result.message);
      if (!result.ok) {
        throw new Error(result.message);
      }
      await closeRadacctAfterDisconnect(pool, payload);
      return result;
    }
    default:
      break;
  }
}
