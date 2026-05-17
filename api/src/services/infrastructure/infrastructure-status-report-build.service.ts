import type { Pool } from "mysql2/promise";
import {
  collectServerHealth,
  getServerHealthSnapshot,
} from "./server-health-collector.service.js";
import { prepareRoutersForStatusReport, type StatusReportRouterPrep } from "./router-health-collector.service.js";
import {
  formatEmptyReportMessage,
  formatServerStatusReport,
  formatSingleRouterReport,
} from "./infrastructure-status-report-format.service.js";

/** Server first, then one message per router (or empty-router notice). */
export async function buildScheduledStatusMessages(
  pool: Pool,
  tenantId: string,
  freshCollect: boolean
): Promise<{ messages: string[]; prep: StatusReportRouterPrep }> {
  const prep = await prepareRoutersForStatusReport(pool, tenantId, {
    collectIfEmpty: true,
    freshCollect,
  });

  let server = await getServerHealthSnapshot(pool, tenantId);
  if (!server || freshCollect) {
    server = await collectServerHealth(pool, tenantId);
  }

  const messages: string[] = [formatServerStatusReport(server)];
  if (prep.routers.length > 0) {
    messages.push(...prep.routers.map((r) => formatSingleRouterReport(r)));
  } else {
    messages.push(formatEmptyReportMessage(prep));
  }
  return { messages, prep };
}
