import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateSubscriberAccessFromRow,
  type SubscriberAccessRow,
} from "../lib/subscriber-access-guard.js";

function baseRow(over: Partial<SubscriberAccessRow> = {}): SubscriberAccessRow {
  return {
    tenant_status: "active",
    subscriber_status: "active",
    expiration_date: null,
    package_id: "pkg-1",
    package_active: 1,
    quota_total_bytes: 0,
    used_bytes: 0,
    overdue_invoices: 0,
    ...over,
  };
}

describe("evaluateSubscriberAccessFromRow", () => {
  it("allows a healthy subscription row", () => {
    assert.equal(evaluateSubscriberAccessFromRow(baseRow()).ok, true);
  });

  it("rejects inactive tenant", () => {
    const r = evaluateSubscriberAccessFromRow(baseRow({ tenant_status: "suspended" }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "tenant_inactive");
  });

  it("rejects expired subscription date", () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const r = evaluateSubscriberAccessFromRow(baseRow({ expiration_date: past }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "expired");
  });

  it("rejects missing package", () => {
    const r = evaluateSubscriberAccessFromRow(baseRow({ package_id: null }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "no_package");
  });

  it("rejects inactive package", () => {
    const r = evaluateSubscriberAccessFromRow(baseRow({ package_active: 0 }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "package_inactive");
  });

  it("rejects quota exhaustion", () => {
    const r = evaluateSubscriberAccessFromRow(
      baseRow({ quota_total_bytes: 1000, used_bytes: 1000 })
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "quota_exceeded");
  });

  it("rejects overdue invoices", () => {
    const r = evaluateSubscriberAccessFromRow(baseRow({ overdue_invoices: 1 }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "overdue_invoices");
  });
});
