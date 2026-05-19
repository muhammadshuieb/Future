import { Queue, QueueEvents, type Job } from "bullmq";
import { createRedisClient, listenRedisErrors } from "../lib/redis-connection.js";
import { FUTURE_RADIUS_JOB_QUEUE } from "../lib/bullmq-queue-name.js";

export const QueueJobNames = {
  WAHA_SEND_INVOICE_RECEIPT: "waha.send-invoice-receipt",
  WAHA_SEND_PAYMENT_RECEIVED: "waha.send-payment-received",
  WAHA_SEND_NEW_SUBSCRIBER: "waha.send-new-subscriber",
  COA_DISCONNECT: "coa.disconnect",
} as const;

export type WahaNewSubscriberJobData = {
  tenantId: string;
  subscriberId: string;
  phone: string | null;
  username: string;
  fullName: string;
  password: string;
  packageName: string;
  speed: string;
  expirationDate: string | null;
};

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
  framedIp?: string;
};

const connection = createRedisClient("api-bullmq-queue");
const queueEventsConnection = connection.duplicate();
listenRedisErrors(queueEventsConnection, "api-bullmq-queue-events");
export const taskQueue = new Queue(FUTURE_RADIUS_JOB_QUEUE, { connection });
const queueEvents = new QueueEvents(FUTURE_RADIUS_JOB_QUEUE, { connection: queueEventsConnection });

export async function enqueueWahaInvoiceReceipt(data: WahaInvoiceReceiptJobData): Promise<Job> {
  return taskQueue.add(QueueJobNames.WAHA_SEND_INVOICE_RECEIPT, data, {
    priority: 1,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 2000,
  });
}

export async function enqueueWahaPaymentReceived(data: WahaInvoiceReceiptJobData): Promise<Job> {
  return taskQueue.add(QueueJobNames.WAHA_SEND_PAYMENT_RECEIVED, data, {
    priority: 1,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 2000,
  });
}

export async function enqueueWahaNewSubscriber(data: WahaNewSubscriberJobData): Promise<Job> {
  return taskQueue.add(QueueJobNames.WAHA_SEND_NEW_SUBSCRIBER, data, {
    priority: 2,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 2000,
  });
}

export async function enqueueCoaDisconnect(data: CoaDisconnectJobData): Promise<Job> {
  return taskQueue.add(QueueJobNames.COA_DISCONNECT, data, {
    priority: 1,
    attempts: 8,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
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
