# Financial dashboard and operational analytics — implementation report

**Date:** 2026-05-16 (generated at build/validation time)

## Summary

Delivered an Arabic-first (RTL) **financial executive dashboard** at `/financial-dashboard`, a **financial reports hub** at `/financial-reports`, and hardened **company finance** asset creation/update for tower/manager/maintenance fields. The legacy route `/finance-dashboard` **redirects** to `/financial-dashboard`. Backend analytics, KPIs, alerts, and day closings are served from `/api/financial-analytics/*` (existing module, alert logic refined).

## Routes (frontend)

| Path | Description |
|------|-------------|
| `/financial-dashboard` | Executive dashboard: widgets, charts (Recharts), KPIs, alerts, EOD closing (permission-gated), print |
| `/financial-reports` | Reports hub: date/manager filters, preview tables, CSV export where API supports `format=csv` |
| `/finance-dashboard` | Permanent redirect → `/financial-dashboard` |

## API

- **`GET /api/financial-analytics/dashboard`** — widgets, charts, `kpis`, `package_profitability`
- **`GET /api/financial-analytics/kpis`**
- **`GET /api/financial-analytics/alerts`** — dismissible keys via `POST /api/financial-analytics/alerts/dismiss`
- **`GET/POST /api/financial-analytics/closings`**, **`GET /api/financial-analytics/closings/:businessDate/report`**
- **`POST /api/company-finance/assets`** — extended fields persisted when columns exist (`tower_label`, `assigned_manager_id`, `maintenance_status`)
- **`PATCH /api/company-finance/assets/:id`** — same fields with `hasColumn` guards

## Database

- Migration **`018_financial_dashboard_analytics.sql`**: `financial_day_closings`, `financial_alert_dismissals`, `company_assets` extra columns (re-run may require duplicate-column handling in your runner).

## Alerts (backend behaviour)

- Wallet: negative with no overdraft config; at/exceed negative limit when `allowed_negative_balance` is set
- Overdue invoices; high prepaid volume; cashbox variance; high daily expenses vs 30d average; low opening cash for **open** shift; recent `finance_permission_denied` in **`financial_audit_logs`**; optional **settlement** rows with status `failed`/`rejected`/`void` if present

## Validation

| Command | Result |
|---------|--------|
| `npm run build` (api) | OK (`tsc`) |
| `npm test` (api) | OK (51 tests) |
| `npm run build` (frontend) | OK (Vite) |
| `docker compose config` | OK |

**Note:** The frontend package has no `npm test` script; only the API test suite was run.

## Files touched (high level)

- `frontend/src/pages/FinancialExecutiveDashboard.tsx` — new
- `frontend/src/pages/FinancialReportsHub.tsx` — new
- `frontend/src/App.tsx`, `frontend/src/layouts/AdminShell.tsx`, `frontend/src/i18n/translations.ts`
- `api/src/routes/company-finance.routes.ts` — asset POST/PATCH extensions
- `api/src/routes/financial-analytics.routes.ts` — alert refinements

## Follow-ups (optional)

- WhatsApp outbound for alert classes (placeholder hooks can call existing WA service later)
- Additional CSV endpoints for reports beyond wallet statement
- Admin UI for overriding closed-day edits (API freeze already allows admin bypass on expenses)
