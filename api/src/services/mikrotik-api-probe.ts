import type { RowDataPacket } from "mysql2";
import {
  createRouterOsApi,
  isRosDisabled,
  isRosRunning,
  safeApiClose,
} from "./mikrotik-routeros-compat.js";

/** RouterOS API port (default 8728). */
export function resolveMikrotikApiPort(row: RowDataPacket): number {
  const p = Number(row.mikrotik_api_port ?? 8728);
  if (!Number.isFinite(p) || p < 1 || p > 65535) return 8728;
  return Math.floor(p);
}

/** Host used for RouterOS API: WireGuard tunnel IP first, then NAS public IP. */
export function resolveMikrotikApiHost(row: RowDataPacket): string | null {
  const tunnel = String(row.wireguard_tunnel_ip ?? "").trim();
  const pub = String(row.ip ?? "").trim();
  const host = tunnel || pub;
  if (!host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return host;
}

export type MikrotikApiProbeResult = { ok: boolean; host: string; message: string };

/** Lightweight login test (connect + close). Appears in MikroTik log when API is reached. */
export type MikrotikInterfaceInfo = {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
};

export async function listMikrotikInterfaces(
  host: string,
  user: string,
  password: string,
  port = 8728,
  timeoutMs = 10_000
): Promise<MikrotikInterfaceInfo[]> {
  const api = createRouterOsApi(host, user, password, port, timeoutMs);
  try {
    await api.connect();
    const rows = (await api.write("/interface/print")) as Record<string, unknown>[];
    await api.close();
    return rows
      .map((iface) => ({
        name: String(iface.name ?? ""),
        type: String(iface.type ?? ""),
        running: isRosRunning(iface.running),
        disabled: isRosDisabled(iface.disabled),
      }))
      .filter((i) => i.name && i.type !== "loopback")
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    await safeApiClose(api);
    throw err;
  }
}

export async function probeMikrotikRouterOsApi(
  host: string,
  user: string,
  password: string,
  port = 8728,
  timeoutMs = 8000
): Promise<MikrotikApiProbeResult> {
  const api = createRouterOsApi(host, user, password, port, timeoutMs);
  try {
    await api.connect();
    await api.close();
    return { ok: true, host, message: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await safeApiClose(api);
    return { ok: false, host, message };
  }
}

export function nasRowHasMikrotikApi(row: RowDataPacket): boolean {
  if (!Number(row.mikrotik_api_enabled ?? 0)) return false;
  const user = String(row.mikrotik_api_user ?? "").trim();
  const pass = String(row.mikrotik_api_password ?? "");
  return Boolean(user && pass);
}
