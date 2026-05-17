import { RouterOSAPI } from "node-routeros";

export type RosRow = Record<string, unknown>;

export type RouterOsApiOptions = {
  host: string;
  user: string;
  password: string;
  port: number;
  timeout: number;
  tls?: { rejectUnauthorized: boolean };
};

/** RouterOS API (8728) vs API-SSL (8729, common on RouterOS 7). */
export function buildRouterOsApiOptions(
  host: string,
  user: string,
  password: string,
  port: number,
  timeoutMs: number
): RouterOsApiOptions {
  const opts: RouterOsApiOptions = { host, user, password, port, timeout: timeoutMs };
  if (port === 8729) {
    opts.tls = { rejectUnauthorized: false };
  }
  return opts;
}

export function createRouterOsApi(
  host: string,
  user: string,
  password: string,
  port: number,
  timeoutMs: number
): RouterOSAPI {
  return new RouterOSAPI(buildRouterOsApiOptions(host, user, password, port, timeoutMs));
}

export function isRosTruthy(v: unknown): boolean {
  const s = String(v ?? "").toLowerCase();
  return s === "true" || s === "yes";
}

export function isRosFalsy(v: unknown): boolean {
  const s = String(v ?? "").toLowerCase();
  return s === "false" || s === "no";
}

/** Interface `running` — absent field means up (API omits on some ROS 6 builds). */
export function isRosRunning(v: unknown): boolean {
  if (v == null || v === "") return true;
  return isRosTruthy(v);
}

export function isRosDisabled(v: unknown): boolean {
  return isRosTruthy(v);
}

export function parseRosNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Uptime string from /system/resource (same format on ROS 6 and 7). */
export function parseRosUptimeSeconds(uptime: string | undefined): number | null {
  if (!uptime) return null;
  let sec = 0;
  const w = uptime.match(/(\d+)w/);
  const d = uptime.match(/(\d+)d/);
  const h = uptime.match(/(\d+)h/);
  const m = uptime.match(/(\d+)m/);
  const s = uptime.match(/(\d+)s/);
  if (w) sec += Number(w[1]) * 604800;
  if (d) sec += Number(d[1]) * 86400;
  if (h) sec += Number(h[1]) * 3600;
  if (m) sec += Number(m[1]) * 60;
  if (s) sec += Number(s[1]);
  return sec || null;
}

export function parseRouterOsVersion(resource: RosRow | undefined): "6" | "7" | "unknown" {
  const v = String(resource?.version ?? resource?.["routerboard-current-firmware"] ?? "").toLowerCase();
  if (v.includes("7.") || v.startsWith("7")) return "7";
  if (v.includes("6.") || v.startsWith("6")) return "6";
  return "unknown";
}

/** /system/health/print — structure differs slightly; names are stable enough for both. */
export function parseHealthSensors(rows: RosRow[]): {
  boardTemperature: number | null;
  voltage: number | null;
  voltageSupported: boolean;
} {
  let boardTemperature: number | null = null;
  let voltage: number | null = null;
  let voltageSupported = false;

  for (const h of rows) {
    const name = String(h.name ?? h[".id"] ?? "").toLowerCase();
    const val = parseRosNumber(h.value);
    if (val == null) continue;
    if (name.includes("temperature") || name.includes("temp")) {
      boardTemperature = boardTemperature ?? val;
    }
    if (name.includes("voltage")) {
      voltageSupported = true;
      voltage = val > 100 ? val / 1000 : val;
    }
  }
  return { boardTemperature, voltage, voltageSupported };
}

/**
 * /ping via API — ROS 6 returns per-reply rows; ROS 7 may omit rows on failure or use summary fields.
 */
export function parsePingInternetReachable(rows: RosRow[]): boolean | null {
  if (!rows.length) return null;

  for (const row of rows) {
    const sent = parseRosNumber(row.sent);
    const received = parseRosNumber(row.received);
    if (sent != null && received != null) {
      return received > 0;
    }
    const loss = String(row["packet-loss"] ?? row["packet_loss"] ?? "");
    if (loss.includes("100")) return false;
    if (loss && !loss.startsWith("100")) return true;
  }

  let replies = 0;
  let failures = 0;
  for (const row of rows) {
    const status = String(row.status ?? "").toLowerCase();
    const time = row.time;
    if (time != null && String(time).trim() !== "" && !status.includes("timeout")) {
      replies++;
      continue;
    }
    if (
      status.includes("timeout") ||
      status.includes("unreachable") ||
      status.includes("no route") ||
      status.includes("network is down")
    ) {
      failures++;
    }
  }

  if (replies > 0) return true;
  if (failures > 0) return false;
  return null;
}

export async function safeApiClose(api: RouterOSAPI): Promise<void> {
  try {
    await api.close();
  } catch {
    /* ignore */
  }
}
