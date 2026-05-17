import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getTableColumns, hasTable } from "../../db/schemaGuards.js";
import {
  bytesDeltaToMbps,
  computeTrafficPeriodMb,
  sleep,
} from "./traffic-metrics.util.js";
import {
  resolveMikrotikApiHost,
  resolveMikrotikApiPort,
  nasRowHasMikrotikApi,
} from "../mikrotik-api-probe.js";
import {
  createRouterOsApi,
  isRosDisabled,
  isRosRunning,
  parseHealthSensors,
  parsePingInternetReachable,
  parseRosNumber,
  parseRosUptimeSeconds,
  parseRouterOsVersion,
  safeApiClose,
  withTimeout,
  type RosRow,
} from "../mikrotik-routeros-compat.js";

import { logRouterCommand } from "../router-command-log.service.js";
import { log } from "../logger.service.js";
import type { RouterHealthSnapshot } from "./infrastructure-types.js";
import type { RouterOSAPI } from "node-routeros";

export type RouterCollectOptions = {
  /** Skip /ping (often blocks 10–30s on RouterOS). */
  skipPing?: boolean;
  skipHotspot?: boolean;
  apiTimeoutMs?: number;
  /** Sample interface counters twice to compute instant Mbps. */
  measureInstantTraffic?: boolean;
  trafficSampleMs?: number;
};

function extractIfaceBytes(ifaces: RosRow[], trafficIface: string | null): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const iface of ifaces) {
    const ifaceName = String(iface.name ?? "");
    const type = String(iface.type ?? "");
    if (trafficIface) {
      if (ifaceName !== trafficIface) continue;
      return {
        rx: parseRosNumber(iface["rx-byte"]) ?? 0,
        tx: parseRosNumber(iface["tx-byte"]) ?? 0,
      };
    }
    if (type !== "loopback") {
      rx += parseRosNumber(iface["rx-byte"]) ?? 0;
      tx += parseRosNumber(iface["tx-byte"]) ?? 0;
    }
  }
  return { rx, tx };
}

async function measureInstantInterfaceMbps(
  api: RouterOSAPI,
  trafficIface: string | null,
  sampleMs: number
): Promise<{ rxMbps: number; txMbps: number }> {
  const ifaces1 = (await api.write("/interface/print")) as RosRow[];
  const b1 = extractIfaceBytes(ifaces1, trafficIface);
  await sleep(sampleMs);
  const ifaces2 = (await api.write("/interface/print")) as RosRow[];
  const b2 = extractIfaceBytes(ifaces2, trafficIface);
  const elapsedSec = sampleMs / 1000;
  return bytesDeltaToMbps(b2.rx - b1.rx, b2.tx - b1.tx, elapsedSec);
}

