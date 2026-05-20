import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { hasTable } from "../db/schemaGuards.js";
import { buildMikrotikRateLimitFromParts, computeMikrotikForProfileInput } from "../lib/mikrotik-rate-limit-build.js";
import { RadiusService } from "./radius.service.js";
import { CoaService } from "./coa.service.js";
import { enqueueCoaDisconnect } from "./task-queue.service.js";
import { getSystemSettings } from "./system-settings.service.js";
import { sendOperationalAlertWhatsApp } from "./whatsapp.service.js";

export type SpeedProfileRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  name: string;
  download_rate: string;
  upload_rate: string;
  burst_download_rate: string | null;
  burst_upload_rate: string | null;
  burst_threshold_download: string | null;
  burst_threshold_upload: string | null;
  burst_time: string | null;
  priority: number;
  mikrotik_rate_limit_value: string;
  is_default: number;
  is_active: number;
};

export type EffectiveSpeedResult = {
  profileId: string | null;
  mikrotikValue: string | null;
  source:
    | "manual_override"
    | "schedule_subscriber"
    | "schedule_package"
    | "schedule_branch"
    | "schedule_tenant"
    | "package"
    | "system_default"
    | "none";
  scheduleId: string | null;
};

const SCHED_TIER: Record<string, number> = {
  subscriber: 5,
  package: 4,
  branch: 3,
  tenant: 2,
};

function tierRank(targetType: string): number {
  return SCHED_TIER[targetType] ?? 0;
}

export { computeMikrotikForProfileInput } from "../lib/mikrotik-rate-limit-build.js";

export async function speedProfilesSchemaReady(pool: Pool): Promise<boolean> {
  return (
    (await hasTable(pool, "speed_profiles")) &&
    (await hasTable(pool, "speed_profile_schedules")) &&
    (await hasTable(pool, "subscriber_speed_overrides")) &&
    (await hasTable(pool, "speed_profile_change_logs"))
  );
}

function parseDaysOfWeek(raw: unknown): number[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const out = raw
      .map((v) => Math.floor(Number(v)))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    return out.length ? out : null;
  }
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw) as unknown;
      return parseDaysOfWeek(j);
    } catch {
      return null;
    }
  }
  return null;
}

function timeToMinutes(raw: string): number {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return Math.max(0, Math.min(23, h)) * 60 + Math.max(0, Math.min(59, min));
}

function zonedNowParts(now: Date, timeZone: string): { day: number; minutes: number; dom: number } {
  const tz = timeZone?.trim() || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      day: "2-digit",
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
    const dom = Number(get("day"));
    return {
      day: weekdayMap[get("weekday")] ?? now.getUTCDay(),
      minutes: Math.max(0, Math.min(23, hour)) * 60 + Math.max(0, Math.min(59, minute)),
      dom: Number.isFinite(dom) ? dom : now.getUTCDate(),
    };
  } catch {
    return {
      day: now.getUTCDay(),
      minutes: now.getUTCHours() * 60 + now.getUTCMinutes(),
      dom: now.getUTCDate(),
    };
  }
}

function timeWindowMatches(
  timeStart: string | null,
  timeEnd: string | null,
  zoned: { day: number; minutes: number }
): boolean {
  if (!timeStart || !timeEnd) return true;
  const start = timeToMinutes(String(timeStart));
  const end = timeToMinutes(String(timeEnd));
  const minute = zoned.minutes;
  const today = zoned.day;
  const yesterday = (today + 6) % 7;
  if (start === end) return true;
  if (start < end) return minute >= start && minute < end;
  return (minute >= start) || (minute < end);
}

function repeatMatches(
  row: RowDataPacket,
  now: Date,
  zoned: { day: number; minutes: number; dom: number }
): boolean {
  const mode = String(row.repeat_mode ?? "daily").toLowerCase();
  const startsAt = row.starts_at ? new Date(row.starts_at as string) : null;
  const endsAt = row.ends_at ? new Date(row.ends_at as string) : null;
  if (startsAt && now < startsAt) return false;
  if (endsAt && now >= endsAt) return false;

  const days = parseDaysOfWeek(row.days_of_week);
  if (days && days.length > 0 && !days.includes(zoned.day)) return false;

  if (!timeWindowMatches(row.time_start as string | null, row.time_end as string | null, zoned)) {
    return false;
  }

  if (mode === "once") {
    return true;
  }
  if (mode === "monthly") {
    const anchor = startsAt ?? now;
    const anchorDom = anchor.getUTCDate();
    return zoned.dom === anchorDom;
  }
  return true;
}

