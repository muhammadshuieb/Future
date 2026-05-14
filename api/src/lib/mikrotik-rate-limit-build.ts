/**
 * Build MikroTik-Rate-Limit reply string for FreeRADIUS (PPPoE / Hotspot).
 * Format: rate [burst-rate] [burst-threshold] [burst-time] [priority] [min-rate]
 * Example: 20M/5M 30M/8M 15M/3M 60/60 8 10M/2M
 */
export type MikrotikRateProfileInput = {
  download_rate: string;
  upload_rate: string;
  burst_download_rate?: string | null;
  burst_upload_rate?: string | null;
  burst_threshold_download?: string | null;
  burst_threshold_upload?: string | null;
  burst_time?: string | null;
  priority?: number | null;
  min_download_rate?: string | null;
  min_upload_rate?: string | null;
};

function trimToken(s: string): string {
  return String(s ?? "").trim();
}

export function buildMikrotikRateLimitFromParts(input: MikrotikRateProfileInput): string {
  const dl = trimToken(input.download_rate);
  const ul = trimToken(input.upload_rate);
  if (!dl && !ul) return "0/0";
  const base = `${dl || "0"}/${ul || "0"}`;
  const parts: string[] = [base];
  const bdl = trimToken(input.burst_download_rate ?? "");
  const bul = trimToken(input.burst_upload_rate ?? "");
  if (bdl || bul) {
    parts.push(`${bdl || "0"}/${bul || "0"}`);
  }
  const tdl = trimToken(input.burst_threshold_download ?? "");
  const tul = trimToken(input.burst_threshold_upload ?? "");
  if (tdl || tul) {
    parts.push(`${tdl || "0"}/${tul || "0"}`);
  }
  const bt = trimToken(input.burst_time ?? "");
  if (bt) parts.push(bt);
  const pr = input.priority;
  if (pr != null && Number.isFinite(Number(pr))) {
    parts.push(String(Math.floor(Number(pr))));
  }
  const mdl = trimToken(input.min_download_rate ?? "");
  const mul = trimToken(input.min_upload_rate ?? "");
  if (mdl || mul) {
    parts.push(`${mdl || "0"}/${mul || "0"}`);
  }
  return parts.join(" ");
}

export function computeMikrotikForProfileInput(input: {
  download_rate: string;
  upload_rate: string;
  burst_download_rate?: string | null;
  burst_upload_rate?: string | null;
  burst_threshold_download?: string | null;
  burst_threshold_upload?: string | null;
  burst_time?: string | null;
  priority?: number | null;
}): string {
  return buildMikrotikRateLimitFromParts({
    download_rate: input.download_rate,
    upload_rate: input.upload_rate,
    burst_download_rate: input.burst_download_rate,
    burst_upload_rate: input.burst_upload_rate,
    burst_threshold_download: input.burst_threshold_download,
    burst_threshold_upload: input.burst_threshold_upload,
    burst_time: input.burst_time,
    priority: input.priority ?? null,
  });
}
