import type { Pool } from "mysql2";
import { pool } from "../db/pool.js";
import { hasColumn, hasTable } from "../db/schemaGuards.js";
import { getSystemSettings } from "./system-settings.service.js";
import { pruneRadpostauth } from "./radpostauth-retention.service.js";
import { log } from "./logger.service.js";

export type RetentionSettings = {
  radacct_closed_retention_days: number;
  sessions_offline_retention_days: number;
  user_usage_daily_retention_days: number;
  radpostauth_retention_days: number;
  server_log_retention_days: number;
  whatsapp_log_retention_days: number;
  radpostauth_retention_enabled: boolean;
};

export type RetentionPruneStep = {
  table: string;
  deleted: number;
  skipped?: boolean;
  reason?: string;
};

export function clampRadacctClosedDays(days: number): number {
  return Math.max(30, Math.min(730, Math.floor(days || 180)));
}

export function clampSessionsOfflineDays(days: number): number {
  return Math.max(30, Math.min(365, Math.floor(days || 90)));
}

export function clampUserUsageDailyDays(days: number): number {
  return Math.max(90, Math.min(730, Math.floor(days || 365)));
}

export function clampRadpostauthDays(days: number): number {
  return Math.max(30, Math.min(365, Math.floor(days || 90)));
}

export async function getRetentionSettings(tenantId: string): Promise<RetentionSettings> {
  const s = await getSystemSettings(tenantId);
  return {
    radacct_closed_retention_days: clampRadacctClosedDays(
      Number(s.radacct_closed_retention_days ?? 180)
    ),
    sessions_offline_retention_days: clampSessionsOfflineDays(
      Number(s.sessions_offline_retention_days ?? 90)
    ),
    user_usage_daily_retention_days: clampUserUsageDailyDays(
      Number(s.user_usage_daily_retention_days ?? 365)
    ),
    radpostauth_retention_days: clampRadpostauthDays(Number(s.radpostauth_retention_days ?? 90)),
    server_log_retention_days: s.server_log_retention_days,
    whatsapp_log_retention_days: s.whatsapp_log_retention_days,
    radpostauth_retention_enabled: s.radpostauth_retention_enabled,
  };
}

export async function pruneRadacctClosed(
  db: Pool,
  retentionDays: number
): Promise<number> {
  if (!(await hasTable(db, "radacct"))) return 0;
  const days = clampRadacctClosedDays(retentionDays);
  const [result] = await db.execute(
    `DELETE FROM radacct
     WHERE acctstoptime IS NOT NULL
       AND acctstoptime < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

export async function pruneSessionsOffline(
  db: Pool,
  retentionDays: number,
  tenantId?: string
): Promise<number> {
  if (!(await hasTable(db, "sessions"))) return 0;
  const days = clampSessionsOfflineDays(retentionDays);
  const hasState = await hasColumn(db, "sessions", "session_state");
  if (!hasState) return 0;

  const hasReconcile = await hasColumn(db, "sessions", "last_reconcile_at");
  const hasStopped = await hasColumn(db, "sessions", "stopped_at");
  const hasStarted = await hasColumn(db, "sessions", "started_at");
  const ageExpr = hasReconcile
    ? "COALESCE(last_reconcile_at, stopped_at, started_at)"
    : hasStopped
      ? "COALESCE(stopped_at, started_at)"
      : hasStarted
        ? "started_at"
        : null;
  if (!ageExpr) return 0;

  const params: unknown[] = [days];
  let where = `session_state = 'OFFLINE' AND ${ageExpr} < DATE_SUB(NOW(3), INTERVAL ? DAY)`;
  if (tenantId) {
    where += " AND tenant_id = ?";
    params.push(tenantId);
  }
  const [result] = await db.execute(`DELETE FROM sessions WHERE ${where}`, params);
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

export async function pruneUserUsageDaily(
  db: Pool,
  retentionDays: number,
  tenantId?: string
): Promise<number> {
  if (!(await hasTable(db, "user_usage_daily"))) return 0;
  const days = clampUserUsageDailyDays(retentionDays);
  const params: unknown[] = [days];
  let where = "`day` < DATE_SUB(CURDATE(), INTERVAL ? DAY)";
  if (tenantId) {
    where += " AND tenant_id = ?";
    params.push(tenantId);
  }
  const [result] = await db.execute(`DELETE FROM user_usage_daily WHERE ${where}`, params);
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

/** Daily retention cycle for one tenant (radacct, sessions, usage, radpostauth). */
export async function runDataRetentionCycle(tenantId: string): Promise<RetentionPruneStep[]> {
  const settings = await getRetentionSettings(tenantId);
  const steps: RetentionPruneStep[] = [];

  try {
    const deleted = await pruneRadacctClosed(pool, settings.radacct_closed_retention_days);
    steps.push({ table: "radacct", deleted });
  } catch (e) {
    steps.push({
      table: "radacct",
      deleted: 0,
      skipped: true,
      reason: (e as Error)?.message ?? String(e),
    });
  }

  try {
    const deleted = await pruneSessionsOffline(pool, settings.sessions_offline_retention_days, tenantId);
    steps.push({ table: "sessions", deleted });
  } catch (e) {
    steps.push({
      table: "sessions",
      deleted: 0,
      skipped: true,
      reason: (e as Error)?.message ?? String(e),
    });
  }

  try {
    const deleted = await pruneUserUsageDaily(pool, settings.user_usage_daily_retention_days, tenantId);
    steps.push({ table: "user_usage_daily", deleted });
  } catch (e) {
    steps.push({
      table: "user_usage_daily",
      deleted: 0,
      skipped: true,
      reason: (e as Error)?.message ?? String(e),
    });
  }

  try {
    const rad = await pruneRadpostauth(tenantId);
    steps.push({
      table: "radpostauth",
      deleted: rad.deleted,
      skipped: !rad.ran,
      reason: rad.reason,
    });
  } catch (e) {
    steps.push({
      table: "radpostauth",
      deleted: 0,
      skipped: true,
      reason: (e as Error)?.message ?? String(e),
    });
  }

  const summary = steps
    .map((s) => `${s.table}=${s.deleted}${s.skipped ? "(skip)" : ""}`)
    .join(" ");
  log.info(`data_retention_cycle tenant=${tenantId} ${summary}`, { tenantId, steps }, "data-retention");

  return steps;
}