async function subscriberInDebt(pool: Pool, tenantId: string, subscriberId: string): Promise<boolean> {
  if (!(await hasTable(pool, "invoices"))) return false;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM invoices
     WHERE tenant_id = ? AND subscriber_id = ?
       AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('paid', 'cancelled', 'void')
       AND due_date < CURDATE()
     LIMIT 1`,
    [tenantId, subscriberId]
  );
  return Boolean(rows[0]);
}

async function subscriberOverQuota(pool: Pool, tenantId: string, subscriberId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.used_bytes AS used, p.quota_total_bytes AS quota
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id
     WHERE s.id = ? AND s.tenant_id = ?
     LIMIT 1`,
    [subscriberId, tenantId]
  );
  const r = rows[0];
  if (!r) return false;
  const quota = Number(r.quota ?? 0);
  if (!Number.isFinite(quota) || quota <= 0) return false;
  const used = Number(r.used ?? 0);
  return used >= quota;
}

function scheduleConditionOk(
  row: RowDataPacket,
  ctx: { inDebt: boolean; overQuota: boolean }
): boolean {
  const c = String(row.condition_type ?? "always").toLowerCase();
  if (c === "always" || c === "off_peak" || c === "custom") return true;
  if (c === "debt_status") return ctx.inDebt;
  if (c === "quota_status") return ctx.overQuota;
  return true;
}

function scheduleProfileIdForRow(row: RowDataPacket, ctx: { inDebt: boolean; overQuota: boolean }): string | null {
  const condOk = scheduleConditionOk(row, ctx);
  const primary = String(row.speed_profile_id ?? "");
  const fallback = row.fallback_speed_profile_id != null ? String(row.fallback_speed_profile_id) : "";
  if (condOk) return primary || null;
  if (fallback) return fallback;
  return null;
}

async function loadProfileMap(
  pool: Pool,
  tenantId: string,
  ids: string[]
): Promise<Map<string, SpeedProfileRow>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, SpeedProfileRow>();
  if (uniq.length === 0) return map;
  const ph = uniq.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, branch_id, name, download_rate, upload_rate,
            burst_download_rate, burst_upload_rate, burst_threshold_download, burst_threshold_upload,
            burst_time, priority, mikrotik_rate_limit_value, is_default, is_active
     FROM speed_profiles
     WHERE tenant_id = ? AND id IN (${ph}) AND is_active = 1`,
    [tenantId, ...uniq]
  );
  for (const r of rows) {
    map.set(String(r.id), r as unknown as SpeedProfileRow);
  }
  return map;
}

async function getSystemDefaultProfile(
  pool: Pool,
  tenantId: string
): Promise<SpeedProfileRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, branch_id, name, download_rate, upload_rate,
            burst_download_rate, burst_upload_rate, burst_threshold_download, burst_threshold_upload,
            burst_time, priority, mikrotik_rate_limit_value, is_default, is_active
     FROM speed_profiles
     WHERE tenant_id = ? AND is_default = 1 AND is_active = 1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [tenantId]
  );
  return rows[0] ? (rows[0] as unknown as SpeedProfileRow) : null;
}

export async function listSpeedProfiles(pool: Pool, tenantId: string): Promise<RowDataPacket[]> {
  if (!(await speedProfilesSchemaReady(pool))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM speed_profiles WHERE tenant_id = ? ORDER BY name ASC`,
    [tenantId]
  );
  return rows;
}

