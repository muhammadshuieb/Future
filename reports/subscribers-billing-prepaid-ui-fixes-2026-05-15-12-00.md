# Subscribers, Billing, Prepaid UI Fixes — 2026-05-15

## Summary

Production-oriented updates for Arabic subscriber UI, subscription expiry on pay/edit, admin session timeout, prepaid card printing, and profile layout consistency.

## Arabic UI (subscriber pages)

- Added missing `profile.*` translation keys (sections, WhatsApp opt-out, internal ID, quota, password hash message, subscription expiry).
- Subscriber list (`Users.tsx`) and profile (`UserProfile.tsx`) use `t()` for status badges via shared `subscriber-status` helpers (نشط / متصل / منتهي / معطل).
- CSV export uses Arabic column headers and localized filename `users.export.filename`.
- Payment modal labels for optional subscription expiry date.

**Note:** Traffic report CSV/PDF export on the profile page still contains some English technical headers; core subscriber list/add/edit flows are Arabic-first.

## Changed files (main)

### Frontend
- `frontend/src/i18n/translations.ts`
- `frontend/src/pages/Users.tsx`
- `frontend/src/pages/UserProfile.tsx`
- `frontend/src/components/subscribers/SubscriberInvoicePaymentModal.tsx`
- `frontend/src/lib/subscriber-status.ts` (new)
- `frontend/src/hooks/useAdminInactivityLogout.ts` (new)
- `frontend/src/lib/prepaid-card-print.ts` (new)
- `frontend/src/pages/PrepaidCardPrintPage.tsx` (new)
- `frontend/src/pages/Settings.tsx`
- `frontend/src/layouts/AdminShell.tsx`
- `frontend/src/pages/CardBatch.tsx`
- `frontend/src/App.tsx` — prepaid routes restored; print route `/prepaid-cards/print`

### Backend
- `api/src/lib/expiration-date.ts` (new)
- `api/src/services/subscriber-billing.service.ts`
- `api/src/routes/invoices.routes.ts`
- `api/src/routes/subscribers.routes.ts`
- `api/src/services/system-settings.service.ts`
- `api/src/routes/system-settings.routes.ts`
- `sql/migrations/009_admin_session_timeout.sql` (new)
- `api/src/tests/expiration-date.test.ts` (new)
- `api/package.json` — test script includes expiration-date tests

## New settings

| Setting | Storage | Default | UI |
|---------|---------|---------|-----|
| `admin_session_timeout_minutes` | `system_settings.admin_session_timeout_minutes` | 30 | الإعدادات → الأمان — مهلة تسجيل الخروج التلقائي (5, 10, 15, 30, 60) |

`useAdminInactivityLogout` in `AdminShell` resets on pointer/keyboard/scroll/click and `fetch`; warns 1 minute before logout.

## New API fields

| Endpoint | Field | Behavior |
|----------|-------|----------|
| `PATCH /api/subscribers/:id` | `expiration_date` | Validated; financial audit `subscriber_update_expiry` |
| `POST /api/subscribers/:id/record-package-payment` | `subscription_expires_at` | Optional; on full pay overrides package-day extension |
| `POST /api/invoices/:id/mark-paid` | `subscription_expires_at` | Optional; same override semantics |
| `GET/PUT /api/system-settings` | `admin_session_timeout_minutes` | 5–60 minutes (whitelist) |

Subscriber create already defaults `expiration_date` to `CURDATE()` when omitted (expires today).

## Payment expiry behavior

1. Admin opens payment modal → optional **تاريخ انتهاء الاشتراك** (date only sent if filled).
2. On full invoice payment, backend sets `subscribers.expiration_date` to explicit date (noon anchor) or extends by package `billing_period_days` if field empty.
3. Financial audit logs: `record_package_payment_update_expiry`, `invoice_paid_update_expiry` with previous/new dates, payment/invoice IDs, staff ID.

## Prepaid card print

- Route: `/prepaid-cards/print` (`PrepaidCardPrintPage`)
- RTL Arabic HTML print layout (`buildPrepaidCardsPrintHtml`): company name, package, username/password, speed, validity, price, instructions; optional QR via public API.
- Layouts: 8/6/4 cards per A4 page; toggles for price and QR.
- Entry: **طباعة الكروت** on card batch page; load by series via `/api/rm-cards/:series/cards` when API is available.

**Note:** `rm-cards` backend routes are not in this repo snapshot; print UI is ready when that API is deployed.

## Profile layout

- Wider container (`max-w-5xl`), consistent form grid for subscription/contact.
- Editable expiry date + unlimited checkbox in subscription section.
- Status badge uses same color system as subscriber list.

## Tests and build

| Command | Result |
|---------|--------|
| `npm test` (api) | **37 passed** (includes `expiration-date.test.ts`) |
| `npm run build` (api) | **OK** |
| `npm run build` (frontend) | **OK** |
| `docker compose config` | **OK** |

## Remaining warnings / follow-ups

- Prepaid `rm-cards` API must be registered for batch/list/print-by-series to work end-to-end.
- Traffic export strings on profile remain partially English.
- JWT `JWT_EXPIRES_IN` is not auto-synced with admin session timeout (frontend logout is independent).
- Optional: dedicated permissions `subscribers:update_expiry`, `invoices:pay_update_expiry`, `prepaid_cards:print` (currently mapped to `manage_subscribers` / `collect_payment`).
