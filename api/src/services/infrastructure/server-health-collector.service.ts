import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasTable } from "../../db/schemaGuards.js";
import { createRedisClient } from "../../lib/redis-connection.js";
import { config } from "../../config.js";
import { getDiskSnapshot } from "../disk-monitor.service.js";

const execFileAsync = promisify(execFile);

export type ServerHealthSnapshot = {
  health_status: "online" | "degraded" | "offline" | "unknown";
  cpu_load_1m: number | null;
  cpu_count: number | null;
  ram_percent: number | null;
  disk_percent: number | null;
  uptime_seconds: number | null;
  mysql_ok: boolean | null;
  redis_ok: boolean | null;
  freeradius_ok: boolean | null;
  worker_ok: boolean | null;
  docker: { name: string; state: string }[];
  last_sync_at: string | null;
  last_sync_error: string | null;
};

async function checkMysql(pool: Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  const client = createRedisClient("infra-health-ping");
  try {
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

async function checkWorkerHeartbeat(): Promise<boolean> {
  const client = createRedisClient("infra-worker-hb");
  try {
    const raw = await client.get("future-radius:worker:heartbeat");
    if (!raw) return false;
    const ts = new Date(raw).getTime();
    return Number.isFinite(ts) && Date.now() - ts < 120_000;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

async function checkFreeradius(pool: Pool, tenantId: string): Promise<boolean> {
  if (!(await hasTable(pool, "radacct"))) return true;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT MAX(COALESCE(acctupdatetime, acctstarttime)) AS last_ts
       FROM radacct r
       INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
       WHERE r.acctstoptime IS NULL`,
      [tenantId]
    );
    const raw = rows[0]?.last_ts;
    if (!raw) return true;
    const age = Date.now() - new Date(raw as string).getTime();
    return age < 30 * 60_000;
  } catch {
    return false;
  }
}

async function listDockerContainers(): Promise<{ name: string; state: string }[]> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "-a", "--format", "{{.Names}}\t{{.State}}"],
      { timeout: 8000 }
    );
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, state] = line.split("\t");
        return { name: name ?? line, state: state ?? "unknown" };
      });
  } catch {
    return [];
  }
}

export async function collectServerHealth(pool: Pool, tenantId: string): Promise<ServerHealthSnapshot> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramPercent = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10 : null;
  const disk = getDiskSnapshot();
  const docker = await listDockerContainers();
  const mysqlOk = await checkMysql(pool);
  const redisOk = await checkRedis();
  const workerOk = await checkWorkerHeartbeat();
  const freeradiusOk = await checkFreeradius(pool, tenantId);

  const coreServices = ["mysql", "redis", "api", "worker", "freeradius"];
  const dockerDown = docker.filter((c) => {
    const n = c.name.toLowerCase();
    const isCore = coreServices.some((s) => n.includes(s));
    return isCore && !String(c.state).toLowerCase().startsWith("up");
  });

  let health_status: ServerHealthSnapshot["health_status"] = "online";
  if (!mysqlOk || !redisOk || !workerOk) health_status = "offline";
  else if (dockerDown.length > 0 || freeradiusOk === false) health_status = "degraded";

  const snap: ServerHealthSnapshot = {
    health_status,
    cpu_load_1m: Math.round((os.loadavg()[0] ?? 0) * 1000) / 1000,
    cpu_count: os.cpus().length,
    ram_percent: ramPercent,
    disk_percent: disk?.pct ?? null,
    uptime_seconds: Math.floor(os.uptime()),
    mysql_ok: mysqlOk,
    redis_ok: redisOk,
    freeradius_ok: freeradiusOk,
    worker_ok: workerOk,
    docker,
    last_sync_at: new Date().toISOString(),
    last_sync_error: null,
  };

  if (await hasTable(pool, "server_health_snapshots")) {
    await pool.execute(
      `INSERT INTO server_health_snapshots
        (tenant_id, health_status, cpu_load_1m, cpu_count, ram_percent, disk_percent, uptime_seconds,
         mysql_ok, redis_ok, freeradius_ok, worker_ok, docker_json, metrics_json, last_sync_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         health_status = VALUES(health_status), cpu_load_1m = VALUES(cpu_load_1m), cpu_count = VALUES(cpu_count),
         ram_percent = VALUES(ram_percent), disk_percent = VALUES(disk_percent), uptime_seconds = VALUES(uptime_seconds),
         mysql_ok = VALUES(mysql_ok), redis_ok = VALUES(redis_ok), freeradius_ok = VALUES(freeradius_ok),
         worker_ok = VALUES(worker_ok), docker_json = VALUES(docker_json), metrics_json = VALUES(metrics_json),
         last_sync_at = VALUES(last_sync_at)`,
      [
        tenantId,
        snap.health_status,
        snap.cpu_load_1m,
        snap.cpu_count,
        snap.ram_percent,
        snap.disk_percent,
        snap.uptime_seconds,
        mysqlOk ? 1 : 0,
        redisOk ? 1 : 0,
        freeradiusOk ? 1 : 0,
        workerOk ? 1 : 0,
        JSON.stringify(snap.docker),
        JSON.stringify({ hostname: os.hostname(), app_timezone: config.appTimezone }),
      ]
    );
  }
  return snap;
}

export async function getServerHealthSnapshot(pool: Pool, tenantId: string): Promise<ServerHealthSnapshot | null> {
  if (!(await hasTable(pool, "server_health_snapshots"))) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM server_health_snapshots WHERE tenant_id = ? LIMIT 1`,
    [tenantId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  let docker: { name: string; state: string }[] = [];
  try {
    docker = JSON.parse(String(r.docker_json ?? "[]"));
  } catch {
    docker = [];
  }
  return {
    health_status: String(r.health_status) as ServerHealthSnapshot["health_status"],
    cpu_load_1m: r.cpu_load_1m != null ? Number(r.cpu_load_1m) : null,
    cpu_count: r.cpu_count != null ? Number(r.cpu_count) : null,
    ram_percent: r.ram_percent != null ? Number(r.ram_percent) : null,
    disk_percent: r.disk_percent != null ? Number(r.disk_percent) : null,
    uptime_seconds: r.uptime_seconds != null ? Number(r.uptime_seconds) : null,
    mysql_ok: r.mysql_ok != null ? Boolean(r.mysql_ok) : null,
    redis_ok: r.redis_ok != null ? Boolean(r.redis_ok) : null,
    freeradius_ok: r.freeradius_ok != null ? Boolean(r.freeradius_ok) : null,
    worker_ok: r.worker_ok != null ? Boolean(r.worker_ok) : null,
    docker,
    last_sync_at: r.last_sync_at ? new Date(r.last_sync_at as string).toISOString() : null,
    last_sync_error: r.last_sync_error != null ? String(r.last_sync_error) : null,
  };
}