export async function createSpeedProfile(
  pool: Pool,
  tenantId: string,
  input: {
    name: string;
    branch_id?: string | null;
    download_rate: string;
    upload_rate: string;
    burst_download_rate?: string | null;
    burst_upload_rate?: string | null;
    burst_threshold_download?: string | null;
    burst_threshold_upload?: string | null;
    burst_time?: string | null;
    priority?: number;
    is_default?: boolean;
    is_active?: boolean;
  }
): Promise<string> {
  const id = randomUUID();
  const mik = computeMikrotikForProfileInput({
    download_rate: input.download_rate,
    upload_rate: input.upload_rate,
    burst_download_rate: input.burst_download_rate,
    burst_upload_rate: input.burst_upload_rate,
    burst_threshold_download: input.burst_threshold_download,
    burst_threshold_upload: input.burst_threshold_upload,
    burst_time: input.burst_time,
    priority: input.priority ?? 8,
  });
  if (input.is_default) {
    await pool.execute(`UPDATE speed_profiles SET is_default = 0 WHERE tenant_id = ?`, [tenantId]);
  }
  await pool.execute(
    `INSERT INTO speed_profiles
      (id, tenant_id, branch_id, name, download_rate, upload_rate,
       burst_download_rate, burst_upload_rate, burst_threshold_download, burst_threshold_upload,
       burst_time, priority, mikrotik_rate_limit_value, is_default, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      tenantId,
      input.branch_id ?? null,
      input.name,
      input.download_rate,
      input.upload_rate,
      input.burst_download_rate ?? null,
      input.burst_upload_rate ?? null,
      input.burst_threshold_download ?? null,
      input.burst_threshold_upload ?? null,
      input.burst_time ?? null,
      Math.floor(Number(input.priority ?? 8)),
      mik,
      input.is_default ? 1 : 0,
      input.is_active === false ? 0 : 1,
    ]
  );
  return id;
}

export async function updateSpeedProfile(
  pool: Pool,
  tenantId: string,
  id: string,
  patch: Partial<{
    name: string;
    branch_id: string | null;
    download_rate: string;
    upload_rate: string;
    burst_download_rate: string | null;
    burst_upload_rate: string | null;
    burst_threshold_download: string | null;
    burst_threshold_upload: string | null;
    burst_time: string | null;
    priority: number;
    is_default: boolean;
    is_active: boolean;
  }>
): Promise<boolean> {
  const [cur] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM speed_profiles WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, tenantId]
  );
  if (!cur[0]) return false;
  const row = cur[0];
  if (patch.is_default) {
    await pool.execute(`UPDATE speed_profiles SET is_default = 0 WHERE tenant_id = ?`, [tenantId]);
  }
  const next = {
    download_rate: patch.download_rate ?? String(row.download_rate),
    upload_rate: patch.upload_rate ?? String(row.upload_rate),
    burst_download_rate: patch.burst_download_rate !== undefined ? patch.burst_download_rate : row.burst_download_rate,
    burst_upload_rate: patch.burst_upload_rate !== undefined ? patch.burst_upload_rate : row.burst_upload_rate,
    burst_threshold_download:
      patch.burst_threshold_download !== undefined ? patch.burst_threshold_download : row.burst_threshold_download,
    burst_threshold_upload:
      patch.burst_threshold_upload !== undefined ? patch.burst_threshold_upload : row.burst_threshold_upload,
    burst_time: patch.burst_time !== undefined ? patch.burst_time : row.burst_time,
    priority: patch.priority !== undefined ? Math.floor(Number(patch.priority)) : Number(row.priority ?? 8),
  };
  const mik = computeMikrotikForProfileInput(next);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (k: string, v: unknown) => {
    sets.push(`${k} = ?`);
    vals.push(v);
  };
  if (patch.name !== undefined) set("name", patch.name);
  if (patch.branch_id !== undefined) set("branch_id", patch.branch_id);
  if (Object.keys(patch).some((k) => k !== "name" && k !== "branch_id" && k !== "is_default" && k !== "is_active")) {
    set("download_rate", next.download_rate);
    set("upload_rate", next.upload_rate);
    set("burst_download_rate", next.burst_download_rate);
    set("burst_upload_rate", next.burst_upload_rate);
    set("burst_threshold_download", next.burst_threshold_download);
    set("burst_threshold_upload", next.burst_threshold_upload);
    set("burst_time", next.burst_time);
    set("priority", next.priority);
    set("mikrotik_rate_limit_value", mik);
  }
  if (patch.is_default !== undefined) set("is_default", patch.is_default ? 1 : 0);
  if (patch.is_active !== undefined) set("is_active", patch.is_active ? 1 : 0);
  if (sets.length === 0) return true;
  const [res] = await pool.execute(
    `UPDATE speed_profiles SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
    [...vals, id, tenantId] as never
  );
  return Number((res as ResultSetHeader).affectedRows ?? 0) > 0;
}

export async function deleteSpeedProfile(pool: Pool, tenantId: string, id: string): Promise<boolean> {
  const [dep] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM speed_profile_schedules WHERE tenant_id = ? AND (speed_profile_id = ? OR fallback_speed_profile_id = ?) LIMIT 1`,
    [tenantId, id, id]
  );
  if (dep[0]) throw new Error("profile_in_use");
  const [dep2] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM subscriber_speed_overrides WHERE tenant_id = ? AND speed_profile_id = ? LIMIT 1`,
    [tenantId, id]
  );
  if (dep2[0]) throw new Error("profile_in_use");
  const [res] = await pool.execute(`DELETE FROM speed_profiles WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  return Number((res as ResultSetHeader).affectedRows ?? 0) > 0;
}

export async function listSpeedSchedules(pool: Pool, tenantId: string): Promise<RowDataPacket[]> {
  if (!(await speedProfilesSchemaReady(pool))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM speed_profile_schedules WHERE tenant_id = ? ORDER BY priority DESC, created_at DESC`,
    [tenantId]
  );
  return rows;
}

