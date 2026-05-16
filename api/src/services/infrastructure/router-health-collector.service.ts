import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { RouterOSAPI } from "node-routeros";
import { hasTable } from "../../db/schemaGuards.js";
import { resolveMikrotikApiHost, nasRowHasMikrotikApi } from "../mikrotik-api-probe.js";
import { logRouterCommand } from "../router-command-log.service.js";
import { log } from "../logger.service.js";
import type { RouterHealthSnapshot } from "./infrastructure-types.js";

function parseUptimeSeconds(uptime: string | undefined): number | null {
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

function parseNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type RosRow = Record<string, unknown>;

async function collectFromRouter(
  host: string,
  user: string,
  password: string
): Promise<{
  metrics: Omit<RouterHealthSnapshot, "nas_device_id" | "tenant_id" | "nas_name" | "nas_ip">;
  raw: Record<string, unknown>;
}> {
  const api = new RouterOSAPI({ host, user, password, port: 8728, timeout: 12_000 });
  const raw: Record<string, unknown> = {};
  try {
    await api.connect();
    const resource = ((await api.write("/system/resource/print")) as RosRow[])[0] ?? {};
    raw.resource = resource;
    const totalMem = parseNumber(resource["total-memory"]) ?? 0;
    const freeMem = parseNumber(resource["free-memory"]) ?? 0;
    const cpuLoad = parseNumber(resource["cpu-load"]) ?? null;
    const ramPercent =
      totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10 : null;

    let boardTemperature: number | null = null;
    let voltage: number | null = null;
    let voltageSupported = false;
    try {
      const healthRows = (await api.write("/system/health/print")) as RosRow[];
      raw.health = healthRows;
      for (const h of healthRows) {
        const name = String(h.name ?? h[".id"] ?? "").toLowerCase();
        const val = parseNumber(h.value);
        if (val == null) continue;
        if (name.includes("temperature") || name.includes("temp")) {
          boardTemperature = boardTemperature ?? val;
        }
        if (name.includes("voltage")) {
          voltageSupported = true;
          voltage = val;
        }
      }
    } catch {
      raw.health = "unsupported";
    }

    let interfacesDown = 0;
    const ifaceTraffic: { rx: number; tx: number } = { rx: 0, tx: 0 };
    try {
      const ifaces = (await api.write("/interface/print")) as RosRow[];
      raw.interfaces_count = ifaces.length;
      for (const iface of ifaces) {
        const disabled = String(iface.disabled ?? "false") === "true";
        const running = String(iface.running ?? "true") === "true";
        const type = String(iface.type ?? "");
        if (!disabled && !running && type !== "loopback") interfacesDown += 1;
        const rx = parseNumber(iface["rx-byte"]) ?? 0;
        const tx = parseNumber(iface["tx-byte"]) ?? 0;
        ifaceTraffic.rx += rx;
        ifaceTraffic.tx += tx;
      }
    } catch (e) {
      raw.interfaces_error = String(e);
    }

    let pppCount = 0;
    try {
      const ppp = (await api.write("/ppp/active/print")) as RosRow[];
      pppCount = ppp.length;
      raw.ppp_count = pppCount;
    } catch {
      raw.ppp = "error";
    }

    let hotspotCount = 0;
    try {
      const hs = (await api.write("/ip/hotspot/active/print")) as RosRow[];
      hotspotCount = hs.length;
      raw.hotspot_count = hotspotCount;
    } catch {
      raw.hotspot = "unsupported_or_error";
    }

    let internetReachable: boolean | null = null;
    try {
      const ping = (await api.write("/ping", ["=address=8.8.8.8", "=count=2"])) as RosRow[];
      raw.ping = ping;
      internetReachable = ping.some((p) => String(p.status ?? "").includes("timeout") === false);
    } catch {
      internetReachable = null;
    }

    await api.close();

    const health_status: RouterHealthSnapshot["health_status"] = "online";
    return {
      metrics: {
        health_status,
        cpu_percent: cpuLoad,
        ram_percent: ramPercent,
        board_temperature_c: boardTemperature,
        voltage_v: voltage,
        voltage_supported: voltageSupported,
        uptime_seconds: parseUptimeSeconds(String(resource.uptime ?? "")),
        ppp_active_sessions: pppCount,
        hotspot_active_sessions: hotspotCount,
        interfaces_down: interfacesDown,
        traffic_rx_bps: ifaceTraffic.rx > 0 ? ifaceTraffic.rx : null,
        traffic_tx_bps: ifaceTraffic.tx > 0 ? ifaceTraffic.tx : null,
        internet_reachable: internetReachable,
        last_sync_ok: true,
        last_sync_at: new Date().toISOString(),
        last_sync_error: null,
        last_seen_at: new Date().toISOString(),
      },
      raw,
    };
  } catch (err) {
    try {
      await api.close();
    } catch {
      /* ignore */
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      metrics: {
        health_status: "offline",
        cpu_percent: null,
        ram_percent: null,
        board_temperature_c: null,
        voltage_v: null,
        voltage_supported: false,
        uptime_seconds: null,
        ppp_active_sessions: 0,
        hotspot_active_sessions: 0,
        interfaces_down: 0,
        traffic_rx_bps: null,
        traffic_tx_bps: null,
        internet_reachable: null,
        last_sync_ok: false,
        last_sync_at: new Date().toISOString(),
        last_sync_error: msg.slice(0, 512),
        last_seen_at: null,
      },
      raw: { error: msg },
    };
  }
}

export async function collectRouterHealthForTenant(pool: Pool, tenantId: string): Promise<RouterHealthSnapshot[]> {
  if (!(await hasTable(pool, "nas_devices")) || !(await hasTable(pool, "router_health_snapshots"))) {
    return [];
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT n.* FROM nas_devices n
     WHERE n.tenant_id = ? AND n.status = 'active'`,
    [tenantId]
  );
  const out: RouterHealthSnapshot[] = [];
  for (const row of rows) {
    const nasId = String(row.id);
    const nasName = String(row.name ?? "");
    const nasIp = String(row.ip ?? "");
    let snapshot: RouterHealthSnapshot;

    if (!nasRowHasMikrotikApi(row)) {
      snapshot = {
        nas_device_id: nasId,
        tenant_id: tenantId,
        nas_name: nasName,
        nas_ip: nasIp,
        health_status: "unknown",
        cpu_percent: null,
        ram_percent: null,
        board_temperature_c: null,
        voltage_v: null,
        voltage_supported: false,
        uptime_seconds: null,
        ppp_active_sessions: Number(row.session_count ?? 0),
        hotspot_active_sessions: 0,
        interfaces_down: 0,
        traffic_rx_bps: null,
        traffic_tx_bps: null,
        internet_reachable: null,
        last_sync_ok: false,
        last_sync_at: null,
        last_sync_error: "mikrotik_api_not_configured",
        last_seen_at: null,
      };
    } else {
      const host = resolveMikrotikApiHost(row);
      const user = String(row.mikrotik_api_user ?? "").trim();
      const password = String(row.mikrotik_api_password ?? "");
      if (!host) {
        snapshot = {
          nas_device_id: nasId,
          tenant_id: tenantId,
          nas_name: nasName,
          nas_ip: nasIp,
          health_status: "unknown",
          cpu_percent: null,
          ram_percent: null,
          board_temperature_c: null,
          voltage_v: null,
          voltage_supported: false,
          uptime_seconds: null,
          ppp_active_sessions: 0,
          hotspot_active_sessions: 0,
          interfaces_down: 0,
          traffic_rx_bps: null,
          traffic_tx_bps: null,
          internet_reachable: null,
          last_sync_ok: false,
          last_sync_at: new Date().toISOString(),
          last_sync_error: "invalid_api_host",
          last_seen_at: null,
        };
      } else {
        const started = Date.now();
        const { metrics, raw } = await collectFromRouter(host, user, password);
        await logRouterCommand(pool, {
          tenantId,
          routerId: nasId,
          nasIp: host,
          commandType: "ros.health.collect",
          payload: { path: "/system/resource/print" },
          result: { health_status: metrics.health_status },
          errorMessage: metrics.last_sync_error,
          durationMs: Date.now() - started,
          retryCount: 0,
        });
        if (!metrics.last_sync_ok) {
          log.warn(`router_health_collect_failed nas=${host}`, { host, error: metrics.last_sync_error }, "infra-monitor");
        }
        snapshot = {
          nas_device_id: nasId,
          tenant_id: tenantId,
          nas_name: nasName,
          nas_ip: nasIp,
          ...metrics,
        };
        await pool.execute(
          `INSERT INTO router_health_snapshots
            (nas_device_id, tenant_id, nas_name, nas_ip, health_status, cpu_percent, ram_percent,
             board_temperature_c, voltage_v, voltage_supported, uptime_seconds, ppp_active_sessions,
             hotspot_active_sessions, interfaces_down, traffic_rx_bps, traffic_tx_bps, internet_reachable,
             metrics_json, last_sync_ok, last_sync_at, last_sync_error, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, NOW(3))
           ON DUPLICATE KEY UPDATE
             nas_name = VALUES(nas_name), nas_ip = VALUES(nas_ip), health_status = VALUES(health_status),
             cpu_percent = VALUES(cpu_percent), ram_percent = VALUES(ram_percent),
             board_temperature_c = VALUES(board_temperature_c), voltage_v = VALUES(voltage_v),
             voltage_supported = VALUES(voltage_supported), uptime_seconds = VALUES(uptime_seconds),
             ppp_active_sessions = VALUES(ppp_active_sessions), hotspot_active_sessions = VALUES(hotspot_active_sessions),
             interfaces_down = VALUES(interfaces_down), traffic_rx_bps = VALUES(traffic_rx_bps),
             traffic_tx_bps = VALUES(traffic_tx_bps), internet_reachable = VALUES(internet_reachable),
             metrics_json = VALUES(metrics_json), last_sync_ok = VALUES(last_sync_ok),
             last_sync_at = VALUES(last_sync_at), last_sync_error = VALUES(last_sync_error),
             last_seen_at = VALUES(last_seen_at)`,
          [
            nasId,
            tenantId,
            nasName,
            nasIp,
            snapshot.health_status,
            snapshot.cpu_percent,
            snapshot.ram_percent,
            snapshot.board_temperature_c,
            snapshot.voltage_v,
            snapshot.voltage_supported ? 1 : 0,
            snapshot.uptime_seconds,
            snapshot.ppp_active_sessions,
            snapshot.hotspot_active_sessions,
            snapshot.interfaces_down,
            snapshot.traffic_rx_bps,
            snapshot.traffic_tx_bps,
            snapshot.internet_reachable,
            JSON.stringify(raw),
            snapshot.last_sync_ok ? 1 : 0,
            snapshot.last_sync_error,
          ]
        );
        out.push(snapshot);
        continue;
      }
    }

    await pool.execute(
      `INSERT INTO router_health_snapshots
        (nas_device_id, tenant_id, nas_name, nas_ip, health_status, last_sync_ok, last_sync_error, ppp_active_sessions)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)
       ON DUPLICATE KEY UPDATE health_status = VALUES(health_status), last_sync_error = VALUES(last_sync_error)`,
      [nasId, tenantId, nasName, nasIp, snapshot.health_status, snapshot.last_sync_error, snapshot.ppp_active_sessions]
    );
    out.push(snapshot);
  }
  return out;
}

export async function listRouterHealthSnapshots(pool: Pool, tenantId: string): Promise<RouterHealthSnapshot[]> {
  if (!(await hasTable(pool, "router_health_snapshots"))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM router_health_snapshots WHERE tenant_id = ? ORDER BY nas_name`,
    [tenantId]
  );
  return rows.map((r) => ({
    nas_device_id: String(r.nas_device_id),
    tenant_id: String(r.tenant_id),
    nas_name: String(r.nas_name),
    nas_ip: String(r.nas_ip),
    health_status: String(r.health_status) as RouterHealthSnapshot["health_status"],
    cpu_percent: r.cpu_percent != null ? Number(r.cpu_percent) : null,
    ram_percent: r.ram_percent != null ? Number(r.ram_percent) : null,
    board_temperature_c: r.board_temperature_c != null ? Number(r.board_temperature_c) : null,
    voltage_v: r.voltage_v != null ? Number(r.voltage_v) : null,
    voltage_supported: Boolean(r.voltage_supported),
    uptime_seconds: r.uptime_seconds != null ? Number(r.uptime_seconds) : null,
    ppp_active_sessions: Number(r.ppp_active_sessions ?? 0),
    hotspot_active_sessions: Number(r.hotspot_active_sessions ?? 0),
    interfaces_down: Number(r.interfaces_down ?? 0),
    traffic_rx_bps: r.traffic_rx_bps != null ? Number(r.traffic_rx_bps) : null,
    traffic_tx_bps: r.traffic_tx_bps != null ? Number(r.traffic_tx_bps) : null,
    internet_reachable: r.internet_reachable != null ? Boolean(r.internet_reachable) : null,
    last_sync_ok: Boolean(r.last_sync_ok),
    last_sync_at: r.last_sync_at ? new Date(r.last_sync_at as string).toISOString() : null,
    last_sync_error: r.last_sync_error != null ? String(r.last_sync_error) : null,
    last_seen_at: r.last_seen_at ? new Date(r.last_seen_at as string).toISOString() : null,
  }));
}

/** Previous PPP count for drop detection */
export async function getPreviousPppCount(pool: Pool, nasDeviceId: string): Promise<number | null> {
  if (!(await hasTable(pool, "router_health_snapshots"))) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ppp_active_sessions FROM router_health_snapshots WHERE nas_device_id = ? LIMIT 1`,
    [nasDeviceId]
  );
  if (!rows[0]) return null;
  return Number(rows[0].ppp_active_sessions ?? 0);
}
