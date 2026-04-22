import { randomUUID } from "crypto";
import { Redis } from "ioredis";
import { Queue, Worker } from "bullmq";
import { config } from "../config.js";
import { pool, waitForDbReady } from "../db/pool.js";
import { installLogger, markDbReady, log } from "../services/logger.service.js";

installLogger({ source: "worker" });
import { importSubscribersFromDma } from "../dma/importSubscribersFromDma.js";
import { CoaService } from "../services/coa.service.js";
import { NasHealthService } from "../services/nas-health.service.js";
import { runDatabaseBackup } from "../services/backup.service.js";
import {
  sendOperationalAlertWhatsApp,
  resolveWhatsAppSessionOwnerPhone,
  sendExpiryReminders,
  sendInvoicePaidWhatsApp,
  sendPaymentDueReminders,
  sendUsageThresholdAlerts,
  testWhatsAppConnection,
} from "../services/whatsapp.service.js";
import { pruneOldLogs } from "../services/logger.service.js";
import { runUsageAndExpiryCycle } from "../worker/usage.worker.js";
import type { RowDataPacket } from "mysql2";
import {
  QueueJobNames,
  enqueueWahaInvoiceReceipt,
  type CoaDisconnectJobData,
  type WahaInvoiceReceiptJobData,
} from "../services/task-queue.service.js";
import { listenEvent } from "../events/eventBus.js";
import { Events } from "../events/eventTypes.js";
import { getSystemSettings } from "../services/system-settings.service.js";
import { hasTable } from "../db/schemaGuards.js";

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const publisher = connection.duplicate();
const workerHeartbeatKey = "future-radius:worker:heartbeat";

const coa = new CoaService(pool);
const nasHealth = new NasHealthService(pool, coa, (ev) => {
  publisher.publish(config.eventsChannel, JSON.stringify(ev)).catch(() => {});
});

export const jobQueue = new Queue("radius-manager", { connection });

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
    low.includes("migrations") && low.includes("failed") ||
    low.includes("freeradius") ||
    low.includes("radius-user") ||
    low.includes("bootstrap failed") ||
    low.includes("socket hang up") ||
    low.includes("no reply from server") ||
    low.includes("eai_again") ||
    low.includes("enotfound")
  );
}

async function sendCriticalOpsAlerts(tenantId: string): Promise<void> {
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
      preferSessionOwner: systemSettings.critical_alert_use_session_owner,
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

async function generateMonthlyInvoices(): Promise<void> {
  const tenantId = config.defaultTenantId;
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

async function syncSubscribersFromRadcheck(): Promise<void> {
  await importSubscribersFromDma(pool, {
    tenantId: config.defaultTenantId,
    validateSchema: false,
    dryRun: false,
  });
}

async function bootstrapRepeatables() {
  const everyMin = 60_000;
  const everyDay = 86_400_000;
  const timezone = process.env.APP_TIMEZONE ?? "Asia/Damascus";
  const replaceRepeatablesByName = async (name: string) => {
    try {
      const jobs = await jobQueue.getRepeatableJobs();
      for (const job of jobs) {
        if (job.name === name && job.key) {
          await jobQueue.removeRepeatableByKey(job.key);
        }
      }
    } catch (e) {
      console.warn("replace repeatable jobs", name, e);
    }
  };
  const add = async (name: string, every: number) => {
    try {
      await jobQueue.add(name, {}, { repeat: { every }, jobId: name });
    } catch (e) {
      console.warn("repeat job", name, e);
    }
  };
  const addCron = async (name: string, pattern: string) => {
    try {
      await jobQueue.add(name, {}, { repeat: { pattern, tz: timezone }, jobId: name });
    } catch (e) {
      console.warn("repeat cron job", name, e);
    }
  };
  await add("update-usage", everyMin);
  await add("nas-health", everyMin);
  await add("sync-subscribers", everyMin * 60);
  await add("generate-invoices", everyDay);
  await add("daily-backup", everyDay);
  await add("whatsapp-health-check", everyMin);
  await add("prune-server-logs", everyMin * 60 * 6);
  await add("ops-critical-alerts", everyMin * 2);
  await add("whatsapp-usage-alerts", everyMin * 30);
  await replaceRepeatablesByName("whatsapp-expiry-reminders");
  await replaceRepeatablesByName("whatsapp-payment-due-reminders");
  await addCron("whatsapp-expiry-reminders", "0 12 * * *");
  await addCron("whatsapp-payment-due-reminders", "10 12 * * *");
}

async function main() {
  await waitForDbReady();
  markDbReady();
  log.info("worker boot", {}, "bootstrap");
  await connection.set(workerHeartbeatKey, new Date().toISOString());
  setInterval(() => {
    connection.set(workerHeartbeatKey, new Date().toISOString()).catch(() => {});
  }, 30_000).unref();
  await listenEvent(Events.INVOICE_PAID, async (payload) => {
    await enqueueWahaInvoiceReceipt({
      tenantId: payload.tenantId,
      subscriberId: payload.subscriberId,
      invoiceNo: payload.invoiceNo,
      amount: payload.amount,
      currency: payload.currency,
      paidAt: payload.paidAt,
    });
  });
  const worker = new Worker(
    "radius-manager",
    async (job) => {
      const tenantId = config.defaultTenantId;
      switch (job.name) {
        case "update-usage":
          await runUsageAndExpiryCycle();
          break;
        case "nas-health":
          await nasHealth.probeAll(tenantId);
          break;
        case "generate-invoices":
          await generateMonthlyInvoices();
          break;
        case "sync-subscribers":
          await syncSubscribersFromRadcheck();
          break;
        case "daily-backup":
          await runDatabaseBackup({
            tenantId,
            triggeredBy: "system",
          });
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
          await sendCriticalOpsAlerts(tenantId);
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
        case QueueJobNames.COA_DISCONNECT: {
          const payload = job.data as CoaDisconnectJobData;
          return coa.disconnectUserForTenant(
            payload.username,
            payload.nasIp,
            payload.tenantId,
            payload.acctSessionId
          );
        }
        default:
          break;
      }
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    log.error(`job_failed ${job?.name ?? "unknown"}: ${err?.message ?? "unknown"}`, {
      jobId: job?.id,
      name: job?.name,
      attemptsMade: job?.attemptsMade,
    }, "worker");
    console.error("job failed", job?.name, err);
  });

  await bootstrapRepeatables();
  console.log("Worker started (BullMQ)");
}

main().catch((e) => {
  console.error("worker bootstrap failed", e);
  process.exit(1);
});