export async function createSpeedSchedule(
  pool: Pool,
  tenantId: string,
  input: Record<string, unknown>,
  createdBy: string | null
): Promise<string> {
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO speed_profile_schedules
      (id, tenant_id, branch_id, name, target_type, target_id, speed_profile_id, fallback_speed_profile_id,
       starts_at, ends_at, days_of_week, time_start, time_end, timezone, priority, repeat_mode, condition_type,
       is_active, coa_disconnect_on_rate_fail, notify_subscriber_whatsapp, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      tenantId,
      input.branch_id ?? null,
      input.name,
      input.target_type,
      input.target_id ?? null,
      input.speed_profile_id,
      input.fallback_speed_profile_id ?? null,
      input.starts_at ?? null,
      input.ends_at ?? null,
      input.days_of_week != null ? JSON.stringify(input.days_of_week) : null,
      input.time_start ?? null,
      input.time_end ?? null,
      String(input.timezone ?? "UTC"),
      Math.floor(Number(input.priority ?? 100)),
      String(input.repeat_mode ?? "daily"),
      String(input.condition_type ?? "always"),
      input.is_active === false ? 0 : 1,
      input.coa_disconnect_on_rate_fail === false ? 0 : 1,
      input.notify_subscriber_whatsapp ? 1 : 0,
      createdBy,
    ] as never
  );
  return id;
}

export async function updateSpeedSchedule(
  pool: Pool,
  tenantId: string,
  scheduleId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (k: string, v: unknown) => {
    sets.push(`${k} = ?`);
    vals.push(v);
  };
  const map: Record<string, unknown> = { ...patch };
  if ("days_of_week" in map) {
    set("days_of_week", map.days_of_week != null ? JSON.stringify(map.days_of_week) : null);
    delete map.days_of_week;
  }
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    if (k === "is_active") set(k, v ? 1 : 0);
    else if (k === "coa_disconnect_on_rate_fail") set(k, v ? 1 : 0);
    else if (k === "notify_subscriber_whatsapp") set(k, v ? 1 : 0);
    else if (k === "priority") set(k, Math.floor(Number(v)));
    else set(k, v);
  }
  if (sets.length === 0) return true;
  const [res] = await pool.execute(
    `UPDATE speed_profile_schedules SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
    [...vals, scheduleId, tenantId] as never
  );
  return Number((res as ResultSetHeader).affectedRows ?? 0) > 0;
}

export async function deleteSpeedSchedule(pool: Pool, tenantId: string, scheduleId: string): Promise<boolean> {
  const [res] = await pool.execute(`DELETE FROM speed_profile_schedules WHERE id = ? AND tenant_id = ?`, [
    scheduleId,
    tenantId,
  ]);
  return Number((res as ResultSetHeader).affectedRows ?? 0) > 0;
}

async function fetchSchedulesForTenant(pool: Pool, tenantId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM speed_profile_schedules WHERE tenant_id = ? AND is_active = 1`,
    [tenantId]
  );
  return rows;
}

function scheduleTargetsSubscriber(row: RowDataPacket, sub: RowDataPacket): boolean {
  const tt = String(row.target_type ?? "").toLowerCase();
  const tid = row.target_id != null ? String(row.target_id) : "";
  if (tt === "subscriber") return tid === String(sub.id);
  if (tt === "package") return tid === String(sub.package_id ?? "");
  if (tt === "tenant") return !tid || tid === String(sub.tenant_id);
  return false;
}

function scheduleTargetsBranch(row: RowDataPacket, sub: RowDataPacket): boolean {
  const tt = String(row.target_type ?? "").toLowerCase();
  const tid = row.target_id != null ? String(row.target_id) : "";
  if (tt !== "branch") return false;
  const branchId = sub.branch_id != null ? String(sub.branch_id) : "";
  return Boolean(branchId && tid === branchId);
}

function pickWinningSchedule(
  candidates: Array<{ row: RowDataPacket; profileId: string | null }>
): { row: RowDataPacket; profileId: string | null } | null {
  const valid = candidates.filter((c) => c.profileId);
  if (valid.length === 0) return null;
  valid.sort((a, b) => {
    const ta = tierRank(String(a.row.target_type));
    const tb = tierRank(String(b.row.target_type));
    if (ta !== tb) return tb - ta;
    const pa = Number(a.row.priority ?? 0);
    const pb = Number(b.row.priority ?? 0);
    if (pa !== pb) return pb - pa;
    const ca = new Date(String(a.row.created_at ?? 0)).getTime();
    const cb = new Date(String(b.row.created_at ?? 0)).getTime();
    return cb - ca;
  });
  return valid[0] ?? null;
}

