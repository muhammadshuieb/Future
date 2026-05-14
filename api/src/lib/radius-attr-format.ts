/**
 * Package rates are stored as bits per second (same convention as MikroTik-friendly math).
 * Panel strings like `6144k/0` follow DL/UL order for Mikrotik-Rate-Limit.
 */
export function formatMikrotikRateLimitFromBitsPerSec(downBitsPerSec: number, upBitsPerSec: number): string | null {
  const bitsDown = Math.max(0, Math.round(Number(downBitsPerSec) || 0));
  const bitsUp = Math.max(0, Math.round(Number(upBitsPerSec) || 0));
  if (bitsDown <= 0 && bitsUp <= 0) return null;

  const fmt = (bits: number): string => {
    if (bits <= 0) return "0";
    if (bits < 10 * 1024 * 1024) {
      const k = Math.round(bits / 1024);
      return `${Math.max(1, k)}k`;
    }
    const m = Math.round(bits / (1024 * 1024));
    return `${Math.max(1, m)}M`;
  };

  return `${fmt(bitsDown)}/${fmt(bitsUp)}`;
}

/** Display Mbps from bit/s (1 Mbps = 1024 * 1024 bit/s). */
export function formatMbpsFromBitsPerSec(bitsPerSec: number): string {
  const mbps = Math.max(0, Number(bitsPerSec) || 0) / (1024 * 1024);
  if (!Number.isFinite(mbps) || mbps <= 0) return "0";
  if (mbps >= 100) return String(Math.round(mbps));
  if (mbps >= 10) return String(Math.round(mbps * 10) / 10);
  return String(Math.round(mbps * 100) / 100);
}

export function formatMikrotikRateMbpsLabel(downBitsPerSec: number, upBitsPerSec: number): string {
  const d = formatMbpsFromBitsPerSec(downBitsPerSec);
  const u = formatMbpsFromBitsPerSec(upBitsPerSec);
  return `${d} / ${u} Mbps`;
}

/**
 * Parse panel DL/UL speed into bits/s pair.
 * - `6144k/0` means 6144 kbps download, unlimited upload (numeric side uses k suffix rules below).
 * - `6M/1M` means 6 Mbps download, 1 Mbps upload.
 */
export function parseRateLimitToBitsPerSecPair(raw: string): { down: number; up: number } | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  // MikroTik may append burst/threshold pairs after a space; first `rx/tx` token is the base limit.
  const slashToken = s.split(/\s+/).find((w) => w.includes("/")) ?? s;
  s = slashToken;
  const idx = s.indexOf("/");
  if (idx <= 0 || idx >= s.length - 1) return null;
  const a = s.slice(0, idx).trim();
  const b = s.slice(idx + 1).trim();
  const parsePart = (part: string): number | null => {
    if (!part) return null;
    if (/^\d+$/.test(part)) return Math.max(0, parseInt(part, 10));
    const m = part.match(/^(\d+(?:\.\d+)?)\s*([kKmMgG])?$/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    const suf = (m[2] || "").toUpperCase();
    const mult = suf === "G" ? 1024 ** 3 : suf === "M" ? 1024 ** 2 : suf === "K" ? 1024 : 0;
    if (mult === 0) return null;
    const bitsPerSec = n * mult;
    return Math.max(0, Math.round(bitsPerSec));
  };
  const down = /^\d+$/.test(a) ? Math.max(0, parseInt(a, 10)) : parsePart(a);
  const up = /^\d+$/.test(b) ? Math.max(0, parseInt(b, 10)) : parsePart(b);
  if (down == null || up == null) return null;
  return { down, up };
}

/** FreeRADIUS `Expiration` attribute value (UTC), e.g. "Apr 26 2026 09:00:00" */
export function formatRadiusExpirationUtc(d: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes()
  )}:${pad(d.getUTCSeconds())}`;
}
