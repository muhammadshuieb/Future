import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BACKUP_RETENTION_CLEANUP_JOB,
  cronPatternToSlot,
  hhmmToCron,
} from "../services/backup-schedule-jobs.service.js";
import { getActiveBackupScheduleSlots, retentionCutoffMs } from "../services/backup.service.js";

describe("backup schedule helpers", () => {
  it("hhmmToCron builds standard minute-hour pattern", () => {
    assert.equal(hhmmToCron("03:00"), "0 3 * * *");
    assert.equal(hhmmToCron("15:30"), "30 15 * * *");
    assert.equal(hhmmToCron("bad"), null);
  });

  it("cronPatternToSlot reverses minute-hour pattern", () => {
    assert.equal(cronPatternToSlot("0 3 * * *"), "03:00");
    assert.equal(cronPatternToSlot("30 15 * * *"), "15:30");
    assert.equal(cronPatternToSlot("invalid"), null);
  });

  it("retentionCutoffMs subtracts full days", () => {
    const now = Date.now();
    const cutoff = retentionCutoffMs(7);
    const diffDays = (now - cutoff) / (24 * 60 * 60 * 1000);
    assert.ok(diffDays >= 6.99 && diffDays <= 7.01);
  });

  it("retention cleanup job name is stable", () => {
    assert.equal(BACKUP_RETENTION_CLEANUP_JOB, "backup-retention-cleanup");
  });

  it("getActiveBackupScheduleSlots respects mode", () => {
    assert.deepEqual(
      getActiveBackupScheduleSlots({
        scheduleEnabled: false,
        scheduleMode: "daily",
        scheduleTime1: "03:00",
        scheduleTime2: "15:00",
      }),
      []
    );
    assert.deepEqual(
      getActiveBackupScheduleSlots({
        scheduleEnabled: true,
        scheduleMode: "daily",
        scheduleTime1: "3:00",
        scheduleTime2: "15:00",
      }),
      ["03:00"]
    );
    assert.deepEqual(
      getActiveBackupScheduleSlots({
        scheduleEnabled: true,
        scheduleMode: "twice_daily",
        scheduleTime1: "03:00",
        scheduleTime2: "15:00",
      }),
      ["03:00", "15:00"]
    );
  });
});