export async function resolveEffectiveSpeedProfile(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  now = new Date()
): Promise<EffectiveSpeedResult> {
  if (!(await speedProfilesSchemaReady(pool))) {
    return { profileId: null, mikrotikValue: null, source: "none", scheduleId: null };
  }

  const [subs] = await pool.query<RowDataPacket[]>(
    `SELECT s.*, p.mikrotik_rate_limit AS pkg_mikrotik, c.branch_id
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     LEFT JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
     WHERE s.id = ? AND s.tenant_id = ?
     LIMIT 1`,
    [subscriberId, tenantId]
  );
  const sub = subs[0];
  if (!sub) {
    return { profileId: null, mikrotikValue: null, source: "none", scheduleId: null };
  }

  const inDebt = await subscriberInDebt(pool, tenantId, subscriberId);
  const overQuota = await subscriberOverQuota(pool, tenantId, subscriberId);
  const ctx = { inDebt, overQuota };

  const [ovRows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM subscriber_speed_overrides
     WHERE tenant_id = ? AND subscriber_id = ? AND is_active = 1
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at > NOW())
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, subscriberId]
  );
  if (ovRows[0]) {
    const pid = String(ovRows[0].speed_profile_id ?? "");
    const pmap = await loadProfileMap(pool, tenantId, [pid]);
    const pr = pmap.get(pid);
    if (pr) {
      return {
        profileId: pr.id,
        mikrotikValue: pr.mikrotik_rate_limit_value,
        source: "manual_override",
        scheduleId: null,
      };
    }
  }

  const schedules = await fetchSchedulesForTenant(pool, tenantId);
  const candidates: Array<{ row: RowDataPacket; profileId: string | null }> = [];
  for (const row of schedules) {
    const tz = String(row.timezone ?? "UTC");
    const zoned = zonedNowParts(now, tz);
    if (!repeatMatches(row, now, zoned)) continue;
    const direct = scheduleTargetsSubscriber(row, sub);
    const branch = scheduleTargetsBranch(row, sub);
    if (!direct && !branch) continue;
    const profileId = scheduleProfileIdForRow(row, ctx);
    candidates.push({ row, profileId });
  }

  const winner = pickWinningSchedule(candidates);
  if (winner?.profileId) {
    const pmap = await loadProfileMap(pool, tenantId, [winner.profileId]);
    const pr = pmap.get(winner.profileId);
    if (pr) {
      const tt = String(winner.row.target_type ?? "").toLowerCase();
      const src =
        tt === "subscriber"
          ? "schedule_subscriber"
          : tt === "package"
            ? "schedule_package"
            : tt === "branch"
              ? "schedule_branch"
              : "schedule_tenant";
      return {
        profileId: pr.id,
        mikrotikValue: pr.mikrotik_rate_limit_value,
        source: src,
        scheduleId: String(winner.row.id),
      };
    }
  }

  const pkgMik = sub.pkg_mikrotik != null ? String(sub.pkg_mikrotik).trim() : "";
  if (pkgMik) {
    return {
      profileId: null,
      mikrotikValue: pkgMik,
      source: "package",
      scheduleId: null,
    };
  }

  const def = await getSystemDefaultProfile(pool, tenantId);
  if (def) {
    return {
      profileId: def.id,
      mikrotikValue: def.mikrotik_rate_limit_value,
      source: "system_default",
      scheduleId: null,
    };
  }

  return { profileId: null, mikrotikValue: null, source: "none", scheduleId: null };
}

export async function readRadreplyRate(pool: Pool, username: string): Promise<string | null> {
  if (!(await hasTable(pool, "radreply"))) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT value FROM radreply WHERE username = ? AND attribute = 'Mikrotik-Rate-Limit' LIMIT 1`,
    [username]
  );
  const v = rows[0]?.value;
  return v != null ? String(v) : null;
}

async function insertChangeLog(
  pool: Pool,
  row: {
    tenantId: string;
    subscriberId: string;
    oldProfileId: string | null;
    newProfileId: string | null;
    oldMik: string | null;
    newMik: string | null;
    source: string;
    scheduleId: string | null;
    status: string;
    coaOk: boolean | null;
    coaMessage: string | null;
    errorMessage: string | null;
  }
): Promise<void> {
  await pool.execute(
    `INSERT INTO speed_profile_change_logs
      (id, tenant_id, subscriber_id, old_profile_id, new_profile_id, old_mikrotik_value, new_mikrotik_value,
       source, schedule_id, status, coa_ok, coa_message, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      row.tenantId,
      row.subscriberId,
      row.oldProfileId,
      row.newProfileId,
      row.oldMik,
      row.newMik,
      row.source,
      row.scheduleId,
      row.status,
      row.coaOk == null ? null : row.coaOk ? 1 : 0,
      row.coaMessage,
      row.errorMessage,
    ]
  );
}

