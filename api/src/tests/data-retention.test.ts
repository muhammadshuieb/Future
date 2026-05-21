import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampRadacctClosedDays,
  clampRadpostauthDays,
  clampSessionsOfflineDays,
  clampUserUsageDailyDays,
} from "../services/data-retention.service.js";
import {
  computeRadpostauthCutoff,
  computeRadpostauthCutoffByDays,
} from "../services/radpostauth-retention.service.js";

describe("data retention clamps", () => {
  it("clampRadacctClosedDays enforces 30–730", () => {
    assert.equal(clampRadacctClosedDays(10), 30);
    assert.equal(clampRadacctClosedDays(180), 180);
    assert.equal(clampRadacctClosedDays(9999), 730);
  });

  it("clampSessionsOfflineDays enforces 30–365", () => {
    assert.equal(clampSessionsOfflineDays(1), 30);
    assert.equal(clampSessionsOfflineDays(90), 90);
    assert.equal(clampSessionsOfflineDays(500), 365);
  });

  it("clampUserUsageDailyDays enforces 90–730", () => {
    assert.equal(clampUserUsageDailyDays(30), 90);
    assert.equal(clampUserUsageDailyDays(365), 365);
    assert.equal(clampUserUsageDailyDays(900), 730);
  });

  it("clampRadpostauthDays enforces 30–365", () => {
    assert.equal(clampRadpostauthDays(7), 30);
    assert.equal(clampRadpostauthDays(90), 90);
    assert.equal(clampRadpostauthDays(400), 365);
  });
});

describe("radpostauth cutoff", () => {
  it("computeRadpostauthCutoffByDays subtracts whole days", () => {
    const now = new Date("2026-05-21T12:00:00Z");
    assert.equal(computeRadpostauthCutoffByDays(now, 90), "2026-02-20");
    assert.equal(computeRadpostauthCutoffByDays(now, 30), "2026-04-21");
  });

  it("computeRadpostauthCutoff uses calendar months", () => {
    const may = new Date("2026-05-15T00:00:00");
    assert.equal(computeRadpostauthCutoff(may, 2), "2026-04-01");
    const jan = new Date("2026-01-05T00:00:00");
    assert.equal(computeRadpostauthCutoff(jan, 2), "2025-12-01");
  });
});
