import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bytesDeltaToMbps,
  computeTrafficPeriodMb,
  formatTrafficSection,
} from "../services/infrastructure/traffic-metrics.util.js";
import type { RouterHealthSnapshot } from "../services/infrastructure/infrastructure-types.js";

describe("traffic-metrics.util", () => {
  it("computes MB delta between polls", () => {
    const prevAt = new Date(Date.now() - 300_000).toISOString();
    const r = computeTrafficPeriodMb(
      10 * 1024 * 1024,
      2 * 1024 * 1024,
      0,
      0,
      prevAt
    );
    assert.equal(r.rxMb, 10);
    assert.equal(r.txMb, 2);
  });

  it("bytesDeltaToMbps computes line rate", () => {
    const r = bytesDeltaToMbps(125_000_000, 25_000_000, 2);
    assert.ok(r.rxMbps > 400);
    assert.ok(r.txMbps > 80);
  });

  it("formatTrafficSection shows instant Mbps", () => {
    const snap = {
      traffic_rx_mbps: 450.5,
      traffic_tx_mbps: 120.3,
      traffic_monitor_interface: "sfp-sfpplus1",
    } as RouterHealthSnapshot;
    const lines = formatTrafficSection(snap);
    assert.ok(lines.some((l) => l.includes("450.5") && l.includes("Mbps")));
    assert.ok(lines.some((l) => l.includes("السحب الآن")));
    assert.ok(lines.some((l) => l.includes("sfp-sfpplus1")));
  });
});
