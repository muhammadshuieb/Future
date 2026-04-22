import { randomUUID } from "crypto";
import { Redis } from "ioredis";
import { Queue, Worker } from "bullmq";
import { config } from "../config.js";
import { pool, waitForDbReady } from "../db/pool.js";
import { importSubscribersFromDma } from "../dma/importSubscribersFromDma.js";
import { CoaService } from "../services/coa.service.js";
import { NasHealthService } from "../services/nas-health.service.js";
import { runDatabaseBackup } from "../services/backup.service.js";
import {
  sendExpiryReminders,
  sendInvoicePaidWhatsApp,
  sendPaymentDueReminders,
  sendUsageThresholdAlerts,
  testWhatsAppConnection,
} from "../services/whatsapp.service.js";
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

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const publisher = connection.duplicate();
const workerHeartbeatKey = "future-radius:worker:heartbeat";

const coa = new CoaService(pool);
const nasHealth = new NasHealthService(pool, coa, (ev) => {
  publisher.publish(config.eventsChannel, JSON.stringify(ev)).catch(() => {});
});

export const jobQueue = new Queue("radius-manager", { connection });

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
  await add("whatsapp-usage-alerts", everyMin * 30);
  await replaceRepeatablesByName("whatsapp-expiry-reminders");
  await replaceRepeatablesByName("whatsapp-payment-due-reminders");
  await addCron("whatsapp-expiry-reminders", "0 12 * * *");
  await addCron("whatsapp-payment-due-reminders", "10 12 * * *");
}

async function main() {
  await waitForDbReady();
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
    console.error("job failed", job?.name, err);
  });

  await bootstrapRepeatables();
  console.log("Worker started (BullMQ)");
}

main().catch((e) => {
  console.error("worker bootstrap failed", e);
  process.exit(1);
});
