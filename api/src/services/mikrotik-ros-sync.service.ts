import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { RouterOSAPI } from "node-routeros";
import { hasTable } from "../db/schemaGuards.js";
import { log } from "./logger.service.js";
import { logRouterCommand } from "./router-command-log.service.js";
import { routerApiFailuresTotal } from "./metrics.service.js";

async function ensureSessionCacheTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mikrotik_session_cache (
      nas_id VARCHAR(36) NOT NULL,
      username VARCHAR(128) NOT NULL,
      uptime VARCHAR(64) DEFAULT NULL,
      last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (nas_id, username),
      KEY idx_mikrotik_session_cache_last_seen (last_seen)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function apiHost(row: RowDataPacket): string | null {
  const tunnel = String(row.wireguard_tunnel_ip ?? "").trim();
  const pub = String(row.ip ?? "").trim();
  const host = tunnel || pub;
  if (!host) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  return null;
}

/**
 * Snapshot of PPPoE active sessions via RouterOS API on `nas_devices` (not MikroTik as source of truth —
 * only a monitoring / reconciliation input). Controlled by MIKROTIK_API_SYNC_MS on the worker.
 */
export async function syncMikrotikSessionsFromNasTable(pool: Pool): Promise<void> {
  if (!(await hasTable(pool, "nas_devices"))) return;
  await ensureSessionCacheTable(pool);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, ip, wireguard_tunnel_ip, mikrotik_api_enabled, mikrotik_api_user, mikrotik_api_password
     FROM nas_devices
     WHERE status = 'active'
       AND COALESCE(mikrotik_api_enabled, 0) = 1
       AND COALESCE(TRIM(mikrotik_api_user), '') <> ''`
  );

  for (const row of rows) {
    const host = apiHost(row);
    const user = String(row.mikrotik_api_user ?? "").trim();
    const password = String(row.mikrotik_api_password ?? "");
    const nasId = String(row.id ?? "");
    const tenantId = String(row.tenant_id ?? "");
    if (!host || !user || !nasId) continue;

    const api = new RouterOSAPI({
      host,
      user,
      password,
      port: 8728,
      timeout: 8000,
    });

    const started = Date.now();
    try {
      await api.connect();
      const sessions = await api.write("/ppp/active/print");
      await api.close();
      const duration = Date.now() - started;

      for (const s of sessions) {
        const username = String((s as { name?: string }).name ?? "").trim();
        if (!username) continue;
        const uptime = String((s as { uptime?: string }).uptime ?? "");
        await pool.execute(
          `INSERT INTO mikrotik_session_cache (nas_id, username, uptime, last_seen)
           VALUES (?, ?, ?, NOW(3))
           ON DUPLICATE KEY UPDATE uptime = VALUES(uptime), last_seen = NOW(3)`,
          [nasId, username.slice(0, 128), uptime.slice(0, 64)]
        );
      }

      await logRouterCommand(pool, {
        tenantId,
        routerId: nasId,
        nasIp: host,
        commandType: "ros.ppp_active.print",
        payload: { path: "/ppp/active/print" },
        result: { session_count: sessions.length },
        errorMessage: null,
        durationMs: duration,
        retryCount: 0,
      });

      if (await hasTable(pool, "router_sync_status")) {
        await pool.execute(
          `INSERT INTO router_sync_status (nas_device_id, tenant_id, last_sync_at, last_ok, last_message, last_session_count, updated_at)
           VALUES (?, ?, NOW(3), 1, 'ok', ?, NOW(3))
           ON DUPLICATE KEY UPDATE
             last_sync_at = NOW(3), last_ok = 1, last_message = 'ok', last_session_count = VALUES(last_session_count), updated_at = NOW(3)`,
          [nasId, tenantId, sessions.length]
        );
      }

      log.info(
        `mikrotik_ros_sync nas_device_id=${nasId} host=${host} sessions=${sessions.length}`,
        { nasId, host, count: sessions.length },
        "mikrotik-sync"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - started;
      routerApiFailuresTotal.inc({ command: "ros.ppp_active.print" });
      await logRouterCommand(pool, {
        tenantId,
        routerId: nasId,
        nasIp: host,
        commandType: "ros.ppp_active.print",
        payload: { path: "/ppp/active/print" },
        result: null,
        errorMessage: msg,
        durationMs: duration,
        retryCount: 0,
      });
      if (await hasTable(pool, "router_sync_errors")) {
        await pool.execute(
          `INSERT INTO router_sync_errors (tenant_id, nas_device_id, nas_ip, error_message, created_at)
           VALUES (?, ?, ?, ?, NOW(3))`,
          [tenantId, nasId, host, msg.slice(0, 1024)]
        );
      }
      if (await hasTable(pool, "router_sync_status")) {
        await pool.execute(
          `INSERT INTO router_sync_status (nas_device_id, tenant_id, last_sync_at, last_ok, last_message, last_session_count, updated_at)
           VALUES (?, ?, NOW(3), 0, ?, 0, NOW(3))
           ON DUPLICATE KEY UPDATE
             last_sync_at = NOW(3), last_ok = 0, last_message = VALUES(last_message), last_session_count = 0, updated_at = NOW(3)`,
          [nasId, tenantId, msg.slice(0, 512)]
        );
      }
      log.warn(`mikrotik_ros_sync_failed nas=${host}: ${msg}`, { host, error: msg }, "mikrotik-sync");
      try {
        await api.close();
      } catch {
        /* ignore */
      }
    }
  }
}
