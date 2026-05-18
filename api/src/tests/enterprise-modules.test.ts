import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateCommissionAmount, rejectRatio } from "../services/reseller-franchise.service.js";

describe("enterprise modules", () => {
  it("calculates commission percent and fixed", () => {
    assert.equal(calculateCommissionAmount("percent", 10, 200), 20);
    assert.equal(calculateCommissionAmount("fixed", 15, 999), 15);
  });

  it("calculates reject ratio", () => {
    assert.equal(rejectRatio(80, 20), 0.2);
    assert.equal(rejectRatio(0, 0), 0);
  });
});
