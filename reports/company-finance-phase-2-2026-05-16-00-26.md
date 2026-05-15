# Phase 2 — ISP company finance (handoff report)

**Generated:** 2026-05-16 00:26 (local)

## Summary

Phase 2 wires **prepaid card batches** to **manager wallet / commissions / obligation**, adds a **central Arabic RTL** finance page at **`/company-finance`**, implements **`PATCH /api/subscribers/:id/responsible-manager`**, extends **`/api/company-finance`** with reports and expense/asset updates, strengthens **ISP permission** checks on prepaid routes, and adds **audit logs** for key money and admin actions. Validation: **`npm test` (api)**, **`npm run build` (api + frontend)**, **`docker compose config`** — all succeeded.

---

## Key files touched (tracked + notable untracked)

### Backend (API)

| Area | Path |
|------|------|
| Prepaid batch + wallet | `api/src/services/rm-cards.service.ts`, `api/src/services/prepaid-batch-finance.service.ts`, `api/src/routes/rm-cards.routes.ts` |
| Migration (batch idempotency) | `sql/migrations/017_prepaid_batch_keys.sql` |
| Company finance | `api/src/routes/company-finance.routes.ts` (untracked until committed) |
| Subscriber manager transfer | `api/src/routes/subscribers.routes.ts` |
| ISP permissions | `api/src/lib/isp-permissions.ts` (JWT merges; see `auth.routes.ts`) |

### Frontend

| Area | Path |
|------|------|
| Arabic finance hub | `frontend/src/pages/CompanyFinance.tsx` |
| Routing / nav | `frontend/src/App.tsx`, `frontend/src/layouts/AdminShell.tsx`, `frontend/src/i18n/translations.ts` |
| Permission helper | `frontend/src/lib/permissions.ts` (`hasIspPermission`) |
| Subscriber UI | `frontend/src/pages/UserProfile.tsx` |
| Prepaid batch UI | `frontend/src/pages/CardBatch.tsx` |

*Note: `git status` may list additional modified files from parallel work (billing, metrics, lifecycle). This report focuses on Phase 2 deliverables above.*

---

## Routes added / updated

### `POST /api/rm-cards/batch`

- **`kind`**: `print` \| `sale` (default `print`).
- **`client_batch_key`**: optional; used with migration `017` for **idempotent** replays (no duplicate wallet charge when the same key hits an existing batch).
- **Managers:** `prepaid_cards:print` vs `prepaid_cards:sell` enforced by `kind`.
- **Transaction:** `withTransaction` → `createRmCardBatch(conn, pool, …)`.
- **RADIUS:** `syncTasks` run **after** commit.
- **Audits:** `writeFinancialAudit` + `writeAuditLog` on **non-idempotent** success only (avoids duplicate logs on replay).

### `PATCH /api/subscribers/:id/responsible-manager`

- Body: `responsible_manager_id` (UUID), `reason` (1–500 chars).
- Permission: **`subscribers:assign_manager`** (`requestHasIspPermission`).
- **Manager** without **`subscribers:view_all`** may only transfer subscribers they **own** (`responsible_manager_id` or `created_by_manager_id` = self).
- Updates: `responsible_manager_id`, `manager_assigned_at`, `manager_assignment_source = manual_admin`.
- Audit: `subscriber_manager_audit` (via `logSubscriberManagerAudit`), `financial_audit_logs`, `audit_logs`.

### `GET /api/company-finance/*` (selected)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/managers/balances` | Manager wallet + obligation overview — `managers:view_wallet` |
| GET | `/cashbox/shifts` | Open/closed shifts — `cashbox:manage` **or** `financial_reports:view` |
| GET | `/reports/wallet-statement` | Running balance rows; `?format=csv` requires `financial_reports:export` |
| GET | `/reports/manager-obligations` | Obligation + wallet by manager |
| GET | `/reports/unpaid-by-manager` | Outstanding by `responsible_manager_id` |
| GET | `/reports/prepaid-sales-by-manager` | Aggregates `prepaid_card_batches` by `printed_by` |
| PATCH | `/expenses/:id` | `expenses:update` + audits |
| DELETE | `/expenses/:id` | `expenses:delete` + audits |
| PATCH | `/assets/:id` | `assets:update` + audits |

