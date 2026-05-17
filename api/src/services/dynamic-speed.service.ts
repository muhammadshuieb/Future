import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { hasTable } from "../db/schemaGuards.js";
import { config } from "../config.js";
import { resolveAppTimezone } from "./system-settings.service.js";
import { CoaService } from "./coa.service.js";
import { enqueueCoaDisconnect } from "./task-queue.service.js";

export type SpeedScheduleInput = {
  package_id: string;
  name: string;
  rate_limit: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  active?: boolean;
  priority?: number;
  disconnect_fallback?: boolean;
};

type PackageTarget = {
  source: "packages";
  packageId: string;
  baseRate: string | null;
  effectiveRate: string | null;
  scheduleId: string | null;
  disconnectFallback: boolean;
};

function normalizeTime(raw: string): string {
  const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) throw new Error("invalid_time");
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    throw new Error("invalid_time");
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}

function normalizeDays(days: number[]): string {
  const uniq = Array.from(
    new Set(days.map((d) => Math.floor(Number(d))).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
  ).sort((a, b) => a - b);
  if (uniq.length === 0) throw new Error("invalid_days");
  return uniq.join(",");
}

function parseDays(raw: unknown): number[] {
  return String(raw ?? "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6);
}

function timeToMinutes(raw: string): number {
  const [h, m] = raw.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function zonedNowParts(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return {
    day: weekdayMap[get("weekday")] ?? now.getDay(),
    minutes: Math.max(0, Math.min(23, hour)) * 60 + Math.max(0, Math.min(59, minute)),
  };
}

function scheduleMatchesNow(row: RowDataPacket, now: Date, timeZone: string): boolean {
  const days = new Set(parseDays(row.days_of_week));
  const zoned = zonedNowParts(now, timeZone);
  const minute = zoned.minutes;
  const start = timeToMinutes(String(row.start_time ?? "00:00"));
  const end = timeToMinutes(String(row.end_time ?? "00:00"));
  const today = zoned.day;
  const yesterday = (today + 6) % 7;
  if (start === end) return days.has(today);
  if (start < end) return days.has(today) && minute >= start && minute < end;
  return (days.has(today) && minute >= start) || (days.has(yesterday) && minute < end);
}

export async function ensureDynamicSpeedTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS package_speed_schedules (
      id CHAR(36) NOT NULL PRIMARY KEY,
      tenant_id CHAR(36) NOT NULL,
      package_id VARCHAR(64) NOT NULL,
      name VARCHAR(128) NOT NULL,
      rate_limit VARCHAR(64) NOT NULL,
      days_of_week VARCHAR(32) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      priority INT NOT NULL DEFAULT 100,
      active TINYINT(1) NOT NULL DEFAULT 1,
      disconnect_fallback TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_pss_tenant_package_active (tenant_id, package_id, active),
      KEY idx_pss_active_priority (active, priority)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dynamic_speed_state (
      tenant_id CHAR(36) NOT NULL,
      package_source VARCHAR(24) NOT NULL,
      package_id VARCHAR(64) NOT NULL,
      effective_rate VARCHAR(64) DEFAULT NULL,
      schedule_id CHAR(36) DEFAULT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, package_source, package_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function listSpeedSchedules(pool: Pool, tenantId: string): Promise<RowDataPacket[]> {
  await ensureDynamicSpeedTables(pool);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, package_id, name, rate_limit, days_of_week, start_time, end_time,
            priority, active, disconnect_fallback, created_at, updated_at
     FROM package_speed_schedules
     WHERE tenant_id = ?
     ORDER BY package_id, priority ASC, start_time ASC`,
    [tenantId]
  );
  return rows.map((row) => ({ ...row, days_of_week: parseDays(row.days_of_week) }));
}

export async function createSpeedSchedule(pool: Pool, tenantId: string, input: SpeedScheduleInput): Promise<string> {
  await ensureDynamicSpeedTables(pool);
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO package_speed_schedules
       (id, tenant_id, package_id, name, rate_limit, days_of_week, start_time, end_time, priority, active, disconnect_fallback)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      tenantId,
      input.package_id,
      input.name,
      input.rate_limit,
      normalizeDays(input.days_of_week),
      normalizeTime(input.start_time),
      normalizeTime(input.end_time),
      Math.floor(Number(input.priority ?? 100)),
      input.active === false ? 0 : 1,
      input.disconnect_fallback === false ? 0 : 1,
    ]
  );
  return id;
}

export async function updateSpeedSchedule(
  pool: Pool,
  tenantId: string,
  id: string,
  patch: Partial<SpeedScheduleInput>
): Promise<boolean> {
  await ensureDynamicSpeedTables(pool);
  const sets: string[] = [];
  const vals: Array<string | number> = [];
  const set = (column: string, value: string | number) => {
    sets.push(`${column} = ?`);
    vals.push(value);
  };
  if (patch.package_id !== undefined) set("package_id", patch.package_id);
  if (patch.name !== undefined) set("name", patch.name);
  if (patch.rate_limit !== undefined) set("rate_limit", patch.rate_limit);
  if (patch.days_of_week !== undefined) set("days_of_week", normalizeDays(patch.days_of_week));
  if (patch.start_time !== undefined) set("start_time", normalizeTime(patch.start_time));
  if (patch.end_time !== undefined) set("end_time", normalizeTime(patch.end_time));
  if (patch.priority !== undefined) set("priority", Math.floor(Number(patch.priority)));
  if (patch.active !== undefined) set("active", patch.active ? 1 : 0);
  if (patch.disconnect_fallback !== undefined) set("disconnect_fallback", patch.disconnect_fallback ? 1 : 0);
  if (sets.length === 0) return true;
  const [result] = await pool.execute(
    `UPDATE package_speed_schedules SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
    [...vals, id, tenantId]
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

export async function deleteSpeedSchedule(pool: Pool, tenantId: string, id: string): Promise<boolean> {
  await ensureDynamicSpeedTables(pool);
  const [result] = await pool.execute(`DELETE FROM package_speed_schedules WHERE id = ? AND tenant_id = ?`, [
    id,
    tenantId,
  ]);
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

async function getPackageTargets(pool: Pool, tenantId: string, now: Date): Promise<PackageTarget[]> {
  const timeZone = await resolveAppTimezone(tenantId);
  const [schedules] = await pool.query<RowDataPacket[]>(
    `SELECT id, package_id, rate_limit, days_of_week, start_time, end_time, priority, disconnect_fallback
     FROM package_speed_schedules
     WHERE tenant_id = ? AND active = 1
     ORDER BY priority ASC, updated_at DESC`,
    [tenantId]
  );
  const activeByPackage = new Map<string, RowDataPacket>();
  for (const row of schedules) {
    const packageId = String(row.package_id ?? "");
    if (!packageId || activeByPackage.has(packageId)) continue;
    if (scheduleMatchesNow(row, now, timeZone)) activeByPackage.set(packageId, row);
  }

  if (await hasTable(pool, "packages")) {
    const [packages] = await pool.query<RowDataPacket[]>(
      `SELECT id, mikrotik_rate_limit FROM packages WHERE tenant_id = ? AND active = 1`,
      [tenantId]
    );
    return packages.map((p) => {
      const packageId = String(p.id);
      const schedule = activeByPackage.get(packageId) ?? null;
      return {
        source: "packages" as const,
        packageId,
        baseRate: p.mikrotik_rate_limit != null ? String(p.mikrotik_rate_limit) : null,
        effectiveRate: schedule ? String(schedule.rate_limit) : p.mikrotik_rate_limit != null ? String(p.mikrotik_rate_limit) : null,
        scheduleId: schedule ? String(schedule.id) : null,
        disconnectFallback: schedule ? Number(schedule.disconnect_fallback ?? 1) === 1 : true,
      };
    });
  }

  return [];
}

async function getPackageUsernames(pool: Pool, tenantId: string, target: PackageTarget): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT username FROM subscribers
     WHERE tenant_id = ? AND package_id = ? AND LOWER(TRIM(COALESCE(status, ''))) = 'active'`,
    [tenantId, target.packageId]
  );
  return rows.map((r) => String(r.username ?? "")).filter(Boolean);
}

async function setUserRate(pool: Pool, username: string, rate: string | null): Promise<void> {
  await pool.execute(`DELETE FROM radreply WHERE username = ? AND attribute = 'Mikrotik-Rate-Limit'`, [username]);
  if (rate) {
    await pool.execute(
      `INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
      [username, rate]
    );
  }
}

async function applyCoaRateToOpenSessions(
  pool: Pool,
  coa: CoaService,
  tenantId: string,
  username: string,
  rate: string,
  disconnectFallback: boolean
): Promise<void> {
  if (!(await hasTable(pool, "radacct"))) return;
  const [sessions] = await pool.query<RowDataPacket[]>(
    `SELECT nasipaddress, acctsessionid, framedipaddress
     FROM radacct
     WHERE username = ? AND acctstoptime IS NULL`,
    [username]
  );
  await Promise.all(
    sessions.map(async (s) => {
      const nasIp = String(s.nasipaddress ?? "");
      if (!nasIp) return;
      const acctSessionId = s.acctsessionid != null ? String(s.acctsessionid) : undefined;
      const framedIp = s.framedipaddress != null ? String(s.framedipaddress) : undefined;
      const result = await coa.updateSessionRateForTenant(username, nasIp, tenantId, rate, acctSessionId, framedIp);
      if (!result.ok && disconnectFallback) {
        await enqueueCoaDisconnect({ tenantId, username, nasIp, acctSessionId, framedIp }).catch(() => null);
      }
    })
  );
}

/** BullMQ / cron: apply package-window Mikrotik-Rate-Limit for every tenant. */
export async function runPackageDynamicSpeedApplyAllTenants(pool: Pool): Promise<void> {
  if (await hasTable(pool, "tenants")) {
    const [tenants] = await pool.query<RowDataPacket[]>(`SELECT id FROM tenants`);
    for (const t of tenants) {
      const id = String(t.id ?? "").trim();
      if (id) await applyDueDynamicSpeeds(pool, id);
    }
    return;
  }
  await applyDueDynamicSpeeds(pool);
}

export async function applyDueDynamicSpeeds(pool: Pool, tenantId = config.defaultTenantId): Promise<{
  changedPackages: number;
  touchedUsers: number;
}> {
  await ensureDynamicSpeedTables(pool);
  if (!(await hasTable(pool, "radreply"))) return { changedPackages: 0, touchedUsers: 0 };
  const now = new Date();
  const targets = await getPackageTargets(pool, tenantId, now);
  const coa = new CoaService(pool);
  let changedPackages = 0;
  let touchedUsers = 0;

  for (const target of targets) {
    const effective = target.effectiveRate ?? "";
    const [stateRows] = await pool.query<RowDataPacket[]>(
      `SELECT effective_rate, schedule_id FROM dynamic_speed_state
       WHERE tenant_id = ? AND package_source = ? AND package_id = ? LIMIT 1`,
      [tenantId, target.source, target.packageId]
    );
    const currentRate = stateRows[0]?.effective_rate != null ? String(stateRows[0].effective_rate) : "";
    const currentSchedule = stateRows[0]?.schedule_id != null ? String(stateRows[0].schedule_id) : "";
    if (currentRate === effective && currentSchedule === (target.scheduleId ?? "")) continue;

    const usernames = await getPackageUsernames(pool, tenantId, target);
    for (const username of usernames) {
      await setUserRate(pool, username, target.effectiveRate);
      if (target.effectiveRate) {
        await applyCoaRateToOpenSessions(
          pool,
          coa,
          tenantId,
          username,
          target.effectiveRate,
          target.disconnectFallback
        );
      }
      touchedUsers++;
    }
    await pool.execute(
      `INSERT INTO dynamic_speed_state (tenant_id, package_source, package_id, effective_rate, schedule_id, applied_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE effective_rate = VALUES(effective_rate),
                               schedule_id = VALUES(schedule_id),
                               applied_at = NOW()`,
      [tenantId, target.source, target.packageId, target.effectiveRate, target.scheduleId]
    );
    changedPackages++;
  }
  return { changedPackages, touchedUsers };
}
