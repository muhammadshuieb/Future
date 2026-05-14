import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { sendOperationalAlertWhatsApp } from "../services/whatsapp.service.js";
import { getSystemSettings } from "../services/system-settings.service.js";

const router = Router();

/**
 * Alertmanager → here → existing WhatsApp ops alert pipeline.
 *
 * The route is intended for in-cluster callers (Alertmanager → api:3000); do not expose it publicly,
 * but ALERT_WEBHOOK_TOKEN provides defense-in-depth: Alertmanager passes the token
 * via `Authorization: Bearer …` (configured in alertmanager.yml).
 *
 * We deliberately accept the loose Alertmanager v4 schema and only extract the fields
 * we render — anything else is logged but not rejected, so future Prometheus rule
 * additions don't require code changes.
 */
const alertSchema = z
  .object({
    status: z.string().optional(),
    receiver: z.string().optional(),
    alerts: z
      .array(
        z.object({
          status: z.string().optional(),
          labels: z.record(z.string()).optional(),
          annotations: z.record(z.string()).optional(),
          startsAt: z.string().optional(),
          endsAt: z.string().optional(),
        })
      )
      .default([]),
  })
  .passthrough();

router.post("/", async (req, res) => {
  const expected = (process.env.ALERT_WEBHOOK_TOKEN || "").trim();
  if (expected) {
    const header = String(req.headers["authorization"] ?? "");
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1].trim() !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }
  const parsed = alertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_alert_body", details: parsed.error.flatten() });
    return;
  }
  const tenantId = config.defaultTenantId;
  const settings = await getSystemSettings(tenantId).catch(() => null);
  if (!settings?.critical_alert_enabled) {
    res.status(202).json({ ok: true, skipped: "critical_alert_disabled" });
    return;
  }
  const phone = (settings.critical_alert_phone || "").trim();
  if (!phone && !settings.critical_alert_use_session_owner) {
    res.status(202).json({ ok: true, skipped: "no_target_phone" });
    return;
  }
  const status = String(parsed.data.status ?? "firing").toUpperCase();
  const lines = [`تنبيه Prometheus — ${status}`];
  for (const a of parsed.data.alerts.slice(0, 5)) {
    const name = a.labels?.alertname ?? "alert";
    const severity = a.labels?.severity ?? "info";
    const summary = a.annotations?.summary ?? a.annotations?.description ?? "";
    const instance = a.labels?.instance ?? a.labels?.job ?? "";
    lines.push(`• [${severity}] ${name}${instance ? ` @ ${instance}` : ""}${summary ? ` — ${summary.slice(0, 200)}` : ""}`);
  }
  if (parsed.data.alerts.length > 5) {
    lines.push(`(+${parsed.data.alerts.length - 5} more)`);
  }
  const message = lines.join("\n");
  const sent = await sendOperationalAlertWhatsApp(tenantId, phone || null, message, {
    preferSessionOwner: Boolean(settings.critical_alert_use_session_owner),
  });
  res.status(sent.sent ? 200 : 202).json({ ok: sent.sent, reason: sent.reason ?? null });
});

export default router;
