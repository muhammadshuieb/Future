import type { Pool } from "mysql2/promise";
import { listRouterHealthSnapshots, collectRouterHealthForTenant } from "./router-health-collector.service.js";
import { collectServerHealth } from "./server-health-collector.service.js";
import { runAlertEvaluationCycle } from "./infrastructure-alert-engine.service.js";
import type { RouterHealthSnapshot } from "./infrastructure-types.js";
import { log } from "../logger.service.js";
import { executeDueRouterActions } from "./router-actions.service.js";
import { maybeSendTelegramStatusReport } from "./infrastructure-telegram-status-report.service.js";
import { maybeSendWhatsAppStatusReport } from "./infrastructure-whatsapp-status-report.service.js";

export async function runInfrastructureMonitorCycle(pool: Pool, tenantId: string): Promise<void> {
  const prevSnaps = await listRouterHealthSnapshots(pool, tenantId);
  const prevMap = new Map<string, RouterHealthSnapshot>();
  for (const s of prevSnaps) prevMap.set(s.nas_device_id, s);

  const routerSnaps = await collectRouterHealthForTenant(pool, tenantId, prevMap, {
    skipPing: true,
    skipHotspot: true,
    measureInstantTraffic: true,
    trafficSampleMs: 2000,
    apiTimeoutMs: 12_000,
  });
  const serverSnap = await collectServerHealth(pool, tenantId);

  await runAlertEvaluationCycle(pool, tenantId, routerSnaps, prevMap, serverSnap);
  await executeDueRouterActions(pool, tenantId).catch((e) => {
    log.warn(`router_scheduled_actions_failed ${String(e)}`, {}, "infra-monitor");
  });

  await maybeSendTelegramStatusReport(pool, tenantId, { freshCollect: false }).catch((e) => {
    log.warn(`telegram_status_report_failed ${String(e)}`, {}, "infra-monitor");
  });
  await maybeSendWhatsAppStatusReport(pool, tenantId, { freshCollect: false }).catch((e) => {
    log.warn(`whatsapp_status_report_failed ${String(e)}`, {}, "infra-monitor");
  });

  log.info(
    `infrastructure_monitor_cycle routers=${routerSnaps.length} server=${serverSnap.health_status}`,
    { count: routerSnaps.length },
    "infra-monitor"
  );
}
