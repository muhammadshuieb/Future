import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeTrafficPeriodMb,
  formatTrafficMbLine,
} from "../services/infrastructure/traffic-metrics.util.js";

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

  it("formats Arabic traffic line", () => {
    const line = formatTrafficMbLine(12.5, 3.2, "ether1");
    assert.match(line, /12\.5 MB/);
    assert.match(line, /3\.2 MB/);
    assert.match(line, /ether1/);
  });
});
