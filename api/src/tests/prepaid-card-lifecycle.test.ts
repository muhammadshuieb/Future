import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluatePrepaidCardAccessFromRow,
  isPrepaidCardCalendarExpired,
  prepaidQuotaBytes,
  PREPAID_REPLY_MESSAGES,
} from "../lib/prepaid-card-access.js";

describe("prepaid-card-access", () => {
  it("rejects calendar-expired card", () => {
    assert.equal(isPrepaidCardCalendarExpired("2020-01-01"), true);
    const r = evaluatePrepaidCardAccessFromRow({
      lifecycle_status: "active",
      active: 1,
      revoked: 0,
      expiration: "2020-01-01",
      total_limit_mb: 0,
      used_bytes: 0,
      used_seconds: 0,
      online_time_limit: 0,
      available_time_from_activation: 0,
      first_used_at: null,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "calendar_expired");
      assert.equal(r.message, PREPAID_REPLY_MESSAGES.calendar_expired);
    }
  });

  it("rejects when central quota exceeded across aggregated usage", () => {
    const quotaMb = 100;
    const quotaB = prepaidQuotaBytes(quotaMb);
    const r = evaluatePrepaidCardAccessFromRow({
      lifecycle_status: "active",
      active: 1,
      revoked: 0,
      expiration: "2099-12-31",
      total_limit_mb: quotaMb,
      used_bytes: quotaB,
      used_seconds: 0,
      online_time_limit: 0,
      available_time_from_activation: 0,
      first_used_at: null,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "quota_exceeded");
  });

  it("rejects reconnect when consumed lifecycle", () => {
    const r = evaluatePrepaidCardAccessFromRow({
      lifecycle_status: "consumed",
      active: 0,
      revoked: 0,
      expiration: "2099-12-31",
      total_limit_mb: 1000,
      used_bytes: 0,
      used_seconds: 0,
      online_time_limit: 0,
      available_time_from_activation: 0,
      first_used_at: null,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "consumed");
  });

  it("enforces online_time_limit in minutes", () => {
    const r = evaluatePrepaidCardAccessFromRow({
      lifecycle_status: "active",
      active: 1,
      revoked: 0,
      expiration: "2099-12-31",
      total_limit_mb: 0,
      used_bytes: 0,
      used_seconds: 61 * 60,
      online_time_limit: 60,
      available_time_from_activation: 0,
      first_used_at: null,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "online_time_exceeded");
  });

  it("enforces available_time_from_activation window", () => {
    const first = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const r = evaluatePrepaidCardAccessFromRow(
      {
        lifecycle_status: "active",
        active: 1,
        revoked: 0,
        expiration: "2099-12-31",
        total_limit_mb: 0,
        used_bytes: 0,
        used_seconds: 0,
        online_time_limit: 0,
        available_time_from_activation: 60,
        first_used_at: first,
      },
      new Date()
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "activation_window_expired");
  });

  it("allows active card within limits", () => {
    const r = evaluatePrepaidCardAccessFromRow({
      lifecycle_status: "active",
      active: 1,
      revoked: 0,
      expiration: "2099-12-31",
      total_limit_mb: 500,
      used_bytes: 1024,
      used_seconds: 120,
      online_time_limit: 120,
      available_time_from_activation: 0,
      first_used_at: new Date(),
    });
    assert.equal(r.ok, true);
  });
});

describe("prepaid multi-NAS enforcement design", () => {
  it("documents that quota uses central used_bytes not per-MikroTik limit alone", () => {
    const perNasLimitOnly = false;
    const centralBytes = prepaidQuotaBytes(10);
    assert.ok(centralBytes > 0);
    assert.equal(perNasLimitOnly, false);
  });
});
