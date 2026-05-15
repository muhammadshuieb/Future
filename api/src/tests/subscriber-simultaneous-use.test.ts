import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampSimultaneousUse } from "../lib/subscriber-radius.js";

describe("clampSimultaneousUse", () => {
  it("clamps to 1..32", () => {
    assert.equal(clampSimultaneousUse(0), 1);
    assert.equal(clampSimultaneousUse(2), 2);
    assert.equal(clampSimultaneousUse(2.9), 2);
    assert.equal(clampSimultaneousUse(99), 32);
  });
});
