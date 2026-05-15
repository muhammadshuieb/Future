# Main dashboard — operational upgrade

**Date:** 2026-05-16  
**Scope:** Staff home route `/` (`DashboardPage`) and `GET /api/dashboard/summary`

## Intent

The main dashboard is **operations and infrastructure only**. Executive financial analytics, revenue, wallets, commissions, expenses, and P&amp;L remain on **`/financial-dashboard`**. The home dashboard includes a single compact shortcut (Arabic label: **فتح اللوحة المالية**) to that route.

## What was added to the API (`/api/dashboard/summary`)

| Field | Purpose |
|--------|---------|
| `total_subscribers` | `COUNT(*)` for the tenant in `subscribers` |
| `disabled_subscribers` | Count where `status` ∈ `disabled`, `suspended`, `inactive`, `blocked` (aligned with subscriber list “disabled” semantics) |
| `bandwidth_today_bytes` | `SUM(total_bytes)` from `user_usage_daily` for `CURDATE()` and the tenant |
| `freeradius` | `{ status, open_sessions, last_accounting_at }` — derived from `radacct` joined to `subscribers` for the tenant (open sessions; freshness vs `FREERADIUS_FRESH_MINUTES` default 25 and `FREERADIUS_STALE_HOURS` default 24) |
| `alerts` | Server-built list: `backup_failed`, `whatsapp_unreachable`, `nas_offline` (with `meta.nas_offline`), `radius_stale` |

Existing fields kept for compatibility: `active_subscribers`, `expired_subscribers` (by `expiration_date < NOW()`), `online_users`, `total_bandwidth_bytes` (live aggregate), `nas`, `backup`, `whatsapp`, `host`.

## What changed in the UI (`frontend/src/pages/Dashboard.tsx`)

- **Compact** metric cards: total, active, expired, disabled, online now, **usage today**.
- **Integration row:** NAS totals, **FreeRADIUS** status, WhatsApp, backup (no revenue widgets).
- **Host** block: CPU load, RAM, uptime (API host process).
- **Operational alerts** card when `alerts.length > 0`.
- **Subscriber growth** bar chart (unchanged data source: `/api/dashboard/charts/subscribers`).
- **Refresh:** manual button, **last updated** timestamp (locale-aware), **auto refresh every 60s**.
- **WebSocket:** any non-`connected` JSON event schedules a **debounced** full reload (~1.2s); `nas_status` still shows a short banner.
- **RTL / Arabic:** page `dir` follows locale; shortcut label uses Arabic copy in `ar` translations.
- **Theme:** continues to use existing CSS variables (`--card`, `--border`, etc.) for light/dark.

## Files touched

- `api/src/routes/dashboard.routes.ts` — summary aggregation, FreeRADIUS snapshot, alerts
- `frontend/src/pages/Dashboard.tsx` — layout, refresh behavior, compact cards, finance shortcut
- `frontend/src/i18n/translations.ts` — new `dash.*` and `dash.alert.*` strings (AR/EN)

## Explicitly excluded from the main dashboard

Revenue today/month, manager obligations, wallet balances, commissions, expenses, profit/loss, cashbox — all remain on **`/financial-dashboard`**.

## Verification

- `api`: `npm run build` (tsc)
- `frontend`: `npm run build` (vite)
