import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatExpirationForDb,
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
});
