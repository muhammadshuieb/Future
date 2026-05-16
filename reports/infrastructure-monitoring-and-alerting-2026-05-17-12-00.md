# Infrastructure Monitoring & Alerting — Implementation Report

**Date:** 2026-05-17  
**Project:** Future Radius  
**Scope:** ISP NOC platform — MikroTik monitoring, server health, alert engine, WhatsApp notifications

---

## Summary

Future Radius now includes a full **infrastructure monitoring and alerting** stack independent of RADIUS authentication. The worker runs a periodic `infrastructure-monitor-cycle` job that collects RouterOS API metrics, evaluates thresholds, persists alerts, and sends WhatsApp messages with **cooldown** and **recovery** logic.

---

## Database (migration `019_infrastructure_monitoring.sql`)

| Table | Purpose |
|-------|---------|
| `infrastructure_monitoring_settings` | Global toggles: alerts, WhatsApp, cooldown, quiet hours, poll interval |
| `infrastructure_thresholds` | Global + per-NAS thresholds (CPU, RAM, temp, voltage, PPP drop, disk, server) |
| `infrastructure_notification_targets` | WhatsApp recipients (owners, managers, NOC numbers, groups) |
| `router_health_snapshots` | Latest MikroTik metrics per NAS |
| `server_health_snapshots` | Future Radius host + service health |
| `infrastructure_alerts` | Active/resolved alerts with fingerprint deduplication |
| `infrastructure_alert_history` | Audit trail (created, notified, resolved, recovery) |
| `router_scheduled_actions` | Scheduled reboot / interface actions with confirmation |

---

## MikroTik monitoring (RouterOS API :8728)

Collected per NAS when `mikrotik_api_enabled` + credentials are set:

- CPU load, RAM %, uptime
- Board temperature & voltage (from `/system/health/print`; shows **unsupported** when absent)
- Interface down count
- PPP active & hotspot session counts
- Internet reachability (ping 8.8.8.8, best-effort)
- `last_sync_ok`, `last_sync_error`, `last_seen_at`

Host resolution: `wireguard_tunnel_ip` first, then public `ip`.

---

## Alert engine

**Types:** `router_offline`, `high_cpu`, `high_ram`, `high_temperature`, `low_voltage`, `interface_down`, `ppp_session_drop`, `sync_failed`, `backup_failed`, `radius_down`, `whatsapp_disconnected`, `server_down`, `high_server_cpu`, `high_server_ram`, `disk_almost_full`, `service_down`

**Severity:** `info` | `warning` | `critical`

**Anti-spam:**

- Unique `fingerprint` per tenant + scope
- `alert_cooldown_minutes` (default 30) before repeat WhatsApp
- `quiet_hours` (critical still allowed when configured)
- `whatsapp_critical_only` mode
- Recovery message once when alert clears

**WhatsApp:** Uses existing WAHA integration via `sendOperationalAlertWhatsApp` + configurable `infrastructure_notification_targets`.

---

## Server monitoring

- Host CPU load, RAM %, disk % (disk monitor)
- MySQL, Redis, worker heartbeat, FreeRADIUS freshness
- Docker container list (when `docker.sock` is mounted on worker)

---

## API

Base path: `/api/infrastructure-monitoring`

| Endpoint | Description |
|----------|-------------|
| `GET /overview` | Routers, server, alerts, summary widgets |
| `GET/PUT /settings` | Monitoring + notification config |
| `PUT /thresholds/global` | Global thresholds |
| `GET/PUT /thresholds/nas/:id` | Per-NAS overrides |
| `POST /notification-targets` | Add/update WhatsApp target |
| `GET /alerts` | Alert list |
| `POST /alerts/:id/acknowledge` | Acknowledge firing alert |
| `POST /run-cycle` | Manual collection (admin/manager) |
| `POST /router-actions` | Schedule router operation |
| `POST /router-actions/:id/confirm` | Confirm dangerous action |

---

## Permissions (JWT `permissions`)

- `monitoring:view`
- `monitoring:manage`
- `monitoring:acknowledge_alerts`
- `monitoring:execute_router_actions`

Admins: all on. Managers: view/manage/ack by default; router actions off unless granted.

---

## UI

- **Route:** `/monitoring` — NOC page (RTL, dark/light, severity colors)
- **Dashboard:** NOC summary card with link to monitoring center
- **Nav:** «مركز NOC» under maintenance section

---

## Worker configuration

```env
INFRASTRUCTURE_MONITOR_MS=180000   # 3 minutes (BullMQ repeatable job)
MIKROTIK_API_SYNC_MS=300000        # optional legacy PPP session cache sync
```

Restart worker after `.env` changes:

```bash
docker compose up -d --build worker
```

---

## Validation

| Check | Result |
|-------|--------|
| `npm test` (api) | 55 tests passed (incl. `infrastructure-alert-engine.test.ts`) |
| `npm run build` (api) | OK |
| `npm run build` (frontend) | OK |
| `docker compose config` | OK |

---

## Operational notes

1. Enable MikroTik API on each NAS in **خوادم NAS** (user, password, port 8728 reachable from worker).
2. Configure WhatsApp targets under monitoring settings API (UI settings page can be extended).
3. RADIUS remains independent — monitoring failures do not block subscriber auth.
4. Poll interval default 3 minutes to avoid overloading RouterOS API.

---

## Files added (main)

- `sql/migrations/019_infrastructure_monitoring.sql`
- `api/src/services/infrastructure/*`
- `api/src/routes/infrastructure-monitoring.routes.ts`
- `api/src/lib/monitoring-permissions.ts`
- `api/src/tests/infrastructure-alert-engine.test.ts`
- `frontend/src/pages/InfrastructureMonitoring.tsx`
