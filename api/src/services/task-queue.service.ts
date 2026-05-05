import { Queue, QueueEvents, type Job } from "bullmq";
import { createRedisClient, listenRedisErrors } from "../lib/redis-connection.js";

export const QueueJobNames = {
  WAHA_SEND_INVOICE_RECEIPT: "waha.send-invoice-receipt",
  COA_DISCONNECT: "coa.disconnect",
} as const;

export type WahaInvoiceReceiptJobData = {
  tenantId: string;
  subscriberId: string;
  invoiceNo: string;
  amount: number;
  currency: string;
  paidAt: string;
};

export type CoaDisconnectJobData = {
  tenantId: string;
  username: string;
  nasIp: string;
  acctSessionId?: string;
};

const connection = createRedisClient("api-bullmq-queue");
const queueEventsConnection = connection.duplicate();
listenRedisErrors(queueEventsConnection, "api-bullmq-queue-events");
export const taskQueue = new Queue("radius-manager", { connection });
const queueEvents = new QueueEvents("radius-manager", { connection: queueEventsConnection });

export async function enqueueWahaInvoiceReceipt(data: WahaInvoiceReceiptJobData): Promise<Job> {
  return taskQueue.add(QueueJobNames.WAHA_SEND_INVOICE_RECEIPT, data, {
    priority: 1,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 2000,
  });
}

export async function enqueueCoaDisconnect(data: CoaDisconnectJobData): Promise<Job> {
  return taskQueue.add(QueueJobNames.COA_DISCONNECT, data, {
    priority: 10,
    attempts: 2,
    backoff: { type: "fixed", delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 2000,
  });
}

export async function waitForJobResult<T>(job: Job, timeoutMs = 8000): Promise<T | null> {
  try {
    await queueEvents.waitUntilReady();
    const result = await job.waitUntilFinished(queueEvents, timeoutMs);
    return result as T;
  } catch {
    return null;
  }
}
