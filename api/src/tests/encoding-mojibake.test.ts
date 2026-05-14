import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeTextCell,
  countMojibakeSignals,
  glyphAndEncodingPrintHint,
  repairChainedLatin1Utf8,
  repairLatin1BytesAsUtf8,
  repairSmartQuoteMojibake,
} from "../lib/encoding-mojibake.js";

describe("encoding-mojibake detection", () => {
  it("detects common mojibake fragments", () => {
    const bad = "ط§ظ„ط³ظ„ط§ظ…";
    assert.ok(countMojibakeSignals(bad) >= 2);
    const a = analyzeTextCell(bad);
    assert.ok(a);
    assert.ok(a!.confidence > 0.2);
  });

  it("returns null for clean Arabic", () => {
    assert.equal(analyzeTextCell("السلام عليكم"), null);
  });

  it("repairs latin1-misread UTF-8 roundtrip pattern", () => {
    const original = "الفوترة";
    const garbled = Buffer.from(original, "utf8").toString("latin1");
    assert.notEqual(garbled, original);
    const fixed = repairLatin1BytesAsUtf8(garbled);
    assert.equal(fixed, original);
  });

  it("repairs smart-quote mojibake", () => {
    const s = "test â€” done";
    assert.equal(repairSmartQuoteMojibake(s), "test — done");
  });

  it("chained repair converges when single latin1 step is enough", () => {
    const original = "مرحبا";
    const garbled = Buffer.from(original, "utf8").toString("latin1");
    const fixed = repairChainedLatin1Utf8(garbled, 3);
    assert.equal(fixed, original);
  });

  it("glyph print hint flags mojibake risk", () => {
    const h = glyphAndEncodingPrintHint("ط§ظ„ط®ط·ط£ ط§ظ„ط®ط·ط£ ط§ظ„ط®ط·ط£");
    assert.ok(h.mojibakeRisk === "high" || h.mojibakeRisk === "medium");
  });
});
