import { taskQueue } from "./task-queue.service.js";
import { config } from "../config.js";
import { getActiveBackupScheduleSlots, getRcloneSettings } from "./backup.service.js";
import { resolveAppTimezone } from "./system-settings.service.js";

export const BACKUP_SCHEDULED_JOB = "backup-scheduled";

function hhmmToCron(hm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const hour = Math.min(23, Math.max(0, Number.parseInt(m[1]!, 10)));
  const minute = Math.min(59, Math.max(0, Number.parseInt(m[2]!, 10)));
  return `${minute} ${hour} * * *`;
}

function slotJobId(slot: string): string {
  return `${BACKUP_SCHEDULED_JOB}-${slot.replace(":", "-")}`;
}

async function removeBackupScheduledRepeatables(): Promise<void> {
  const jobs = await taskQueue.getRepeatableJobs();
  for (const job of jobs) {
    const name = job.name ?? "";
    if (name === BACKUP_SCHEDULED_JOB || name === "backup-scheduler") {
      if (job.key) await taskQueue.removeRepeatableByKey(job.key);
    }
  }
}

/** Registers BullMQ cron jobs exactly at the times saved on the Maintenance page. */
export async function syncBackupScheduleCronJobs(tenantId: string): Promise<void> {
  await removeBackupScheduledRepeatables();
  const settings = await getRcloneSettings(tenantId);
  const slots = getActiveBackupScheduleSlots(settings);
  if (slots.length === 0) return;

  const timeZone = await resolveAppTimezone(tenantId);
  for (const slot of slots) {
    const pattern = hhmmToCron(slot);
    if (!pattern) continue;
    try {
      await taskQueue.add(
        BACKUP_SCHEDULED_JOB,
        { slot },
        {
          repeat: { pattern, tz: timeZone },
          jobId: slotJobId(slot),
        }
      );
    } catch (e) {
      console.warn("[backup-schedule] failed to register cron", slot, timeZone, e);
    }
  }
  console.info(
    `[backup-schedule] cron synced tenant=${tenantId} mode=${settings.scheduleMode} tz=${timeZone} times=${slots.join(", ")}`
  );
}

/** Called by worker on boot — loads schedule from DB (same as Maintenance page). */
export async function syncBackupScheduleCronJobsForDefaultTenant(): Promise<void> {
  await syncBackupScheduleCronJobs(config.defaultTenantId);
}