async function coaApplyToOnlineSessions(
  pool: Pool,
  coa: CoaService,
  tenantId: string,
  username: string,
  rate: string,
  disconnectFallback: boolean
): Promise<{ ok: boolean; message: string }> {
  if (!(await hasTable(pool, "radacct"))) return { ok: true, message: "no_radacct" };
  const [sessions] = await pool.query<RowDataPacket[]>(
    `SELECT nasipaddress, acctsessionid, framedipaddress
     FROM radacct WHERE username = ? AND acctstoptime IS NULL`,
    [username]
  );
  if (sessions.length === 0) return { ok: true, message: "offline" };
  let lastMsg = "";
  let allOk = true;
  for (const s of sessions) {
    const nasIp = String(s.nasipaddress ?? "");
    if (!nasIp) continue;
    const acctSessionId = s.acctsessionid != null ? String(s.acctsessionid) : undefined;
    const framedIp = s.framedipaddress != null ? String(s.framedipaddress) : undefined;
    const result = await coa.updateSessionRateForTenant(username, nasIp, tenantId, rate, acctSessionId, framedIp);
    lastMsg = result.message;
    if (!result.ok) {
      allOk = false;
      if (disconnectFallback) {
        await enqueueCoaDisconnect({ tenantId, username, nasIp, acctSessionId, framedIp }).catch(() => null);
      }
    }
  }
  return { ok: allOk, message: lastMsg };
}

async function notifyAdminSpeed(
  tenantId: string,
  subject: string,
  body: string
): Promise<void> {
  try {
    const settings = await getSystemSettings(tenantId);
    if (!settings.critical_alert_enabled) return;
    let phone = settings.critical_alert_phone || "";
    if (settings.critical_alert_use_session_owner) {
      const { resolveWhatsAppSessionOwnerPhone } = await import("./whatsapp.service.js");
      const owner = await resolveWhatsAppSessionOwnerPhone(tenantId).catch(() => null);
      if (owner) phone = owner;
    }
    if (!phone) return;
    await sendOperationalAlertWhatsApp(tenantId, phone, `${subject}\n${body}`, { preferSessionOwner: false });
  } catch {
    /* optional */
  }
}

export async function applySpeedProfileToSubscriber(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  profileId: string,
  opts: { staffId: string | null; source: string; scheduleId?: string | null }
): Promise<{ ok: boolean }> {
  const pmap = await loadProfileMap(pool, tenantId, [profileId]);
  const pr = pmap.get(profileId);
  if (!pr) return { ok: false };

  const [subs] = await pool.query<RowDataPacket[]>(
    `SELECT username FROM subscribers WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [subscriberId, tenantId]
  );
  const username = String(subs[0]?.username ?? "");
  if (!username) return { ok: false };

  const oldRate = await readRadreplyRate(pool, username);
  const radius = new RadiusService(pool);
  await radius.updateUserSpeed(username, pr.mikrotik_rate_limit_value);

  const coa = new CoaService(pool);
  const coaRes = await coaApplyToOnlineSessions(pool, coa, tenantId, username, pr.mikrotik_rate_limit_value, true);
  if (!coaRes.ok) {
    await notifyAdminSpeed(tenantId, "فشل CoA للسرعة", `المستخدم: ${username}\n${coaRes.message}`);
  }

  await insertChangeLog(pool, {
    tenantId,
    subscriberId,
    oldProfileId: null,
    newProfileId: profileId,
    oldMik: oldRate,
    newMik: pr.mikrotik_rate_limit_value,
    source: opts.source,
    scheduleId: opts.scheduleId ?? null,
    status: "applied",
    coaOk: coaRes.ok,
    coaMessage: coaRes.message,
    errorMessage: coaRes.ok ? null : coaRes.message,
  });
  return { ok: true };
}

export async function syncSpeedToRadius(
  pool: Pool,
  username: string,
  mikrotikValue: string
): Promise<void> {
  const radius = new RadiusService(pool);
  await radius.updateUserSpeed(username, mikrotikValue);
}

export async function syncSpeedToMikroTikCoA(
  pool: Pool,
  tenantId: string,
  username: string,
  mikrotikValue: string,
  disconnectFallback: boolean
): Promise<{ ok: boolean; message: string }> {
  const coa = new CoaService(pool);
  return coaApplyToOnlineSessions(pool, coa, tenantId, username, mikrotikValue, disconnectFallback);
}

async function collectSubscriberIdsToEvaluate(pool: Pool, tenantId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT s.id
     FROM subscribers s
     LEFT JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
     WHERE s.tenant_id = ? AND LOWER(TRIM(COALESCE(s.status, ''))) = 'active'
       AND (
         EXISTS (
           SELECT 1 FROM subscriber_speed_overrides o
           WHERE o.subscriber_id = s.id AND o.tenant_id = s.tenant_id
             AND o.is_active = 1 AND (o.ends_at IS NULL OR o.ends_at > NOW())
         )
         OR EXISTS (
           SELECT 1 FROM speed_profile_schedules sch
           WHERE sch.tenant_id = s.tenant_id AND sch.is_active = 1
             AND (
               (sch.target_type = 'subscriber' AND sch.target_id = s.id)
               OR (sch.target_type = 'package' AND sch.target_id = s.package_id)
               OR (sch.target_type = 'tenant' AND (sch.target_id IS NULL OR sch.target_id = s.tenant_id))
               OR (sch.target_type = 'branch' AND sch.target_id = c.branch_id)
             )
         )
       )`,
    [tenantId]
  );
  return rows.map((r) => String(r.id));
}

