import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cronPatternToSlot,
  hhmmToCron,
} from "../services/backup-schedule-jobs.service.js";
import { getActiveBackupScheduleSlots } from "../services/backup.service.js";

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
