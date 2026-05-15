import type { Pool } from "mysql2/promise";
import type { ResultSetHeader } from "mysql2";
import type { DisconnectAllReport } from "./coa.service.js";
import { hasTable } from "../db/schemaGuards.js";
import { enqueueCoaDisconnect } from "./task-queue.service.js";

/**
 * Close radacct rows after successful CoA / MikroTik kick (shared by subscriber + prepaid workers).
 */
export async function closeDisconnectedRadacctSessions(
  pool: Pool,
  username: string,
  tenantId: string,
  report: DisconnectAllReport | null,
  reason: string
): Promise<number> {
  if (!report || !(await hasTable(pool, "radacct"))) return 0;
  let closed = 0;
  for (const item of report.results) {
    const ok = item.coa.ok || Boolean(item.mikrotik?.ok);
    if (!ok) {
      await enqueueCoaDisconnect({
        tenantId,
        username,
        nasIp: item.nas,
        acctSessionId: item.acctSessionId,
        framedIp: item.framedIp,
      }).catch((e) => {
        console.warn(
          `[session-disconnect] enqueue retry failed user=${username} nas=${item.nas}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      });
      console.warn(
        `[session-disconnect] pending reason=${reason} user=${username} nas=${item.nas} session=${
          item.acctSessionId ?? "-"
        } result=${item.coa.message}`
      );
      continue;
    }

    const params: string[] = [username, item.nas];
    let where = "username = ? AND nasipaddress = ? AND acctstoptime IS NULL";
    if (item.acctSessionId) {
      where += " AND acctsessionid = ?";
      params.push(item.acctSessionId);
    } else if (item.framedIp) {
      where += " AND framedipaddress = ?";
      params.push(item.framedIp);
    }
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE radacct
       SET acctstoptime = NOW(),
           acctsessiontime = GREATEST(0, TIMESTAMPDIFF(SECOND, acctstarttime, NOW())),
           acctterminatecause = CASE
             WHEN COALESCE(acctterminatecause, '') = '' THEN 'Admin-Reset'
             ELSE acctterminatecause
           END
       WHERE ${where}`,
      params
    );
    closed += Number(result?.affectedRows ?? 0);
  }
  return closed;
}

export function summarizeDisconnectReport(report: DisconnectAllReport | null): string {
  if (!report) return "no_report";
  if (!report.results.length) return "no_open_sessions";
  const ok = report.results.filter((r) => r.coa.ok || Boolean(r.mikrotik?.ok)).length;
  return `${ok}/${report.results.length}_sessions_ok`;
}
