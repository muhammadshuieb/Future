# ISP financial system — full guide (how it works)

This document describes the **company / manager financial model** in Future Radius: data stores, money flows, permissions, APIs, and UI. It reflects the code paths under `api/src` and migrations **`016_isp_financial_system.sql`**, **`017_prepaid_batch_keys.sql`**.

---

## 1. What problem this solves

Field **managers** sell subscriptions and prepaid cards. Money is split into:

- **Manager commission** — what the manager earns (tracked in `manager_commission_entries`).
- **Company share** — what the company keeps; for prepaid batches this increases **`manager_obligation_balance`** on the manager’s `users` row (money the manager effectively “owes” the company until settled).
- **Manager wallet (`users.wallet_balance`)** — an operating float: topped up by admin; **debited** when the manager **prints or sells** prepaid face value (company collects that value from the manager’s float up front).

**Settlement** (`POST /api/company-finance/settlements/pay`) records cash (or transfer) from the manager toward the company and **reduces** `manager_obligation_balance`.

---

## 2. Core database concepts

### 2.1 `users` (staff / managers)

| Column | Meaning |
|--------|---------|
| `wallet_balance` | Current float; decreased when manager is charged for prepaid batch face value; increased on top-up (admin flows). |
| `allowed_negative_balance` | How far `wallet_balance` may go negative before `chargeManagerLedgerWithConnection` rejects (`ManagerBalanceError`). |
| `commission_type` / `commission_value` | Default % or fixed commission for renewals/payments (see `resolveRenewalCommission`). |
| `commission_prepaid_fixed` | Optional **per-card-batch** style cap: fixed commission taken from **total printed value** for prepaid (`resolvePrepaidCommission`). |
| `can_print_prepaid_cards` / `can_sell_prepaid_cards` | Fine-grained toggles; if `0`, batch route throws `prepaid_print_disabled` / `prepaid_sell_disabled`. |
| `manager_obligation_balance` | Accumulated **company share** from prepaid (and similar) flows — amount manager should remit to company over time. |

### 2.2 `manager_wallet_ledger` (immutable)

Each mutation:

1. **`SELECT … FOR UPDATE`** on the manager’s `users` row.
2. Validates **`balance_after ≥ -allowed_negative_balance`**.
3. Inserts a ledger row (`amount` is signed delta; charges use negative delta via `chargeManagerLedgerWithConnection`).
4. Updates `users.wallet_balance`.

Reference: `api/src/services/manager-wallet-ledger.service.ts`.

### 2.3 `manager_commission_entries`

Stores **gross**, **commission_amount**, **company_amount**, `source_type` (e.g. `prepaid_batch`), `ledger_entry_id` link to wallet line when applicable.

Commission resolution:

- **Renewals / package payments:** `resolveRenewalCommission` — package-specific rule in `manager_package_commission_rules` if present, else manager’s `commission_type`/`commission_value`.
- **Prepaid batches:** `resolvePrepaidCommission` — if `commission_prepaid_fixed` is set, commission = min(gross, fixed); else same as renewal logic with `package_id = null`.

Reference: `api/src/services/manager-commission.service.ts`.

### 2.4 Prepaid batches

- **`prepaid_card_batches`**: `batch_total_amount`, `currency`, `printed_by`, `wallet_transaction_id` (ledger id), `kind` (`print` / `sale`), optional **`series`**, **`client_batch_key`** (migration `017`).
- **`prepaid_card_batch_items`**: links RADIUS `rm_cards` rows to a batch.

### 2.5 Settlements

- **`manager_settlement_payments`**: records a payment; **`manager_obligation_balance`** reduced in the same transaction (implementation in `company-finance.routes.ts`).

### 2.6 Company operations

- **`company_expenses`**, **`company_assets`**, **`cashbox_shifts`** — operational P&L and daily cash tracking (see `/api/company-finance/*`).

### 2.7 Subscriber ownership

- **`subscribers.responsible_manager_id`**, **`manager_assignment_source`**, **`manager_assigned_at`**, audit in **`subscriber_manager_audit`**.
- Automatic assignment on financial events: `assignResponsibleManagerOnFinancialEvent` (`subscriber-manager-assignment.service.ts`) for renewals / invoice payments; **manual** transfer: `PATCH /api/subscribers/:id/responsible-manager`.

---

## 3. Authentication & permissions (ISP keys)

JWT **`permissions`** merges:

- **Admin:** all ISP keys on + finance + manager + speed defaults (`auth.routes.ts`).
- **Manager:** role defaults from `staff_role_permissions`, manager + finance + speed merged, then **`normalizeIspPermissions(userOverride, defaultIspPermissionsManager())`**.
- **Accountant / viewer:** their own ISP defaults.

Full key list: `api/src/lib/isp-permissions.ts` (`ISP_PERMISSION_KEYS`).

**Rule:** **`role === "admin"`** bypasses ISP checks in `hasIspPermission`; everyone else is gated per key on the **server**. The frontend mirrors hiding with `hasIspPermission()`.

---

## 4. End-to-end: prepaid card batch (manager)

