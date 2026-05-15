const UNIT_BYTES: Record<string, number> = {
  B: 1,
  K: 1024,
  KB: 1024,
  M: 1024 ** 2,
  MB: 1024 ** 2,
  G: 1024 ** 3,
  GB: 1024 ** 3,
  T: 1024 ** 4,
  TB: 1024 ** 4,
};

/** Parse quota input like `50M`, `50 MB`, `2G`, or plain `2` (gigabytes). */
export function parseQuotaInputToBytesString(raw: string): string {
  const s = String(raw ?? "")
    .trim()
    .replace(/,/g, ".")
    .replace(/\s+/g, "");
  if (!s || s === "0") return "0";

  const match = s.match(/^([\d.]+)([a-zA-Z]*)$/);
  if (!match) return "0";

  const num = parseFloat(match[1]);
  if (!Number.isFinite(num) || num <= 0) return "0";

  let unit = (match[2] ?? "").toUpperCase();
  if (!unit) unit = "GB";
  if (unit === "GIG" || unit === "GIGA") unit = "GB";
  if (unit === "MEG" || unit === "MEGA") unit = "MB";

  const mult = UNIT_BYTES[unit];
  if (!mult) return "0";

  return String(Math.round(num * mult));
}

export function formatQuotaBytesLabel(bytes: unknown, unlimitedLabel = "—"): string {
  const raw = String(bytes ?? "0").trim();
  if (!raw || raw === "0") return unlimitedLabel;
  let b: bigint;
  try {
    b = BigInt(raw);
  } catch {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return unlimitedLabel;
    b = BigInt(Math.floor(n));
  }
  if (b <= 0n) return unlimitedLabel;

  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let x = Number(b);
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return `${x.toFixed(digits)} ${units[i]}`;
}

/** Best-effort value for editing an existing package quota in the form field. */
export function quotaBytesToInputField(bytes: unknown): string {
  const raw = String(bytes ?? "0").trim();
  if (!raw || raw === "0") return "0";
  try {
    const b = BigInt(raw);
    if (b <= 0n) return "0";
    const gb = Number(b) / 1024 ** 3;
    if (gb >= 1) return gb >= 10 ? gb.toFixed(1) : gb.toFixed(2);
    const mb = Number(b) / 1024 ** 2;
    if (mb >= 1) return mb >= 10 ? `${Math.round(mb)}M` : `${mb.toFixed(1)}M`;
    const kb = Number(b) / 1024;
    if (kb >= 1) return kb >= 10 ? `${Math.round(kb)}K` : `${kb.toFixed(1)}K`;
    return String(b);
  } catch {
    return "0";
  }
}
