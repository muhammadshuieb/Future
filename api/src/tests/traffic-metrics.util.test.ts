import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeTrafficPeriodMb,
  formatBytesAsMbGb,
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

  it("formats cumulative bytes when period missing", () => {
    const s = formatBytesAsMbGb(50 * 1024 * 1024);
    assert.match(s, /MB/);
  });

  it("formatTrafficSection shows period when available", () => {
    const snap = {
      traffic_rx_mb: 12.5,
      traffic_tx_mb: 3.2,
      traffic_monitor_interface: "ether1",
    } as RouterHealthSnapshot;
    const lines = formatTrafficSection(snap);
    assert.ok(lines.some((l) => l.includes("12.5") || l.includes("MB")));
    assert.ok(lines.some((l) => l.includes("ether1")));
  });

  it("formatTrafficSection shows cumulative when no period", () => {
    const snap = {
      traffic_rx_mb: null,
      traffic_tx_mb: null,
      traffic_rx_bps: 100 * 1024 * 1024,
      traffic_tx_bps: 20 * 1024 * 1024,
      traffic_monitor_interface: "sfp1",
    } as RouterHealthSnapshot;
    const lines = formatTrafficSection(snap);
    assert.ok(lines.some((l) => l.includes("إجمالي")));
  });
});
