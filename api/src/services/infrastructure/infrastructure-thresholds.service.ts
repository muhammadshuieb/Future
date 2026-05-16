import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasTable } from "../../db/schemaGuards.js";
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from "./infrastructure-types.js";

function rowToThreshold(r: RowDataPacket): ThresholdConfig {
  return {
    cpu_percent_max: Number(r.cpu_percent_max ?? DEFAULT_THRESHOLDS.cpu_percent_max),
    ram_percent_max: Number(r.ram_percent_max ?? DEFAULT_THRESHOLDS.ram_percent_max),
    temperature_c_max: Number(r.temperature_c_max ?? DEFAULT_THRESHOLDS.temperature_c_max),
    voltage_v_min: r.voltage_v_min != null ? Number(r.voltage_v_min) : DEFAULT_THRESHOLDS.voltage_v_min,
    ppp_session_drop_percent: Number(
      r.ppp_session_drop_percent ?? DEFAULT_THRESHOLDS.ppp_session_drop_percent
    ),
    traffic_rx_mbps_spike:
      r.traffic_rx_mbps_spike != null ? Number(r.traffic_rx_mbps_spike) : DEFAULT_THRESHOLDS.traffic_rx_mbps_spike,
    traffic_tx_mbps_spike:
      r.traffic_tx_mbps_spike != null ? Number(r.traffic_tx_mbps_spike) : DEFAULT_THRESHOLDS.traffic_tx_mbps_spike,
    disk_percent_max: Number(r.disk_percent_max ?? DEFAULT_THRESHOLDS.disk_percent_max),
    server_ram_percent_max: Number(r.server_ram_percent_max ?? DEFAULT_THRESHOLDS.server_ram_percent_max),
    server_cpu_load_multiplier: Number(
      r.server_cpu_load_multiplier ?? DEFAULT_THRESHOLDS.server_cpu_load_multiplier
    ),
  };
}

export async function getGlobalThresholds(pool: Pool, tenantId: string): Promise<ThresholdConfig> {
  if (!(await hasTable(pool, "infrastructure_thresholds"))) return { ...DEFAULT_THRESHOLDS };
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM infrastructure_thresholds WHERE tenant_id = ? AND nas_device_id IS NULL LIMIT 1`,
    [tenantId]
  );
  if (!rows[0]) {
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO infrastructure_thresholds (id, tenant_id, nas_device_id) VALUES (?, ?, NULL)`,
      [id, tenantId]
    );
    return { ...DEFAULT_THRESHOLDS };
  }
  return rowToThreshold(rows[0]);
}

export async function getNasThresholds(
  pool: Pool,
  tenantId: string,
  nasDeviceId: string
): Promise<ThresholdConfig> {
  const global = await getGlobalThresholds(pool, tenantId);
  if (!(await hasTable(pool, "infrastructure_thresholds"))) return global;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM infrastructure_thresholds WHERE tenant_id = ? AND nas_device_id = ? LIMIT 1`,
    [tenantId, nasDeviceId]
  );
  if (!rows[0]) return global;
  return { ...global, ...rowToThreshold(rows[0]) };
}

export async function updateGlobalThresholds(
  pool: Pool,
  tenantId: string,
  input: Partial<ThresholdConfig>
): Promise<ThresholdConfig> {
  const cur = await getGlobalThresholds(pool, tenantId);
  const next = { ...cur, ...input };
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM infrastructure_thresholds WHERE tenant_id = ? AND nas_device_id IS NULL LIMIT 1`,
    [tenantId]
  );
  const id = existing[0]?.id ? String(existing[0].id) : randomUUID();
  await pool.execute(
    `INSERT INTO infrastructure_thresholds
      (id, tenant_id, nas_device_id, cpu_percent_max, ram_percent_max, temperature_c_max, voltage_v_min,
       ppp_session_drop_percent, traffic_rx_mbps_spike, traffic_tx_mbps_spike, disk_percent_max,
       server_ram_percent_max, server_cpu_load_multiplier)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      cpu_percent_max = VALUES(cpu_percent_max), ram_percent_max = VALUES(ram_percent_max),
      temperature_c_max = VALUES(temperature_c_max), voltage_v_min = VALUES(voltage_v_min),
      ppp_session_drop_percent = VALUES(ppp_session_drop_percent),
      traffic_rx_mbps_spike = VALUES(traffic_rx_mbps_spike), traffic_tx_mbps_spike = VALUES(traffic_tx_mbps_spike),
      disk_percent_max = VALUES(disk_percent_max), server_ram_percent_max = VALUES(server_ram_percent_max),
      server_cpu_load_multiplier = VALUES(server_cpu_load_multiplier)`,
    [
      id,
      tenantId,
      next.cpu_percent_max,
      next.ram_percent_max,
      next.temperature_c_max,
      next.voltage_v_min,
      next.ppp_session_drop_percent,
      next.traffic_rx_mbps_spike,
      next.traffic_tx_mbps_spike,
      next.disk_percent_max,
      next.server_ram_percent_max,
      next.server_cpu_load_multiplier,
    ]
  );
  return next;
}

export async function updateNasThresholds(
  pool: Pool,
  tenantId: string,
  nasDeviceId: string,
  input: Partial<ThresholdConfig>
): Promise<ThresholdConfig> {
  const global = await getGlobalThresholds(pool, tenantId);
  const next = { ...global, ...input };
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM infrastructure_thresholds WHERE tenant_id = ? AND nas_device_id = ? LIMIT 1`,
    [tenantId, nasDeviceId]
  );
  const id = existing[0]?.id ? String(existing[0].id) : randomUUID();
  await pool.execute(
    `INSERT INTO infrastructure_thresholds
      (id, tenant_id, nas_device_id, cpu_percent_max, ram_percent_max, temperature_c_max, voltage_v_min,
       ppp_session_drop_percent, traffic_rx_mbps_spike, traffic_tx_mbps_spike, disk_percent_max,
       server_ram_percent_max, server_cpu_load_multiplier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      cpu_percent_max = VALUES(cpu_percent_max), ram_percent_max = VALUES(ram_percent_max),
      temperature_c_max = VALUES(temperature_c_max), voltage_v_min = VALUES(voltage_v_min),
      ppp_session_drop_percent = VALUES(ppp_session_drop_percent),
      traffic_rx_mbps_spike = VALUES(traffic_rx_mbps_spike), traffic_tx_mbps_spike = VALUES(traffic_tx_mbps_spike),
      disk_percent_max = VALUES(disk_percent_max), server_ram_percent_max = VALUES(server_ram_percent_max),
      server_cpu_load_multiplier = VALUES(server_cpu_load_multiplier)`,
    [
      id,
      tenantId,
      nasDeviceId,
      next.cpu_percent_max,
      next.ram_percent_max,
      next.temperature_c_max,
      next.voltage_v_min,
      next.ppp_session_drop_percent,
      next.traffic_rx_mbps_spike,
      next.traffic_tx_mbps_spike,
      next.disk_percent_max,
      next.server_ram_percent_max,
      next.server_cpu_load_multiplier,
    ]
  );
  return next;
}
