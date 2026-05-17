import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRouterAlerts,
  evaluateServerAlerts,
} from "../services/infrastructure/infrastructure-alert-engine.service.js";
import { DEFAULT_MONITORING_SETTINGS, DEFAULT_THRESHOLDS } from "../services/infrastructure/infrastructure-types.js";
import type { RouterHealthSnapshot } from "../services/infrastructure/infrastructure-types.js";
import type { ServerHealthSnapshot } from "../services/infrastructure/server-health-collector.service.js";

function baseRouter(overrides: Partial<RouterHealthSnapshot>): RouterHealthSnapshot {
  return {
    nas_device_id: "nas-1",
    tenant_id: "t1",
    nas_name: "NAS-01",
    nas_ip: "10.0.0.1",
    health_status: "online",
    cpu_percent: 10,
    ram_percent: 20,
    board_temperature_c: 45,
    voltage_v: 12.2,
    voltage_supported: true,
    uptime_seconds: 3600,
    ppp_active_sessions: 100,
    hotspot_active_sessions: 0,
    interfaces_down: 0,
    traffic_rx_bps: null,
    traffic_tx_bps: null,
    traffic_rx_mb: null,
    traffic_tx_mb: null,
    traffic_rx_mbps: null,
    traffic_tx_mbps: null,
    traffic_monitor_interface: null,
    internet_reachable: true,
    last_sync_ok: true,
    last_sync_at: new Date().toISOString(),
    last_sync_error: null,
    last_seen_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("infrastructure alert engine", () => {
  it("fires high_cpu when above threshold", () => {
    const alerts = evaluateRouterAlerts(
      baseRouter({ cpu_percent: 95 }),
      null,
      DEFAULT_THRESHOLDS,
      DEFAULT_MONITORING_SETTINGS
    );
    assert.ok(alerts.some((a) => a.alert_type === "high_cpu"));
  });

  it("fires router_offline when sync fails", () => {
    const alerts = evaluateRouterAlerts(
      baseRouter({ last_sync_ok: false, last_sync_error: "timeout" }),
      null,
      DEFAULT_THRESHOLDS,
      DEFAULT_MONITORING_SETTINGS
    );
    assert.equal(alerts[0]?.alert_type, "router_offline");
  });

  it("detects ppp session drop", () => {
    const prev = baseRouter({ ppp_active_sessions: 100 });
    const cur = baseRouter({ ppp_active_sessions: 40 });
    const alerts = evaluateRouterAlerts(cur, prev, DEFAULT_THRESHOLDS, DEFAULT_MONITORING_SETTINGS);
    assert.ok(alerts.some((a) => a.alert_type === "ppp_session_drop"));
  });

  it("fires disk_almost_full on server", () => {
    const snap: ServerHealthSnapshot = {
      health_status: "degraded",
      cpu_load_1m: 1,
      cpu_count: 4,
      ram_percent: 50,
      disk_percent: 95,
      uptime_seconds: 1000,
      mysql_ok: true,
      redis_ok: true,
      freeradius_ok: true,
      worker_ok: true,
      docker: [],
      last_sync_at: null,
      last_sync_error: null,
    };
    const alerts = evaluateServerAlerts(snap, DEFAULT_THRESHOLDS, "t1");
    assert.ok(alerts.some((a) => a.alert_type === "disk_almost_full"));
  });
});
