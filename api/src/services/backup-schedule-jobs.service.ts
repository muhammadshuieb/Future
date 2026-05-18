import { createRedisClient } from "../lib/redis-connection.js";
import { config } from "../config.js";
import {
  getActiveBackupScheduleSlots,
  getRcloneSettings,
  localDateAndHmInZone,
  scheduledSlotKey,
  slotMinutes,
} from "./backup.service.js";
import { resolveAppTimezone } from "./system-settings.service.js";
import { taskQueue } from "./task-queue.service.js";

export const BACKUP_SCHEDULED_JOB = "backup-scheduled";
export const BACKUP_RETENTION_CLEANUP_JOB = "backup-retention-cleanup";

const WORKER_HEARTBEAT_KEY = "future-radius:worker:heartbeat";
const WORKER_ONLINE_MS = 90_000;

const LEGACY_BACKUP_REPEATABLE_NAMES = new Set([
  BACKUP_SCHEDULED_JOB,
  "backup-scheduler",
  "daily-backup",
]);

export type BackupScheduleSyncResult = {
  tenant_id: string;
  schedule_enabled: boolean;
  active_slots: string[];
  cron_registered_slots: string[];
  timezone: string;
  worker_online: boolean;
  worker_last_heartbeat_at: string | null;
  sync_ok: boolean;
  sync_errors: string[];
  catchup_enqueued: string[];
};

export function hhmmToCron(hm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const hour = Math.min(23, Math.max(0, Number.parseInt(m[1]!, 10)));
  const minute = Math.min(59, Math.max(0, Number.parseInt(m[2]!, 10)));
  return `${minute} ${hour} * * *`;
}