export async function applyActiveSpeedSchedules(pool: Pool, tenantId: string): Promise<{
  checked: number;
  updated: number;
}> {
  if (!(await speedProfilesSchemaReady(pool))) return { checked: 0, updated: 0 };
  const ids = await collectSubscriberIdsToEvaluate(pool, tenantId);
  const coa = new CoaService(pool);
  let updated = 0;
  for (const subscriberId of ids) {
    const eff = await resolveEffectiveSpeedProfile(pool, tenantId, subscriberId);
    const mik = eff.mikrotikValue ?? "";
    const [subs] = await pool.query<RowDataPacket[]>(
      `SELECT username FROM subscribers WHERE id = ? LIMIT 1`,
      [subscriberId]
    );
    const username = String(subs[0]?.username ?? "");
    if (!username) continue;
    const current = (await readRadreplyRate(pool, username)) ?? "";
    if (current === mik) continue;
    const oldRate = current || null;
    await syncSpeedToRadius(pool, username, mik || "0/0");
    const coaRes = await coaApplyToOnlineSessions(pool, coa, tenantId, username, mik || "0/0", true);
    if (!coaRes.ok) {
      await notifyAdminSpeed(tenantId, "فشل CoA (جدول السرعة)", `${username}: ${coaRes.message}`);
    }
    await insertChangeLog(pool, {
      tenantId,
      subscriberId,
      oldProfileId: null,
      newProfileId: eff.profileId,
      oldMik: oldRate,
      newMik: mik || null,
      source: eff.source.startsWith("schedule") ? "schedule" : eff.source,
      scheduleId: eff.scheduleId,
      status: "applied",
      coaOk: coaRes.ok,
      coaMessage: coaRes.message,
      errorMessage: coaRes.ok ? null : coaRes.message,
    });
    updated++;
  }
  return { checked: ids.length, updated };
}

export async function revertExpiredSpeedSchedules(pool: Pool, tenantId: string): Promise<{
  deactivatedOverrides: number;
  reapplied: number;
}> {
  if (!(await speedProfilesSchemaReady(pool))) return { deactivatedOverrides: 0, reapplied: 0 };
  const [res] = await pool.execute<ResultSetHeader>(
    `UPDATE subscriber_speed_overrides
     SET is_active = 0, updated_at = CURRENT_TIMESTAMP(3)
     WHERE tenant_id = ? AND is_active = 1 AND ends_at IS NOT NULL AND ends_at <= NOW()`,
    [tenantId]
  );
  const deactivatedOverrides = Number(res.affectedRows ?? 0);
  const r = await applyActiveSpeedSchedules(pool, tenantId);
  return { deactivatedOverrides, reapplied: r.updated };
}

export async function reconcileSpeedRadreply(
  pool: Pool,
  tenantId: string,
  limit = 500
): Promise<{ fixed: number; mismatches: number }> {
  if (!(await speedProfilesSchemaReady(pool))) return { fixed: 0, mismatches: 0 };
  const ids = (await collectSubscriberIdsToEvaluate(pool, tenantId)).slice(0, limit);
  const coa = new CoaService(pool);
  let fixed = 0;
  let mismatches = 0;
  for (const subscriberId of ids) {
    const eff = await resolveEffectiveSpeedProfile(pool, tenantId, subscriberId);
    const expected = eff.mikrotikValue ?? "";
    const [subs] = await pool.query<RowDataPacket[]>(
      `SELECT username FROM subscribers WHERE id = ? LIMIT 1`,
      [subscriberId]
    );
    const username = String(subs[0]?.username ?? "");
    if (!username) continue;
    const current = (await readRadreplyRate(pool, username)) ?? "";
    if (current === expected) continue;
    mismatches++;
    await syncSpeedToRadius(pool, username, expected || "0/0");
    const coaRes = await coaApplyToOnlineSessions(pool, coa, tenantId, username, expected || "0/0", true);
    if (!coaRes.ok) {
      await notifyAdminSpeed(tenantId, "انحراف السرعة في radreply", `${username}: تصحيح تلقائي، CoA: ${coaRes.message}`);
    }
    await insertChangeLog(pool, {
      tenantId,
      subscriberId,
      oldProfileId: null,
      newProfileId: eff.profileId,
      oldMik: current || null,
      newMik: expected || null,
      source: "system",
      scheduleId: eff.scheduleId,
      status: "applied",
      coaOk: coaRes.ok,
      coaMessage: coaRes.message,
      errorMessage: null,
    });
    fixed++;
  }
  return { fixed, mismatches };
}

