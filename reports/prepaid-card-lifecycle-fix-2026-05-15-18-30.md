# Prepaid card lifecycle fix

**Generated:** 2026-05-15T18:30 (local)

## Broken behavior (before)

- Prepaid cards (`rm_cards`) relied on FreeRADIUS `Expiration` and per-router `Mikrotik-Total-Limit` only.
- No worker cycle terminated cards or disconnected sessions centrally.
- Open sessions could remain after calendar expiry or quota exhaustion.
- Quota could be exceeded across multiple NAS (each MikroTik enforced locally).
- `online_time_limit` and `available_time_from_activation` were stored but not enforced.
- `download_limit_mb` / `upload_limit_mb` were not synced to RADIUS.
- `DELETE /cards-expired` removed DB rows without CoA disconnect.

## Solution

Prepaid cards now follow the same pattern as monthly subscribers:

1. **Usage worker (every 60s, unchanged interval)** runs `runPrepaidCardLifecycleCycle()` after subscriber logic.
2. **Central usage** from `radacct` (all NAS): `used_bytes`, `used_seconds`, `first_used_at`, `last_used_at`.
3. On violation: `disconnectAllSessions` → CoA on every NAS → `disableRadiusUser` / `applyQuotaHardDeny` → update `rm_cards` lifecycle → `syncRmCardToRadius` with `Auth-Type Reject` + Arabic `Reply-Message`.
4. `Mikrotik-Total-Limit` remains as router-side safety only.

## Files changed

| Area | Files |
|------|--------|
| Migration | `sql/migrations/015_rm_cards_lifecycle.sql` |
| Access rules | `api/src/lib/prepaid-card-access.ts` |
| Lifecycle worker | `api/src/services/prepaid-card-lifecycle.service.ts` |
| Session close helper | `api/src/services/session-disconnect.service.ts` |
| RADIUS sync | `api/src/services/rm-card-radius-sync.service.ts` |
| Cards API/service | `api/src/services/rm-cards.service.ts`, `api/src/routes/rm-cards.routes.ts` |
| Subscriber worker | `api/src/worker/usage.worker.ts` |
| Octets helper | `api/src/lib/radacct-octets.ts` |
| Metrics | `api/src/services/metrics.service.ts` |
| Tests | `api/src/tests/prepaid-card-lifecycle.test.ts`, `api/package.json` |
| UI | `frontend/src/pages/PrepaidCardsList.tsx` |

## Migration `015_rm_cards_lifecycle.sql`

Adds to `rm_cards`:

- `lifecycle_status` (`available` \| `active` \| `consumed` \| `expired` \| `disabled`)
- `used_bytes`, `used_seconds`
- `first_used_at`, `last_used_at`, `expired_at`, `finished_at`
- `terminate_reason`, `last_disconnect_status`
- Index `idx_rm_cards_tenant_lifecycle`

Safe `ALTER TABLE` only; no drops.

## Worker / job

- **No new BullMQ job** — integrated into existing `update-usage` cycle (`UPDATE_USAGE_EVERY_MS` unchanged, default 60s).
- Batch size: `PREPAID_CARD_LIFECYCLE_BATCH` (default 500).
- Usage refresh: single SQL `UPDATE` joining `radacct` aggregates for active cards.

## RADIUS sync

- Deny with Arabic messages: البطاقة منتهية، انتهت كمية البيانات، انتهت مدة الاستخدام، تم استهلاك البطاقة.
- Syncs: `Simultaneous-Use`, `Expiration`, `Mikrotik-Rate-Limit` (package or dl/ul MB), `Session-Timeout` (from `online_time_limit` minutes), `Mikrotik-Total-Limit` (secondary cap).

## UI (Arabic labels)

List columns added: البيانات المستخدمة، البيانات المتبقية، وقت الاستخدام، الوقت المتبقي، أول استخدام، الحالة، سبب الإنهاء، آخر فصل.

## Tests added

`api/src/tests/prepaid-card-lifecycle.test.ts` — calendar expiry, quota, consumed state, online time, activation window, multi-NAS design note.

## Validation

| Command | Result |
|---------|--------|
| `npm run build` (api) | Pass |
| `npm test` (api) | 51/51 pass |
| `npm run build` (frontend) | Pass |
| `docker compose config` | Valid (config emitted) |

## Remaining warnings

- CoA must be enabled on each MikroTik (`/radius incoming set accept=yes`).
- `used_bytes` refresh runs each usage cycle for eligible cards; very large `radacct` tables need index `username` (see `003_radacct_indexes.sql`).
- `DELETE /cards-expired` now **terminates** cards (CoA when route passes services); bulk delete by ID still deletes rows (admin action).
- `online_time_limit` / `available_time_from_activation` interpreted as **minutes** (Radius Manager style).
- Calendar expiry uses **DATE** column: expired when `expiration < CURDATE()` (end of calendar day before today).

## Metrics

- `futureradius_prepaid_cards_expired_total`
- `futureradius_prepaid_cards_quota_exceeded_total`
- `futureradius_prepaid_cards_time_exceeded_total`
- `futureradius_prepaid_cards_disconnect_total{result}`

Structured logs: `prepaid_card_expired`, `prepaid_card_quota_exceeded`, `prepaid_card_time_exceeded`, `prepaid_card_disconnect_sent`, `prepaid_card_disconnect_failed`, `prepaid_card_radius_disabled`.