export function cronPatternToSlot(pattern: string | null | undefined): string | null {
  if (!pattern) return null;
  const parts = pattern.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const minute = parts[0]!;
  const hour = parts[1]!;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function repeatSchedulerKey(tenantId: string, slot: string): string {
  return `backup-cron:${tenantId}:${slot.replace(":", "-")}`;
}

function catchupJobId(tenantId: string, date: string, slot: string): string {
  return `backup-catchup:${tenantId}:${date}:${slot.replace(":", "-")}`;
}

async function readWorkerHeartbeat(): Promise<{ online: boolean; lastAt: string | null }> {
  const redis = createRedisClient("backup-schedule-health");
  try {
    const hb = await redis.get(WORKER_HEARTBEAT_KEY);
    if (!hb) return { online: false, lastAt: null };
    const ageMs = Date.now() - new Date(hb).getTime();
    return { online: Number.isFinite(ageMs) && ageMs < WORKER_ONLINE_MS, lastAt: hb };
  } finally {
    await redis.quit().catch(() => {});
  }
}

async function removeBackupScheduledRepeatables(): Promise<void> {
  const jobs = await taskQueue.getRepeatableJobs();
  for (const job of jobs) {
    const name = job.name ?? "";
    const id = job.id ?? "";
    const key = job.key ?? "";
    const isBackupRepeatable =
      LEGACY_BACKUP_REPEATABLE_NAMES.has(name) ||
      name.startsWith(`${BACKUP_SCHEDULED_JOB}-`) ||
      id.startsWith(BACKUP_SCHEDULED_JOB) ||
      id.startsWith("backup-cron:") ||
      key.includes("backup-cron:") ||
      key.includes(BACKUP_SCHEDULED_JOB);
    if (isBackupRepeatable && job.key) {
      await taskQueue.removeRepeatableByKey(job.key);
    }
  }
}

export async function listRegisteredBackupCronSlots(): Promise<string[]> {
  const jobs = await taskQueue.getRepeatableJobs();
  const slots: string[] = [];
  for (const job of jobs) {
    if ((job.name ?? "") !== BACKUP_SCHEDULED_JOB) continue;
    const slot = cronPatternToSlot(job.pattern);
    if (slot) slots.push(slot);
  }
  return Array.from(new Set(slots)).sort();
}

/** Enqueue one-shot jobs for today's slots that already passed but were never completed. */
export async function enqueueMissedBackupSlotsIfNeeded(tenantId: string): Promise<string[]> {
  const settings = await getRcloneSettings(tenantId);
  if (!settings.scheduleEnabled) return [];

  const timeZone = await resolveAppTimezone(tenantId);
  const { date, hm } = localDateAndHmInZone(new Date(), timeZone);
  const nowMinutes = slotMinutes(hm);
  if (nowMinutes < 0) return [];

  const enqueued: string[] = [];
  for (const slot of getActiveBackupScheduleSlots(settings)) {
    const slotMin = slotMinutes(slot);
    if (slotMin < 0 || nowMinutes < slotMin) continue;

    const key = scheduledSlotKey(date, slot);
    if (settings.lastScheduledSlot === key) continue;

    const jobId = catchupJobId(tenantId, date, slot);
    try {
      const existing = await taskQueue.getJob(jobId);
      if (existing) continue;

      await taskQueue.add(
        BACKUP_SCHEDULED_JOB,
        { slot, tenantId, catchup: true },
        {
          jobId,
          priority: 1,
          removeOnComplete: 20,
          removeOnFail: 50,
        }
      );
      enqueued.push(slot);
    } catch (e) {
      console.warn("[backup-schedule] catchup enqueue failed", slot, e);
    }
  }
  if (enqueued.length > 0) {
    console.info(`[backup-schedule] catchup enqueued tenant=${tenantId} slots=${enqueued.join(", ")}`);
  }
  return enqueued;
}

/** Registers BullMQ cron jobs exactly at the times saved on the Maintenance page. */
export async function syncBackupScheduleCronJobs(tenantId: string): Promise<BackupScheduleSyncResult> {
  const syncErrors: string[] = [];
  await removeBackupScheduledRepeatables();

  const settings = await getRcloneSettings(tenantId);
  const activeSlots = getActiveBackupScheduleSlots(settings);
  const timeZone = await resolveAppTimezone(tenantId);
  const { online: workerOnline, lastAt: workerLastHeartbeat } = await readWorkerHeartbeat();

  if (settings.scheduleEnabled && activeSlots.length > 0) {
    for (const slot of activeSlots) {
      const pattern = hhmmToCron(slot);
      if (!pattern) {
        syncErrors.push(`invalid_slot:${slot}`);
        continue;
      }
      try {
        await taskQueue.add(
          BACKUP_SCHEDULED_JOB,
          { slot, tenantId },
          {
            repeat: {
              pattern,
              tz: timeZone,
              key: repeatSchedulerKey(tenantId, slot),
            },
            removeOnComplete: 30,
            removeOnFail: 100,
          }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        syncErrors.push(`${slot}:${msg}`);
        console.warn("[backup-schedule] failed to register cron", slot, timeZone, e);
      }
    }
  }

  const cronRegisteredSlots = await listRegisteredBackupCronSlots();
  let catchupEnqueued: string[] = [];
  if (settings.scheduleEnabled && activeSlots.length > 0) {
    try {
      catchupEnqueued = await enqueueMissedBackupSlotsIfNeeded(tenantId);
    } catch (e) {
      console.warn("[backup-schedule] catchup scan failed", e);
    }
  }

  const syncOk =
    !settings.scheduleEnabled ||
    activeSlots.length === 0 ||
    (syncErrors.length === 0 && activeSlots.every((s) => cronRegisteredSlots.includes(s)));

  console.info(
    `[backup-schedule] cron synced tenant=${tenantId} enabled=${settings.scheduleEnabled} mode=${settings.scheduleMode} tz=${timeZone} active=${activeSlots.join(", ")} registered=${cronRegisteredSlots.join(", ")} worker=${workerOnline ? "online" : "offline"} catchup=${catchupEnqueued.join(", ") || "none"}`
  );

  return {
    tenant_id: tenantId,
    schedule_enabled: settings.scheduleEnabled,
    active_slots: activeSlots,
    cron_registered_slots: cronRegisteredSlots,
    timezone: timeZone,
    worker_online: workerOnline,
    worker_last_heartbeat_at: workerLastHeartbeat,
    sync_ok: syncOk,
    sync_errors: syncErrors,
    catchup_enqueued: catchupEnqueued,
  };
}

export async function getBackupScheduleHealth(tenantId: string): Promise<BackupScheduleSyncResult> {
  const settings = await getRcloneSettings(tenantId);
  const activeSlots = getActiveBackupScheduleSlots(settings);
  const timeZone = await resolveAppTimezone(tenantId);
  const cronRegisteredSlots = await listRegisteredBackupCronSlots();
  const { online: workerOnline, lastAt: workerLastHeartbeat } = await readWorkerHeartbeat();
  const syncOk =
    !settings.scheduleEnabled ||
    activeSlots.length === 0 ||
    activeSlots.every((s) => cronRegisteredSlots.includes(s));

  return {
    tenant_id: tenantId,
    schedule_enabled: settings.scheduleEnabled,
    active_slots: activeSlots,
    cron_registered_slots: cronRegisteredSlots,
    timezone: timeZone,
    worker_online: workerOnline,
    worker_last_heartbeat_at: workerLastHeartbeat,
    sync_ok: syncOk,
    sync_errors: syncOk ? [] : ["cron_not_registered"],
    catchup_enqueued: [],
  };
}

/** Daily sweep: delete backups older than retention from disk and Google Drive. */
export async function syncBackupRetentionCleanupCronJob(tenantId: string): Promise<void> {
  const jobs = await taskQueue.getRepeatableJobs();
  for (const job of jobs) {
    if ((job.name ?? "") === BACKUP_RETENTION_CLEANUP_JOB && job.key) {
      await taskQueue.removeRepeatableByKey(job.key);
    }
  }
  const timeZone = await resolveAppTimezone(tenantId);
  try {
    await taskQueue.add(
      BACKUP_RETENTION_CLEANUP_JOB,
      { tenantId },
      {
        repeat: {
          pattern: "30 4 * * *",
          tz: timeZone,
          key: `backup-retention-cron:${tenantId}`,
        },
      }
    );
    console.info(`[backup-schedule] retention cleanup cron registered tenant=${tenantId} tz=${timeZone} at 04:30`);
  } catch (e) {
    console.warn("[backup-schedule] retention cleanup cron register failed", e);
  }
}

/** Called by worker/API on boot — loads schedule from DB (same as Maintenance page). */
export async function syncBackupScheduleCronJobsForDefaultTenant(): Promise<BackupScheduleSyncResult> {
  const result = await syncBackupScheduleCronJobs(config.defaultTenantId);
  await syncBackupRetentionCleanupCronJob(config.defaultTenantId);
  return result;
}
