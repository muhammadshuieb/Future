import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { getSystemSettings } from "./system-settings.service.js";
import { log } from "./logger.service.js";

export type RadpostauthPruneResult = {
  ran: boolean;
  enabled: boolean;
  retention_months: number;
  cutoff: string | null;
  deleted: number;
  reason?: string;
};

/**
 * Compute the cutoff date for `radpostauth` pruning.
 *
 * The contract (matching the user-facing setting): retain `months` calendar
 * months including the current one. So with `months = 2`, on any day in May
 * we keep April + May, dropping anything strictly older than April 1.
 *
 *   cutoff = first_day_of(current_month) - (months - 1) months
 *
 * Examples (months = 2):
 *   2026-05-15 → cutoff = 2026-04-01 (deletes everything before April)
 *   2026-04-30 → cutoff = 2026-03-01 (deletes everything before March)
 *   2026-01-05 → cutoff = 2025-12-01 (handles year rollover)
 */
export function computeRadpostauthCutoff(now: Date, months: number): string {
  const safeMonths = Math.max(1, Math.min(36, Math.floor(months)));
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  firstOfMonth.setMonth(firstOfMonth.getMonth() - (safeMonths - 1));
  const yyyy = firstOfMonth.getFullYear();
  const mm = String(firstOfMonth.getMonth() + 1).padStart(2, "0");
  const dd = String(firstOfMonth.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Delete `radpostauth` rows older than the configured retention boundary.
 *
 * Idempotent: the cutoff is computed from the calendar (start of current month
 * minus `months - 1`), so re-running on the same day deletes nothing extra.
 * Designed to be called by the monthly cron and from a manual "run now" endpoint.
 */
export async function pruneRadpostauth(tenantId: string): Promise<RadpostauthPruneResult> {
  const settings = await getSystemSettings(tenantId);
  const months = Math.max(1, Math.min(36, Math.floor(settings.radpostauth_retention_months || 2)));

  if (!settings.radpostauth_retention_enabled) {
    return { ran: false, enabled: false, retention_months: months, cutoff: null, deleted: 0, reason: "disabled" };
  }
  if (!(await hasTable(pool, "radpostauth"))) {
    return { ran: false, enabled: true, retention_months: months, cutoff: null, deleted: 0, reason: "table_missing" };
  }

  const cutoff = computeRadpostauthCutoff(new Date(), months);
  try {
    const [result] = await pool.execute(
      `DELETE FROM radpostauth WHERE authdate < ?`,
      [cutoff]
    );
    const deleted = Number((result as { affectedRows?: unknown }).affectedRows ?? 0);
    if (deleted > 0) {
      log.info(
        `radpostauth_pruned deleted=${deleted} cutoff=${cutoff} retention_months=${months}`,
        { tenantId, deleted, cutoff, months },
        "radpostauth-retention"
      );
    }
    return { ran: true, enabled: true, retention_months: months, cutoff, deleted };
  } catch (error) {
    log.error(
      `radpostauth_prune_failed ${(error as Error)?.message ?? String(error)}`,
      { tenantId, cutoff, months },
      "radpostauth-retention"
    );
    throw error;
  }
}
