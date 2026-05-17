import type { Pool } from "mysql2/promise";
import { sendOperationalAlertWhatsApp } from "../whatsapp.service.js";
import { isInQuietHours, getMonitoringSettings } from "./infrastructure-settings.service.js";
import type { AlertSeverity } from "./infrastructure-types.js";
import type { EvaluatedAlert } from "./infrastructure-alert-engine.service.js";
import {
  formatAlertTelegramMessage,
  formatRecoveryTelegramMessage,
} from "./infrastructure-telegram-notify.service.js";
import type { RouterHealthSnapshot } from "./infrastructure-types.js";
import type { ServerHealthSnapshot } from "./server-health-collector.service.js";

/** Same layout/order as Telegram instant alerts. */
export function formatAlertWhatsAppMessage(
  ev: EvaluatedAlert,
  snap?: RouterHealthSnapshot | null,
  serverSnap?: ServerHealthSnapshot | null
): string {
  return formatAlertTelegramMessage(ev, snap, serverSnap);
}

export function formatRecoveryWhatsAppMessage(ev: EvaluatedAlert): string {
  return formatRecoveryTelegramMessage(ev);
}

/** Infrastructure WhatsApp always goes to the connected session owner number. */
export async function dispatchInfrastructureWhatsApp(
  pool: Pool,
  tenantId: string,
  severity: AlertSeverity,
  message: string,
  isRecovery: boolean
): Promise<boolean> {
  const settings = await getMonitoringSettings(pool, tenantId);
  if (!settings.infrastructure_alerts_enabled || !settings.whatsapp_alerts_enabled) return false;
  if (isInQuietHours(settings) && severity !== "critical") return false;
  if (settings.whatsapp_critical_only && severity !== "critical" && !isRecovery) return false;

  const r = await sendOperationalAlertWhatsApp(tenantId, null, message, { preferSessionOwner: true });
  return r.sent;
}
