import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildMikrotikRateLimitFromParts, computeMikrotikForProfileInput } from "../lib/mikrotik-rate-limit-build.js";
import {
  defaultSpeedProfilePermissionsAllOff,
  hasSpeedProfilePermission,
  normalizeSpeedProfilePermissions,
} from "../lib/speed-profile-permissions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("speed profiles", () => {
  it("builds simple Mikrotik-Rate-Limit", () => {
    assert.equal(buildMikrotikRateLimitFromParts({ download_rate: "10M", upload_rate: "2M" }), "10M/2M");
  });

  it("builds burst Mikrotik-Rate-Limit", () => {
    const s = buildMikrotikRateLimitFromParts({
      download_rate: "20M",
      upload_rate: "5M",
      burst_download_rate: "30M",
      burst_upload_rate: "8M",
      burst_threshold_download: "15M",
      burst_threshold_upload: "3M",
      burst_time: "60/60",
      priority: 8,
    });
    assert.equal(s, "20M/5M 30M/8M 15M/3M 60/60 8");
  });

  it("computeMikrotikForProfileInput matches burst example shape", () => {
    const v = computeMikrotikForProfileInput({
      download_rate: "20M",
      upload_rate: "5M",
      burst_download_rate: "30M",
      burst_upload_rate: "8M",
      burst_threshold_download: "15M",
      burst_threshold_upload: "3M",
      burst_time: "60/60",
      priority: 8,
    });
    assert.ok(v.includes("20M/5M"));
    assert.ok(v.includes("30M/8M"));
  });

  it("manual override wins in permission check", () => {
    assert.equal(hasSpeedProfilePermission("viewer", { apply_speed_override: true }, "apply_speed_override"), true);
    assert.equal(hasSpeedProfilePermission("viewer", defaultSpeedProfilePermissionsAllOff(), "apply_speed_override"), false);
  });

  it("normalizes speed permissions from partial json", () => {
    const n = normalizeSpeedProfilePermissions({ view_speed_profiles: true });
    assert.equal(n.view_speed_profiles, true);
    assert.equal(n.create_speed_profile, false);
  });

  it("Arabic UI strings for speed exist in frontend translations", () => {
    const tr = join(__dirname, "../../../frontend/src/i18n/translations.ts");
    const raw = readFileSync(tr, "utf8");
    assert.ok(raw.includes('"speed.profilesTitle"'));
    assert.ok(raw.includes("ملفات السرعة"));
    assert.ok(raw.includes('"packages.dynamicSpeed.title"'));
    assert.ok(raw.includes("السرعة الديناميكية"));
    assert.ok(raw.includes('"weekday.0"'));
    assert.ok(raw.includes("الأحد"));
    assert.ok(raw.includes('"users.paymentModal.title"'));
    assert.ok(raw.includes('"users.financialReport"'));
  });
});
