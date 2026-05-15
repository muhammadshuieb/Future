import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatExpirationForDb,
  isSubscriptionExpiredByCalendarDate,
  parseSubscriptionExpirationInput,
} from "../lib/expiration-date.js";

describe("expiration-date", () => {
  it("parses YYYY-MM-DD at noon", () => {
    const d = parseSubscriptionExpirationInput("2026-06-15");
    assert.ok(d);
    assert.equal(d!.getHours(), 12);
    assert.ok(formatExpirationForDb(d!).startsWith("2026-06-15"));
  });

  it("rejects invalid dates", () => {
    assert.equal(parseSubscriptionExpirationInput("not-a-date"), null);
  });

  it("treats today as expired for calendar access checks", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    assert.equal(isSubscriptionExpiredByCalendarDate(today), true);
  });

  it("treats tomorrow as not expired", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    assert.equal(isSubscriptionExpiredByCalendarDate(tomorrow), false);
  });
});
