import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extendSubscriptionByDaysNoon,
  resolveExpirationAfterPayment,
  subscriptionRenewalBaseDate,
} from "../lib/billing.js";

describe("subscription renewal on payment", () => {
  it("stacks billing days on future expiration (preserves remaining days)", () => {
    const future = new Date();
    future.setDate(future.getDate() + 20);
    future.setHours(12, 0, 0, 0);

    const next = resolveExpirationAfterPayment(undefined, future, 30).next;
    const expected = new Date(future);
    expected.setDate(expected.getDate() + 30);
    expected.setHours(12, 0, 0, 0);

    assert.equal(next.getFullYear(), expected.getFullYear());
    assert.equal(next.getMonth(), expected.getMonth());
    assert.equal(next.getDate(), expected.getDate());
  });

  it("extends from today when subscription is already expired", () => {
    const past = new Date();
    past.setDate(past.getDate() - 10);
    past.setHours(12, 0, 0, 0);

    const base = subscriptionRenewalBaseDate(past);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    assert.equal(base.getFullYear(), today.getFullYear());
    assert.equal(base.getMonth(), today.getMonth());
    assert.equal(base.getDate(), today.getDate());

    const next = extendSubscriptionByDaysNoon(past, 30);
    const expected = new Date(today);
    expected.setDate(expected.getDate() + 30);
    assert.equal(next.getDate(), expected.getDate());
  });
});