export async function listSpeedProfileLogs(
  pool: Pool,
  tenantId: string,
  opts: { limit?: number; subscriberId?: string | null }
): Promise<RowDataPacket[]> {
  if (!(await hasTable(pool, "speed_profile_change_logs"))) return [];
  const lim = Math.min(500, Math.max(1, opts.limit ?? 100));
  if (opts.subscriberId) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM speed_profile_change_logs
       WHERE tenant_id = ? AND subscriber_id = ?
       ORDER BY applied_at DESC
       LIMIT ${lim}`,
      [tenantId, opts.subscriberId]
    );
    return rows;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM speed_profile_change_logs
     WHERE tenant_id = ?
     ORDER BY applied_at DESC
     LIMIT ${lim}`,
    [tenantId]
  );
  return rows;
}

export async function createSubscriberOverride(
  pool: Pool,
  tenantId: string,
  subscriberId: string,
  input: {
    speed_profile_id: string;
    reason?: string | null;
    starts_at?: string | null;
    ends_at?: string | null;
    notify_subscriber_whatsapp?: boolean;
  },
  createdBy: string | null
): Promise<string> {
  await pool.execute(
    `UPDATE subscriber_speed_overrides SET is_active = 0, updated_at = CURRENT_TIMESTAMP(3)
     WHERE tenant_id = ? AND subscriber_id = ? AND is_active = 1`,
    [tenantId, subscriberId]
  );
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO subscriber_speed_overrides
      (id, tenant_id, subscriber_id, speed_profile_id, reason, starts_at, ends_at, is_active, notify_subscriber_whatsapp, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      tenantId,
      subscriberId,
      input.speed_profile_id,
      input.reason ?? null,
      input.starts_at ?? null,
      input.ends_at ?? null,
      input.notify_subscriber_whatsapp ? 1 : 0,
      createdBy,
    ]
  );
  await applySpeedProfileToSubscriber(pool, tenantId, subscriberId, input.speed_profile_id, {
    staffId: createdBy,
    source: "manual",
  });
  return id;
}

export async function deleteSubscriberOverride(pool: Pool, tenantId: string, subscriberId: string): Promise<void> {
  await pool.execute(
    `UPDATE subscriber_speed_overrides SET is_active = 0, updated_at = CURRENT_TIMESTAMP(3)
     WHERE tenant_id = ? AND subscriber_id = ?`,
    [tenantId, subscriberId]
  );
  await applyActiveSpeedSchedules(pool, tenantId);
}

export async function runSpeedProfileApplyAllTenants(pool: Pool): Promise<void> {
  if (!(await hasTable(pool, "tenants"))) return;
  const [tenants] = await pool.query<RowDataPacket[]>(`SELECT id FROM tenants`);
  for (const t of tenants) {
    await applyActiveSpeedSchedules(pool, String(t.id));
  }
}

export async function runSpeedProfileRevertAllTenants(pool: Pool): Promise<void> {
  if (!(await hasTable(pool, "tenants"))) return;
  const [tenants] = await pool.query<RowDataPacket[]>(`SELECT id FROM tenants`);
  for (const t of tenants) {
    await revertExpiredSpeedSchedules(pool, String(t.id));
  }
}

export async function runSpeedProfileReconcileAllTenants(pool: Pool): Promise<void> {
  if (!(await hasTable(pool, "tenants"))) return;
  const [tenants] = await pool.query<RowDataPacket[]>(`SELECT id FROM tenants`);
  for (const t of tenants) {
    await reconcileSpeedRadreply(pool, String(t.id), 800);
  }
}

export async function getLiveSpeedDashboard(pool: Pool, tenantId: string): Promise<{
  boosted: Array<Record<string, unknown>>;
  activeSchedules: RowDataPacket[];
  recentLogs: RowDataPacket[];
  failedCoa: RowDataPacket[];
}> {
  const boosted: Array<Record<string, unknown>> = [];
  if (await speedProfilesSchemaReady(pool)) {
    const [ovs] = await pool.query<RowDataPacket[]>(
      `SELECT o.*, s.username, p.name AS profile_name
       FROM subscriber_speed_overrides o
       JOIN subscribers s ON s.id = o.subscriber_id
       JOIN speed_profiles p ON p.id = o.speed_profile_id
       WHERE o.tenant_id = ? AND o.is_active = 1 AND (o.ends_at IS NULL OR o.ends_at > NOW())`,
      [tenantId]
    );
    for (const r of ovs) boosted.push({ ...r });
  }
  const schedules = await listSpeedSchedules(pool, tenantId);
  const now = new Date();
  const activeSchedules = schedules.filter((sch) => {
    if (!sch.is_active) return false;
    const tz = String(sch.timezone ?? "UTC");
    const z = zonedNowParts(now, tz);
    return repeatMatches(sch, now, z);
  });
  const recentLogs = await listSpeedProfileLogs(pool, tenantId, { limit: 50 });
  const failedCoa = recentLogs.filter((l) => l.coa_ok === 0);
  return { boosted, activeSchedules, recentLogs, failedCoa };
}