async function collectFromRouter(
  host: string,
  user: string,
  password: string,
  port: number,
  trafficMonitorInterface: string | null,
  collectOpts: RouterCollectOptions = {}
): Promise<{
  metrics: Omit<RouterHealthSnapshot, "nas_device_id" | "tenant_id" | "nas_name" | "nas_ip">;
  raw: Record<string, unknown>;
}> {
  const api = createRouterOsApi(host, user, password, port, collectOpts.apiTimeoutMs ?? 12_000);
  const trafficIface = trafficMonitorInterface?.trim() || null;
  const raw: Record<string, unknown> = {};
  try {
    await api.connect();
    const resource = ((await api.write("/system/resource/print")) as RosRow[])[0] ?? {};
    raw.resource = resource;
    raw.router_os_version = parseRouterOsVersion(resource);
    const totalMem = parseRosNumber(resource["total-memory"]) ?? 0;
    const freeMem = parseRosNumber(resource["free-memory"]) ?? 0;
    const cpuLoad = parseRosNumber(resource["cpu-load"]) ?? null;
    const ramPercent =
      totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10 : null;

    let boardTemperature: number | null = null;
    let voltage: number | null = null;
    let voltageSupported = false;
    try {
      const healthRows = (await api.write("/system/health/print")) as RosRow[];
      raw.health = healthRows;
      const parsed = parseHealthSensors(healthRows);
      boardTemperature = parsed.boardTemperature;
      voltage = parsed.voltage;
      voltageSupported = parsed.voltageSupported;
    } catch {
      raw.health = "unsupported";
    }

    let interfacesDown = 0;
    const ifaceTraffic: { rx: number; tx: number } = { rx: 0, tx: 0 };
    try {
      const ifaces = (await api.write("/interface/print")) as RosRow[];
      raw.interfaces_count = ifaces.length;
      for (const iface of ifaces) {
        const ifaceName = String(iface.name ?? "");
        const disabled = isRosDisabled(iface.disabled);
        const running = isRosRunning(iface.running);
        const type = String(iface.type ?? "");
        if (trafficIface) {
          if (ifaceName !== trafficIface) continue;
          if (!disabled && !running) interfacesDown += 1;
          ifaceTraffic.rx = parseRosNumber(iface["rx-byte"]) ?? 0;
          ifaceTraffic.tx = parseRosNumber(iface["tx-byte"]) ?? 0;
          break;
        }
        if (!disabled && !running && type !== "loopback") interfacesDown += 1;
        if (type !== "loopback") {
          const rx = parseRosNumber(iface["rx-byte"]) ?? 0;
          const tx = parseRosNumber(iface["tx-byte"]) ?? 0;
          ifaceTraffic.rx += rx;
          ifaceTraffic.tx += tx;
        }
      }
    } catch (e) {
      raw.interfaces_error = String(e);
    }

    let trafficRxMbps: number | null = null;
    let trafficTxMbps: number | null = null;
    if (collectOpts.measureInstantTraffic) {
      try {
        const sampleMs = Math.max(1000, Math.min(5000, collectOpts.trafficSampleMs ?? 2000));
        const rates = await measureInstantInterfaceMbps(api, trafficIface, sampleMs);
        trafficRxMbps = rates.rxMbps;
        trafficTxMbps = rates.txMbps;
        raw.traffic_instant_mbps = rates;
        raw.traffic_sample_ms = sampleMs;
      } catch (e) {
        raw.traffic_instant_error = String(e);
      }
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
    if (!collectOpts.skipHotspot) {
      try {
        const hs = (await api.write("/ip/hotspot/active/print")) as RosRow[];
        hotspotCount = hs.length;
        raw.hotspot_count = hotspotCount;
      } catch {
        raw.hotspot = "unsupported_or_error";
      }
    }

    let internetReachable: boolean | null = null;
    if (!collectOpts.skipPing) {
      try {
        const ping = (await withTimeout(
          api.write("/ping", ["=address=8.8.8.8", "=count=1"]) as Promise<RosRow[]>,
          5_000,
          "ping_timeout"
        )) as RosRow[];
        raw.ping = ping;
        internetReachable = parsePingInternetReachable(ping);
      } catch {
        raw.ping = "skipped_or_timeout";
        internetReachable = null;
      }
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
        uptime_seconds: parseRosUptimeSeconds(String(resource.uptime ?? "")),
        ppp_active_sessions: pppCount,
        hotspot_active_sessions: hotspotCount,
        interfaces_down: interfacesDown,
        traffic_rx_bps: ifaceTraffic.rx,
        traffic_tx_bps: ifaceTraffic.tx,
        traffic_rx_mb: null,
        traffic_tx_mb: null,
        traffic_rx_mbps: trafficRxMbps,
        traffic_tx_mbps: trafficTxMbps,
        traffic_monitor_interface: trafficIface,
        internet_reachable: internetReachable,
        last_sync_ok: true,
        last_sync_at: new Date().toISOString(),
        last_sync_error: null,
        last_seen_at: new Date().toISOString(),
      },
      raw,
    };
  } catch (err) {
    await safeApiClose(api);
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
        traffic_rx_mb: null,
        traffic_tx_mb: null,
        traffic_rx_mbps: null,
        traffic_tx_mbps: null,
        traffic_monitor_interface: trafficIface,
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

const FAST_COLLECT: RouterCollectOptions = {
  skipPing: true,
  skipHotspot: true,
  apiTimeoutMs: 12_000,
  measureInstantTraffic: true,
  trafficSampleMs: 2000,
};

export async function collectRouterHealthForTenant(
  pool: Pool,
  tenantId: string,
  prevById: Map<string, RouterHealthSnapshot> = new Map(),
  collectOpts: RouterCollectOptions = {}
): Promise<RouterHealthSnapshot[]> {
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
        traffic_rx_mb: null,
        traffic_tx_mb: null,
        traffic_rx_mbps: null,
        traffic_tx_mbps: null,
        traffic_monitor_interface: null,
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
          traffic_rx_mb: null,
          traffic_tx_mb: null,
          traffic_rx_mbps: null,
          traffic_tx_mbps: null,
          traffic_monitor_interface: null,
          internet_reachable: null,
          last_sync_ok: false,
          last_sync_at: new Date().toISOString(),
          last_sync_error: "invalid_api_host",
          last_seen_at: null,
        };
      } else {
        const started = Date.now();
        const port = resolveMikrotikApiPort(row);
        const trafficIface = row.traffic_monitor_interface != null
          ? String(row.traffic_monitor_interface).trim() || null
          : null;
        const { metrics, raw } = await collectFromRouter(
          host,
          user,
          password,
          port,
          trafficIface,
          collectOpts
        );
        const prev = prevById.get(nasId);
        if (metrics.traffic_rx_bps != null && metrics.traffic_tx_bps != null) {
          const period = computeTrafficPeriodMb(
            metrics.traffic_rx_bps,
            metrics.traffic_tx_bps,
            prev?.traffic_rx_bps,
            prev?.traffic_tx_bps,
            prev?.last_sync_at
          );
          metrics.traffic_rx_mb = period.rxMb;
          metrics.traffic_tx_mb = period.txMb;
        }
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
        const snapCols = await getTableColumns(pool, "router_health_snapshots");
        const rowParams = [
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
        ] as const;
        if (snapCols.has("traffic_rx_mbps")) {
          await pool.execute(
            `INSERT INTO router_health_snapshots
              (nas_device_id, tenant_id, nas_name, nas_ip, health_status, cpu_percent, ram_percent,
               board_temperature_c, voltage_v, voltage_supported, uptime_seconds, ppp_active_sessions,
               hotspot_active_sessions, interfaces_down, traffic_rx_bps, traffic_tx_bps,
               traffic_rx_mb_period, traffic_tx_mb_period, traffic_rx_mbps, traffic_tx_mbps,
               internet_reachable, metrics_json, last_sync_ok, last_sync_at, last_sync_error, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, NOW(3))
             ON DUPLICATE KEY UPDATE
               nas_name = VALUES(nas_name), nas_ip = VALUES(nas_ip), health_status = VALUES(health_status),
               cpu_percent = VALUES(cpu_percent), ram_percent = VALUES(ram_percent),
               board_temperature_c = VALUES(board_temperature_c), voltage_v = VALUES(voltage_v),
               voltage_supported = VALUES(voltage_supported), uptime_seconds = VALUES(uptime_seconds),
               ppp_active_sessions = VALUES(ppp_active_sessions),
               hotspot_active_sessions = VALUES(hotspot_active_sessions),
               interfaces_down = VALUES(interfaces_down), traffic_rx_bps = VALUES(traffic_rx_bps),
               traffic_tx_bps = VALUES(traffic_tx_bps),
               traffic_rx_mb_period = VALUES(traffic_rx_mb_period),
               traffic_tx_mb_period = VALUES(traffic_tx_mb_period),
               traffic_rx_mbps = VALUES(traffic_rx_mbps),
               traffic_tx_mbps = VALUES(traffic_tx_mbps),
               internet_reachable = VALUES(internet_reachable),
               metrics_json = VALUES(metrics_json), last_sync_ok = VALUES(last_sync_ok),
               last_sync_at = NOW(3), last_sync_error = VALUES(last_sync_error), last_seen_at = NOW(3)`,
            [
              ...rowParams.slice(0, 16),
              snapshot.traffic_rx_mb,
              snapshot.traffic_tx_mb,
              snapshot.traffic_rx_mbps,
              snapshot.traffic_tx_mbps,
              ...rowParams.slice(16),
            ]
          );
        } else if (snapCols.has("traffic_rx_mb_period")) {
          await pool.execute(
            `INSERT INTO router_health_snapshots
              (nas_device_id, tenant_id, nas_name, nas_ip, health_status, cpu_percent, ram_percent,
               board_temperature_c, voltage_v, voltage_supported, uptime_seconds, ppp_active_sessions,
               hotspot_active_sessions, interfaces_down, traffic_rx_bps, traffic_tx_bps,
               traffic_rx_mb_period, traffic_tx_mb_period, internet_reachable,
               metrics_json, last_sync_ok, last_sync_at, last_sync_error, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, NOW(3))
             ON DUPLICATE KEY UPDATE
               nas_name = VALUES(nas_name), nas_ip = VALUES(nas_ip), health_status = VALUES(health_status),
               cpu_percent = VALUES(cpu_percent), ram_percent = VALUES(ram_percent),
               board_temperature_c = VALUES(board_temperature_c), voltage_v = VALUES(voltage_v),
               voltage_supported = VALUES(voltage_supported), uptime_seconds = VALUES(uptime_seconds),
               ppp_active_sessions = VALUES(ppp_active_sessions),
               hotspot_active_sessions = VALUES(hotspot_active_sessions),
               interfaces_down = VALUES(interfaces_down), traffic_rx_bps = VALUES(traffic_rx_bps),
               traffic_tx_bps = VALUES(traffic_tx_bps),
               traffic_rx_mb_period = VALUES(traffic_rx_mb_period),
               traffic_tx_mb_period = VALUES(traffic_tx_mb_period),
               internet_reachable = VALUES(internet_reachable),
               metrics_json = VALUES(metrics_json), last_sync_ok = VALUES(last_sync_ok),
               last_sync_at = NOW(3), last_sync_error = VALUES(last_sync_error), last_seen_at = NOW(3)`,
            [
              ...rowParams.slice(0, 16),
              snapshot.traffic_rx_mb,
              snapshot.traffic_tx_mb,
              ...rowParams.slice(16),
            ]
          );
        } else {
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
               last_sync_at = NOW(3), last_sync_error = VALUES(last_sync_error), last_seen_at = NOW(3)`,
            [...rowParams]
          );
        }
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

export type StatusReportRouterPrep = {
  routers: RouterHealthSnapshot[];
  issue?: "migration_required" | "no_active_nas";
  active_nas_count: number;
  mikrotik_api_count: number;
};

export type PrepareRoutersOptions = {
  /** Collect when snapshot table has no rows. */
  collectIfEmpty?: boolean;
  /** Always re-collect with instant Mbps (Telegram send time). */
  freshCollect?: boolean;
};

/** Load snapshots for Telegram; optional fresh collect with instant line speed. */
export async function prepareRoutersForStatusReport(
  pool: Pool,
  tenantId: string,
  options: PrepareRoutersOptions = {}
): Promise<StatusReportRouterPrep> {
  const collectIfEmpty = options.collectIfEmpty ?? true;
  const freshCollect = options.freshCollect ?? false;
  if (!(await hasTable(pool, "nas_devices"))) {
    return { routers: [], issue: "no_active_nas", active_nas_count: 0, mikrotik_api_count: 0 };
  }
  if (!(await hasTable(pool, "router_health_snapshots"))) {
    const [nasRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM nas_devices WHERE tenant_id = ? AND status = 'active'`,
      [tenantId]
    );
    const active = Number(nasRows[0]?.c ?? 0);
    return {
      routers: [],
      issue: "migration_required",
      active_nas_count: active,
      mikrotik_api_count: 0,
    };
  }

  const [nasStats] = await pool.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS active_count,
       SUM(CASE WHEN COALESCE(mikrotik_api_enabled, 0) = 1
         AND COALESCE(TRIM(mikrotik_api_user), '') <> ''
         AND mikrotik_api_password IS NOT NULL
         AND mikrotik_api_password <> '' THEN 1 ELSE 0 END) AS api_count
     FROM nas_devices WHERE tenant_id = ? AND status = 'active'`,
    [tenantId]
  );
  const activeNasCount = Number(nasStats[0]?.active_count ?? 0);
  const mikrotikApiCount = Number(nasStats[0]?.api_count ?? 0);

  if (activeNasCount === 0) {
    return { routers: [], issue: "no_active_nas", active_nas_count: 0, mikrotik_api_count: 0 };
  }

  let routers = await listRouterHealthSnapshots(pool, tenantId);
  const shouldCollect =
    freshCollect || (routers.length === 0 && collectIfEmpty);
  if (shouldCollect) {
    const prev = new Map(routers.map((r) => [r.nas_device_id, r]));
    const timeoutMs = Math.min(120_000, 20_000 + activeNasCount * 18_000);
    try {
      await withTimeout(
        collectRouterHealthForTenant(pool, tenantId, prev, FAST_COLLECT),
        timeoutMs,
        "collect_timeout"
      );
    } catch (err) {
      log.warn(
        `prepare_status_report_collect_timeout tenant=${tenantId} ${String(err)}`,
        {},
        "telegram"
      );
    }
    routers = await listRouterHealthSnapshots(pool, tenantId);
  }

  return {
    routers,
    active_nas_count: activeNasCount,
    mikrotik_api_count: mikrotikApiCount,
  };
}

export async function listRouterHealthSnapshots(pool: Pool, tenantId: string): Promise<RouterHealthSnapshot[]> {
  if (!(await hasTable(pool, "router_health_snapshots"))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.*, n.traffic_monitor_interface
     FROM router_health_snapshots s
     LEFT JOIN nas_devices n ON n.id = s.nas_device_id
     WHERE s.tenant_id = ?
     ORDER BY s.nas_name`,
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
    traffic_rx_mb:
      r.traffic_rx_mb_period != null
        ? Number(r.traffic_rx_mb_period)
        : null,
    traffic_tx_mb:
      r.traffic_tx_mb_period != null
        ? Number(r.traffic_tx_mb_period)
        : null,
    traffic_rx_mbps: r.traffic_rx_mbps != null ? Number(r.traffic_rx_mbps) : null,
    traffic_tx_mbps: r.traffic_tx_mbps != null ? Number(r.traffic_tx_mbps) : null,
    traffic_monitor_interface:
      r.traffic_monitor_interface != null ? String(r.traffic_monitor_interface) : null,
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
