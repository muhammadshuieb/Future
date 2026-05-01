/**
 * Radius Manager `rm_services.downrate` / `uprate` are **bytes per second** (see stock dumps:
 * e.g. 131072 ≈ 128 KiB/s for a "128k" card profile).
 *
 * MikroTik `Mikrotik-Rate-Limit` uses the same syntax as simple-queue `max-limit`: **bits per second**
 * with decimal `k` / `M` / `G` suffixes (SI, same as typical RouterOS examples).
 *
 * The previous MiB rounding (`/ 1048576` + `M`) broke sub‑“1M” lines (rounded to 0) and mis-scaled
 * larger profiles vs RouterOS expectations.
 */
export function formatMikrotikRateLimitFromRmBytesPerSec(downBytesPerSec: number, upBytesPerSec: number): string | null {
  const down = Math.max(0, Math.round(Number(downBytesPerSec) || 0));
  const up = Math.max(0, Math.round(Number(upBytesPerSec) || 0));
  if (down <= 0 && up <= 0) return null;

  const bitsDown = down * 8;
  const bitsUp = up * 8;

  const fmt = (bits: number): string => {
    if (bits <= 0) return "0";
    // Under ~10 Mbps use kilobit-style strings so 256 KiB/s etc. never collapse to "0M".
    if (bits < 10_000_000) {
      const k = Math.round(bits / 1000);
      return `${Math.max(1, k)}k`;
    }
    const m = Math.round(bits / 1_000_000);
    return `${Math.max(1, m)}M`;
  };

  return `${fmt(bitsDown)}/${fmt(bitsUp)}`;
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