1. Client calls **`POST /api/rm-cards/batch`** with quantity, `gross_card_value`, package, `kind` (`print`|`sale`), optional **`client_batch_key`**.
2. Route ensures **`prepaid_cards:print`** or **`prepaid_cards:sell`** for managers (`rm-cards.routes.ts`).
3. **`withTransaction`** → **`createRmCardBatch(conn, pool, tenantId, input, finance)`** (`rm-cards.service.ts`).
4. If **`client_batch_key`** matches an existing batch (unique per tenant), returns **idempotent** — **no second wallet charge**, no duplicate audits.
5. **Gross total** = `quantity × gross_card_value` (same currency as package).
6. For **manager** with `totalFace > 0`:
   - **`assertManagerCanPrintCards`** or **`assertManagerCanSellCards`** (DB flags).
   - **`applyManagerPrepaidBatchFinancials`**:
     - **`chargeManagerLedgerWithConnection`** — type `prepaid_card_print`, reference `prepaid_card_batch` / `batch_id`.
     - **`resolvePrepaidCommission`** → **`insertCommissionEntry`** (if commission &gt; 0).
     - **`manager_obligation_balance += companyAmount`** (company’s share of that batch).
   - Insert **`prepaid_card_batches`** + items + cards in same transaction.
7. After commit, **RADIUS sync** runs from **`syncTasks`** (not inside DB transaction).
8. Audits: financial + `audit_logs` for **new** batches only (not idempotent replay).

**HTTP errors:** `402` insufficient wallet, `403` print/sell disabled or ISP forbidden.

---

## 5. End-to-end: settlement payment (accountant/admin)

1. **`POST /api/company-finance/settlements/pay`** with `managers:collect_settlement`.
2. Inserts **`manager_settlement_payments`**.
3. Decreases **`manager_obligation_balance`** (floored at 0).
4. **`writeFinancialAudit`** + **`writeAuditLog`**.

---

## 6. End-to-end: responsible manager (manual)

1. **`PATCH /api/subscribers/:id/responsible-manager`** with body `{ responsible_manager_id, reason }`.
2. Requires **`subscribers:assign_manager`**.
3. New manager must be a **manager** role in same tenant.
4. Scoped managers (no **`subscribers:view_all`**) may only transfer subscribers they **already own** (responsible or created_by).
5. Updates subscriber columns; **`logSubscriberManagerAudit`**; financial + general audit.

---

## 7. `/api/company-finance` — report & CRUD map (high level)

| Path | Role of the data |
|------|------------------|
| `GET /reports/summary` | Aggregate revenue/expenses (where tables exist). |
| `GET /reports/revenue-by-manager` | Payments joined to `subscribers.responsible_manager_id`. |
| `GET /managers/balances` | Per-manager wallet + obligation. |
| `GET /wallet/ledger` | `manager_wallet_ledger` (managers see self). |
| `GET /reports/wallet-statement` | Chronological ledger with running `balance_after`; `format=csv` needs `financial_reports:export`. |
| `GET /settlements/payments` | Settlement history. |
| `GET /commissions` | Commission entries. |
| `GET /reports/manager-obligations` | Obligation + wallet overview. |
| `GET /reports/unpaid-by-manager` | Outstanding invoice amounts by responsible manager. |
| `GET /reports/prepaid-sales-by-manager` | Sums from `prepaid_card_batches` by `printed_by`. |
| `GET /expenses`, `POST`, `PATCH`, `DELETE` | Company expenses + ISP keys `expenses:*`. |
| `GET /assets`, `POST`, `PATCH` | Assets + `assets:*`. |
| `POST /cashbox/open`, `POST /cashbox/:id/close`, `GET /cashbox/shifts` | Daily cashbox + `cashbox:manage` or read via reports permission where implemented. |

---

## 8. Frontend touchpoints

| Route | Purpose |
|-------|---------|
| `/company-finance` | Arabic RTL hub: tables + filters calling the APIs above (`CompanyFinance.tsx`). |
| `/users/prepaid-cards` | Batch create with **`kind`** + **`client_batch_key`** (`CardBatch.tsx`). |
| `/users/:id` | Manual **responsible manager** transfer when permitted (`UserProfile.tsx`). |

---

## 9. Auditing

- **Money / compliance:** `financial_audit_logs` (`writeFinancialAudit`).
- **General:** `audit_logs` (`writeAuditLog`) for settlements, expenses, assets, cashbox, prepaid batch (non-idempotent), subscriber transfer.
- **Ownership history:** `subscriber_manager_audit`.

---

## 10. Related billing paths (not repeating full detail)

- **Invoice / package payments** in **`subscriber-billing.service.ts`** may call **`assignResponsibleManagerOnFinancialEvent`** so **`responsible_manager_id`** tracks who collected revenue (mode from `system_settings.subscriber_manager_assignment_mode`).
- **Invoice route** (`invoices.routes.ts`) also uses assignment on payment.

---

## 11. Operational checklist

1. Run migrations **016** then **017** on each environment.
2. Grant ISP permissions via staff user **`permissions_json`** or role templates as needed.
3. Monitor **`manager_wallet_ledger`** and **`manager_obligation_balance`** for consistency with business rules.
4. Use **`client_batch_key`** from the client when retrying batch creation to avoid double charges.

---

*This guide is descriptive of the implemented system; exact amounts and business policy should be aligned with your accounting practices.*
