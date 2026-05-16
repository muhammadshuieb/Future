import type { RowDataPacket } from "mysql2";
import { RouterOSAPI } from "node-routeros";

/** Host used for RouterOS API (8728): WireGuard tunnel IP first, then NAS public IP. */
export function resolveMikrotikApiHost(row: RowDataPacket): string | null {
  const tunnel = String(row.wireguard_tunnel_ip ?? "").trim();
  const pub = String(row.ip ?? "").trim();
  const host = tunnel || pub;
  if (!host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return host;
}

export type MikrotikApiProbeResult = { ok: boolean; host: string; message: string };

/** Lightweight login test (connect + close). Appears in MikroTik log when API is reached. */
export async function probeMikrotikRouterOsApi(
  host: string,
  user: string,
  password: string,
  timeoutMs = 8000
): Promise<MikrotikApiProbeResult> {
  const api = new RouterOSAPI({
    host,
    user,
    password,
    port: 8728,
    timeout: timeoutMs,
  });
  try {
    await api.connect();
    await api.close();
    return { ok: true, host, message: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await api.close();
    } catch {
      /* ignore */
    }
    return { ok: false, host, message };
  }
}

export function nasRowHasMikrotikApi(row: RowDataPacket): boolean {
  if (!Number(row.mikrotik_api_enabled ?? 0)) return false;
  const user = String(row.mikrotik_api_user ?? "").trim();
  const pass = String(row.mikrotik_api_password ?? "");
  return Boolean(user && pass);
}
