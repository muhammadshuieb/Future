import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { RouterOSAPI } from "node-routeros";
import { hasTable } from "../db/schemaGuards.js";
import { log } from "./logger.service.js";

async function ensureSessionCacheTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mikrotik_session_cache (
      nas_id INT NOT NULL,
      username VARCHAR(128) NOT NULL,
      uptime VARCHAR(64) DEFAULT NULL,
      last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (nas_id, username),
      KEY idx_mikrotik_session_cache_last_seen (last_seen)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function nasApiHost(row: RowDataPacket): string | null {
  const name = String(row.nasname ?? "").trim();
  if (!name) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return name;
  return null;
}

/**
 * Best-effort snapshot of PPPoE active sessions from RouterOS API (NAS `apiusername` / `apipassword`).
 * Controlled by MIKROTIK_API_SYNC_MS on the worker (>0 enables periodic runs from workers/index).
 */
export async function syncMikrotikSessionsFromNasTable(pool: Pool): Promise<void> {
  if (!(await hasTable(pool, "nas"))) return;
  await ensureSessionCacheTable(pool);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, nasname, apiusername, apipassword
     FROM nas
     WHERE COALESCE(TRIM(apiusername), '') <> ''`
  );

  for (const row of rows) {
    const host = nasApiHost(row);
    const user = String(row.apiusername ?? "").trim();
    const password = String(row.apipassword ?? "");
    if (!host || !user) continue;

    const api = new RouterOSAPI({
      host,
      user,
      password,
      port: 8728,
      timeout: 8000,
    });

    try {
      await api.connect();
      const sessions = await api.write("/ppp/active/print");
      await api.close();

      const nasId = Number(row.id);
      if (!Number.isFinite(nasId)) continue;

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

      log.info(
        `mikrotik_ros_sync nas_id=${nasId} host=${host} sessions=${sessions.length}`,
        { nasId, host, count: sessions.length },
        "mikrotik-sync"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`mikrotik_ros_sync_failed nas=${host}: ${msg}`, { host, error: msg }, "mikrotik-sync");
      try {
        await api.close();
      } catch {
        /* ignore */
      }
    }
  }
}
