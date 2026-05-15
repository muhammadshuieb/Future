import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRadiusSyncDenyReason } from "../lib/radius-sync-deny.js";
import type { SubscriberAccessRow } from "../lib/subscriber-access-guard.js";

function baseRow(
  over: Partial<
    SubscriberAccessRow & {
      credential_password?: string | null;
      nas_server_id?: string | null;
      package_allowed_nas_ids?: unknown;
    }
  > = {}
) {
  return {
    tenant_status: "active",
    customer_status: null,
    subscriber_status: "active",
    expiration_date: null,
    package_id: "pkg-1",
    package_active: 1,
    quota_total_bytes: 0,
    used_bytes: 0,
    overdue_invoices: 0,
    credential_password: "secret",
    nas_server_id: "nas-1",
    package_allowed_nas_ids: ["nas-1"],
    ...over,
  };
}

describe("resolveRadiusSyncDenyReason", () => {
  it("returns null when access is fully allowed", () => {
    assert.equal(resolveRadiusSyncDenyReason(baseRow()), null);
  });

  it("reports missing password", () => {
    assert.equal(resolveRadiusSyncDenyReason(baseRow({ credential_password: "" })), "missing_password");
  });

  it("reports NAS whitelist mismatch", () => {
    assert.equal(
      resolveRadiusSyncDenyReason(
        baseRow({ nas_server_id: null, package_allowed_nas_ids: ["nas-1"] }),
        ["nas-1", "nas-2"]
      ),
      "nas_not_allowed_for_package"
    );
    assert.equal(
      resolveRadiusSyncDenyReason(
        baseRow({ nas_server_id: null, package_allowed_nas_ids: ["nas-1", "nas-2"] }),
        ["nas-1", "nas-2"]
      ),
      null
    );
  });

  it("reports overdue invoices before NAS when both apply", () => {
    assert.equal(
      resolveRadiusSyncDenyReason(
        baseRow({ overdue_invoices: 2, nas_server_id: null, package_allowed_nas_ids: ["nas-1"] })
      ),
      "overdue_invoices"
    );
  });
});
