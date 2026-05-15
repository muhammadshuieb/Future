# Subscribers UI / status redesign (2026-05-15)

## Summary

Compact subscribers table with a row actions menu, server-driven status (`subscriber_ui_status`), online/session fields aligned with accounting rules, date-only expiry handling (`DATE(...) <= CURDATE()`), and default `expiration_date = CURDATE()` on create when the client omits the field.

## Files changed

| Area | File | Behavior |
|------|------|----------|
| API | `api/src/services/accounting.service.ts` | Exposes `buildActiveRadacctPredicate(alias)` (same rules as `/api/online-users`). Removed unused `config` import. |
| API | `api/src/services/subscriber-list.service.ts` | Extended list query: `is_online`, `active_session_id`, `session_framed_ip`, `session_nas_ip`, `session_nas_name`, `last_seen_at`, `subscriber_ui_status`, `active_sessions`. Filters/stats use **date-only** expiry vs `CURDATE()`. `online_now` uses accounting freshness. |
| API | `api/src/routes/subscribers.routes.ts` | `POST /api/subscribers`: `expiration_date` omitted → `CURDATE()`; explicit `null` → SQL `NULL` (unlimited). |
| API | `api/src/routes/reseller-portal.routes.ts` | Reseller-created subscribers get `expiration_date = CURDATE()` for consistency. |
| Web | `frontend/src/pages/Users.tsx` | Compact table, RTL `dir`, sticky scroll area, status dot + badge colors, `SubscriberRowActions`, `last_seen` column, default 50/page, column storage key `users-v2`. |
| Web | `frontend/src/components/subscribers/SubscriberRowActions.tsx` | Three-dots menu: profile, edit, invoice/pay, financial report, enable/disable, delete. |
| Web | `frontend/src/i18n/translations.ts` | New strings: `users.lastSeen`, `users.actions.*`, `users.createExpiryHint` (AR/EN). |
| Web | `frontend/src/index.css` | Tighter `.users-table td` padding. |

## Status priority (server `subscriber_ui_status`)

1. Disabled (`status` in disabled set) → `disabled`  
2. Expired (`status = expired` OR `DATE(expiration_date) <= CURDATE()`) → `expired`  
3. Else if fresh open `radacct` session (same predicate as online users) → `online`  
4. Else → `active`

## Create subscriber defaults

- If the JSON body does **not** send `expiration_date`, MySQL stores **today’s date** (`CURDATE()`), so the row is **expired by date** until staff extends it or billing extends it.
- Sending `"expiration_date": null` explicitly stores **NULL** (treated as not expiring by date in filters).

## Verification run

- `npm run build` (api): pass  
- `npm test` (api): pass  
- `npm run build` (frontend): pass  
- `docker compose config`: pass  

## Notes

- Column visibility localStorage key was bumped to `users-v2` so new columns (e.g. last seen) appear without manual reset.
- Client still maps legacy `active_sessions` to `is_online` when `is_online` is absent for older deployments.
