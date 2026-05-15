import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  managerAllowedForPackage,
  packageNasWhitelistIsUnrestricted,
  parseJsonStringArray,
  subscriberNasAllowedForPackage,
  toJsonColumnValue,
} from "../lib/package-access-scope.js";

describe("package-access-scope", () => {
  it("parses json arrays", () => {
    assert.deepEqual(parseJsonStringArray(null), []);
    assert.deepEqual(parseJsonStringArray(["a", "b"]), ["a", "b"]);
    assert.deepEqual(parseJsonStringArray('["x"]'), ["x"]);
  });

  it("NAS whitelist", () => {
    assert.equal(subscriberNasAllowedForPackage("n1", null), true);
    assert.equal(subscriberNasAllowedForPackage("n1", []), true);
    assert.equal(subscriberNasAllowedForPackage("n1", ["n1", "n2"]), true);
    assert.equal(subscriberNasAllowedForPackage(null, ["n1"]), false);
    assert.equal(subscriberNasAllowedForPackage("n3", ["n1"]), false);
    assert.equal(packageNasWhitelistIsUnrestricted(["n1", "n2"], ["n1", "n2"]), true);
    assert.equal(subscriberNasAllowedForPackage(null, ["n1", "n2"], ["n1", "n2"]), true);
    assert.equal(packageNasWhitelistIsUnrestricted(["n1"], ["n1", "n2"]), false);
  });

  it("manager whitelist", () => {
    assert.equal(managerAllowedForPackage("admin", "any", ["m1"]), true);
    assert.equal(managerAllowedForPackage("manager", "m1", null), true);
    assert.equal(managerAllowedForPackage("manager", "m1", []), true);
    assert.equal(managerAllowedForPackage("manager", "m1", ["m1", "m2"]), true);
    assert.equal(managerAllowedForPackage("manager", "m3", ["m1"]), false);
  });

  it("toJsonColumnValue", () => {
    assert.equal(toJsonColumnValue(undefined), null);
    assert.equal(toJsonColumnValue([]), null);
    assert.equal(toJsonColumnValue(["a"]), JSON.stringify(["a"]));
  });
});
