import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeQoeScore, nasOverloadFromPoorCounts } from "../services/qoe-score.service.js";
import { calculateCommissionAmount, rejectRatio } from "../services/reseller-franchise.service.js";

describe("enterprise modules", () => {
  it("computes QoE score from reconnects and failed auth", () => {
    const r = computeQoeScore({
      packetLossPct: 0,
      jitterMs: 0,
      latencyMs: 0,
      reconnectsPerDay: 20,
      failedAuthPerDay: 10,
      avgSessionSec: 60,
      bandwidthSaturationPct: 0,
    });
    assert.ok(r.score < 80);
    assert.ok(r.reasons.length > 0);
  });

  it("detects overloaded NAS from poor subscriber ratio", () => {
    assert.equal(nasOverloadFromPoorCounts(100, 30), true);
    assert.equal(nasOverloadFromPoorCounts(10, 2), false);
  });

  it("calculates commission percent and fixed", () => {
    assert.equal(calculateCommissionAmount("percent", 10, 200), 20);
    assert.equal(calculateCommissionAmount("fixed", 15, 999), 15);
  });

  it("calculates reject ratio", () => {
    assert.equal(rejectRatio(80, 20), 0.2);
    assert.equal(rejectRatio(0, 0), 0);
  });
});