**Commissions list:** `GET /commissions` allows **`financial_reports:view`** **or** (manager + **`managers:view_statement`**).

---

## UI pages

| Route | Description |
|-------|-------------|
| **`/company-finance`** | Arabic-only, RTL (`dir="rtl"`). Sections: summary, manager balances, ledger, wallet statement, settlements, commissions, expenses, assets, cashbox shifts, reports (revenue, obligations, unpaid, prepaid). Filters: manager, date range; print + CSV export where permitted. |
| **`/users/:id`** | If **`subscribers:assign_manager`**: block **المدير المسؤول**, **تحويل المسؤولية**, **سبب التحويل** (Arabic). |
| **`/users/prepaid-cards`** | **نوع العملية** (print/sale) when allowed; **`client_batch_key`** generated client-side per batch attempt for idempotency. |

---

## Prepaid ↔ wallet integration (backend)

1. **Total face value:** `quantity × gross_card_value`.
2. **Manager + finance path:** `applyManagerPrepaidBatchFinancials` — `chargeManagerLedgerWithConnection` ( **`prepaid_card_print`** type; sell uses same financial path but `kind` stored on batch), commission via **`manager_commission_entries`**, **`manager_obligation_balance`** += company share.
3. **`prepaid_card_batches`** row links **`wallet_transaction_id`**, **`printed_by`**, **`kind`**, **`series`**, **`client_batch_key`** (when columns exist).
4. **Dedup:** `client_batch_key` unique per tenant + early return **idempotent** (no second ledger charge).
5. **Concurrency:** ledger charge inside the same transaction as batch insert + **`FOR UPDATE`** patterns on subscriber flows elsewhere; wallet ledger service uses row locks as implemented in `manager-wallet-ledger.service.ts`.

---

## Permission checks (representative)

| Key | Backend | Frontend |
|-----|---------|----------|
| `prepaid_cards:print` / `prepaid_cards:sell` | `rm-cards` batch route | `CardBatch` kind + pre-submit checks |
| `managers:view_wallet` | balances, ledger | `CompanyFinance` sections gated |
| `managers:view_statement` | wallet statement, settlement list (existing), commissions OR | Arabic page |
| `financial_reports:view` / `export` | reports + CSV gate | export button |
| `subscribers:assign_manager` | PATCH responsible-manager | `UserProfile` block |
| `expenses:*` / `assets:*` / `cashbox:manage` | company-finance routes | (operations primarily API/admin UIs) |

---

## Audit coverage

- Prepaid batch (non-idempotent): financial + general audit.
- Manager settlement payment: already had financial audit — **added** `writeAuditLog`.
- Expense create / update / delete; asset create / update; cashbox open / close: **audit_log** (+ financial where mutating money records).
- Subscriber manager transfer: **subscriber_manager_audit** + financial + audit_logs.

---

## Validation results

| Command | Result |
|---------|--------|
| `npm test` (in `api/`) | **Pass** — 51 tests |
| `npm run build` (in `api/`) | **Pass** |
| `npm run build` (in `frontend/`) | **Pass** |
| `docker compose config` | **Exit 0** (compose file valid) |

## Remaining warnings / notes

- **Git:** line-ending warnings (CRLF/LF) on some files; normalize if your team standardizes on LF.
- **Docker compose config** prints environment values — treat as sensitive; do not paste into public docs.
- **`company-finance.routes.ts`** and related financial files may still be **untracked** until you `git add` the ISP finance module.
- **Roles UI** (`RolesPermissions.tsx`) does not yet surface every **ISP** key in the grid; permissions are still enforced server-side via JWT `permissions` from login and staff overrides.

---

## Migration reminder

Apply **`017_prepaid_batch_keys.sql`** (and preceding **`016_isp_financial_system.sql`**) on databases where the financial module is enabled, so `client_batch_key` / `series` and idempotent batch behavior work as designed.
