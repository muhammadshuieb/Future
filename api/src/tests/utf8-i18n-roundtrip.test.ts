import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { config } from "../config.js";

describe("UTF-8 / Arabic-safe defaults", () => {
  it("uses utf8mb4 for mysql2 pool charset", () => {
    assert.equal((config.db as { charset?: string }).charset, "utf8mb4");
  });

  it("round-trips Arabic through JSON and Buffer as UTF-8", () => {
    const original = { name: "مشترك تجريبي", note: "English + العربية mixed" };
    const json = JSON.stringify(original);
    const back = JSON.parse(json) as typeof original;
    assert.equal(back.name, original.name);
    assert.equal(back.note, original.note);
    const bytes = Buffer.from(json, "utf8");
    assert.ok(bytes.includes(0xd9), "expected UTF-8 multi-byte Arabic in buffer");
    assert.equal(Buffer.from(bytes.toString("utf8"), "utf8").toString("utf8"), json);
  });

  it("accepts Arabic in zod string schemas (subscriber/customer names)", () => {
    const schema = z.object({ full_name: z.string().min(1).max(200) });
    const ar = schema.parse({ full_name: "أحمد بن علي" });
    assert.equal(ar.full_name, "أحمد بن علي");
  });
});
