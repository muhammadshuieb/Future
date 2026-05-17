export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "firing" | "resolved" | "acknowledged";

export type InfrastructureAlertType =
  | "router_offline"
  | "high_cpu"
  | "high_ram"
  | "high_temperature"
  | "low_voltage"
  | "interface_down"
  | "ppp_session_drop"
  | "traffic_spike"
  | "sync_failed"
  | "backup_failed"
  | "radius_down"
  | "whatsapp_disconnected"
  | "server_down"
  | "high_server_cpu"
  | "high_server_ram"
  | "disk_almost_full"
  | "service_down";

export type RouterHealthSnapshot = {
  nas_device_id: string;
  tenant_id: string;
  nas_name: string;
  nas_ip: string;
  health_status: "online" | "offline" | "degraded" | "unknown";
  cpu_percent: number | null;
  ram_percent: number | null;
  board_temperature_c: number | null;
  voltage_v: number | null;
  voltage_supported: boolean;
  uptime_seconds: number | null;
  ppp_active_sessions: number;
  hotspot_active_sessions: number;
  interfaces_down: number;
  /** Cumulative rx-byte counter from RouterOS (legacy column name). */
  traffic_rx_bps: number | null;
  /** Cumulative tx-byte counter from RouterOS (legacy column name). */
  traffic_tx_bps: number | null;
  /** MB downloaded since previous poll. */
  traffic_rx_mb: number | null;
  /** MB uploaded since previous poll. */
  traffic_tx_mb: number | null;
  traffic_monitor_interface: string | null;
  internet_reachable: boolean | null;
  last_sync_ok: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_seen_at: string | null;
};

export type ThresholdConfig = {
  cpu_percent_max: number;
  ram_percent_max: number;
  temperature_c_max: number;
  voltage_v_min: number | null;
  ppp_session_drop_percent: number;
  traffic_rx_mbps_spike: number | null;
  traffic_tx_mbps_spike: number | null;
  disk_percent_max: number;
  server_ram_percent_max: number;
  server_cpu_load_multiplier: number;
};

export type MonitoringSettings = {
  infrastructure_alerts_enabled: boolean;
  whatsapp_alerts_enabled: boolean;
  whatsapp_critical_only: boolean;
  telegram_configured: boolean;
  telegram_alerts_enabled: boolean;
  alert_cooldown_minutes: number;
  router_offline_minutes: number;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  recovery_notifications_enabled: boolean;
  poll_interval_seconds: number;
};

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  cpu_percent_max: 90,
  ram_percent_max: 90,
  temperature_c_max: 70,
  voltage_v_min: 11.5,
  ppp_session_drop_percent: 50,
  traffic_rx_mbps_spike: null,
  traffic_tx_mbps_spike: null,
  disk_percent_max: 90,
  server_ram_percent_max: 90,
  server_cpu_load_multiplier: 2,
};

export const DEFAULT_MONITORING_SETTINGS: MonitoringSettings = {
  infrastructure_alerts_enabled: true,
  whatsapp_alerts_enabled: true,
  whatsapp_critical_only: false,
  telegram_configured: false,
  telegram_alerts_enabled: false,
  alert_cooldown_minutes: 30,
  router_offline_minutes: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
  recovery_notifications_enabled: true,
  poll_interval_seconds: 180,
};
