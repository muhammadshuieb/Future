import assert from "node:assert/strict";
import test from "node:test";
import { parseRateLimitToBitsPerSecPair } from "../lib/radius-attr-format.js";

test("parseRateLimitToBitsPerSecPair: lowercase m matches MikroTik UI", () => {
  const p = parseRateLimitToBitsPerSecPair("1m/1m");
  assert.ok(p);
  assert.equal(p!.down, 1 * 1024 * 1024);
  assert.equal(p!.up, 1 * 1024 * 1024);
});

test("parseRateLimitToBitsPerSecPair: uppercase M", () => {
  const p = parseRateLimitToBitsPerSecPair("6M/1M");
  assert.ok(p);
  assert.equal(p!.down, 6 * 1024 * 1024);
  assert.equal(p!.up, 1 * 1024 * 1024);
});

test("parseRateLimitToBitsPerSecPair: k suffix and zero upload", () => {
  const p = parseRateLimitToBitsPerSecPair("6144k/0");
  assert.ok(p);
  assert.equal(p!.down, 6144 * 1024);
  assert.equal(p!.up, 0);
});

test("parseRateLimitToBitsPerSecPair: first slash pair when burst tail present", () => {
  const p = parseRateLimitToBitsPerSecPair("6M/1M 8M/8M 48M/48M 8/8 10/10");
  assert.ok(p);
  assert.equal(p!.down, 6 * 1024 * 1024);
  assert.equal(p!.up, 1 * 1024 * 1024);
});
