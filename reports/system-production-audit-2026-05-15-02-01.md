# Future Radius — Production system audit

**Generated:** 2026-05-15T02:01 (local)  
**Scope:** ISP/RADIUS platform hardening, legacy/test cleanup, observability, worker architecture, database migrations.

---

## 1. Detected problems (before changes)

- **Temporary RADIUS/NAS lab**: `api/src/scripts/radius-nas-integration-test.ts`, synthetic FreeRADIUS probe, `prepaid_integration_test_cards`, multiple `reports/radius-nas-integration-test-*.md`, and `TEST-*` entities did not belong in a production system.
- **Legacy naming / mental model**: BullMQ queue was named `radius-manager`, which reads as legacy Radius Manager rather than Future Radius.
- **MikroTik sync source**: `mikrotik-ros-sync` read FreeRADIUS `nas` + non-schema columns (`apiusername`), drifting from `nas_devices` as the project NAS model.
- **Session truth**: Operational “online” logic already used heartbeat-aware rules in `AccountingService`, but the `sessions` table had no explicit lifecycle state for reconciliation and reporting.
- **Metrics gap**: Synthetic probe drove `futureradius_synth_check_total` and a Prometheus alert; real RADIUS accept/reject volume was not exported as first-class counters.
- **Worker monolith**: `workers/index.ts` mixed metrics HTTP server, critical alerts, invoice generation, and all BullMQ job branches in one file.
- **MikroTik API audit trail**: RouterOS calls were only logged via text logger, not structured DB rows with duration/payload/result.
- **Indexes**: High-traffic paths (`subscribers.username/status/expiration_date`, `radacct.acctsessionid`, `radacct.acctstoptime`, `nas.nasname`) lacked dedicated secondary indexes for worker and reporting queries.

---

## 2. Fixed / improved

- **Removed** synthetic RADIUS probe job, service, npm script, worker env vars (`SYNTH_RADIUS_*`), and integration test script/reports.
- **Replaced** prepaid integration-test migration with **`006_integration_test_cleanup.sql`**: drops `prepaid_integration_test_cards`, deletes `TEST-%` subscribers/packages/radius rows, lab `nas_devices`/`nas` in `192.0.2.0/24`, and related `sessions` / `session_interim_updates`.
- **Renamed** BullMQ queue to **`future-radius-jobs`** (`api/src/lib/bullmq-queue-name.ts`) in API task queue, worker, and observability.
- **MikroTik ROS sync** now targets **`nas_devices`** with API enabled, logs to **`router_commands_log`**, updates **`router_sync_status`**, records **`router_sync_errors`** on failure, increments **`futureradius_router_api_failures_total`**, and uses **`mikrotik_session_cache`** keyed by **`nas_devices.id`** (VARCHAR) after migration reset.
- **REST kick** (`mikrotik-kick.service.ts`) logs every attempt to `router_commands_log` and increments router API failure counter on failure.
- **Session engine**: `session-engine.service.ts` reconciles `sessions` from `radacct` with states **ONLINE**, **STUCK** (stale heartbeat), **OFFLINE**; invoked at end of each usage/quota cycle.
- **Metrics**: Added `futureradius_radius_auth_accept_total`, `futureradius_radius_auth_reject_total`, `futureradius_radius_accounting_updates_total`, `futureradius_router_api_failures_total`; renamed quota/expiry counters to **`futureradius_expired_users_total`** and **`futureradius_quota_exceeded_total`** (Grafana dashboards updated). Deprecated `futureradius_synth_check_total` retained as zero for backward compatibility with any external scrape configs.
- **Prometheus alert**: `SyntheticRadiusFailing` replaced with **`RadiusAuthDegraded`** based on radpostauth-derived counters.
- **Worker refactor**: BullMQ job dispatch moved to **`api/src/workers/dispatch-worker-job.ts`**; `workers/index.ts` handles bootstrap, metrics server, and `dispatchWorkerJob`. Worker options: **`lockDuration: 240000`**, **`stalledInterval: 120000`**. Job enqueue paths already use retries + exponential backoff.
- **Structured logging**: Usage cycle emits `log.info("usage_cycle_summary", { ... }, "usage-worker")`.
- **System Health UI**: KPI now shows **RADIUS rejects (radpostauth)** via `radius_auth_reject_per_sec` instead of synthetic probe rate.

---

## 3. Modified / added files (summary)

| Area | Files |
|------|--------|
| Migrations | `sql/migrations/006_integration_test_cleanup.sql` (replaces old 006 prepaid), **`sql/migrations/007_production_indexes_router_session_ops.sql`** (new) |
| Removed | `sql/migrations/006_prepaid_integration_test_cards.sql`, `api/src/services/synthetic-radius.service.ts`, `api/src/scripts/radius-nas-integration-test.ts`, `reports/radius-nas-integration-test-*.md` (8) |
| Core | `api/src/lib/bullmq-queue-name.ts`, `api/src/services/task-queue.service.ts`, `api/src/workers/index.ts`, **`api/src/workers/dispatch-worker-job.ts`**, `api/src/worker/usage.worker.ts`, `api/src/workers/enterprise-analytics.worker.ts` |
| Services | `api/src/services/metrics.service.ts`, `api/src/services/mikrotik-ros-sync.service.ts`, `api/src/services/mikrotik-kick.service.ts`, **`api/src/services/router-command-log.service.ts`**, **`api/src/services/session-engine.service.ts`** |
| API / UI | `api/src/routes/observability.routes.ts`, `api/src/services/remediation.service.ts`, `frontend/src/pages/SystemHealth.tsx` |
| Ops | `docker-compose.yml` (worker env), `docker/prometheus/rules/futureradius.yml`, `docker/grafana/dashboards/01-aaa.json`, `docker/grafana/dashboards/03-worker.json` |
| Package | `api/package.json` (removed `test:radius-integration`) |

---

## 4. Migrations

| File | Purpose |
|------|---------|
| `006_integration_test_cleanup.sql` | Drop test prepaid table; delete `TEST-*` and lab NAS data |
| `007_production_indexes_router_session_ops.sql` | Router ops tables, `sessions` state columns, indexes, `mikrotik_session_cache` reset |

---

## 5. Legacy dependencies

- **DMA / Radius Manager / rm\_***: No application references found (only unrelated npm integrity substrings in lockfiles).
- **`nas_servers`**: Still supported in **CoA** and **MikroTik kick** for encrypted-secret legacy installs only — not removed to avoid breaking existing deployments. MikroTik **session sync** is **`nas_devices`**-only (source of truth remains DB + RADIUS).

---

## 6. Removed temporary test artifacts

- Integration test **Markdown reports** (8 files under `reports/`).
- **`radius-nas-integration-test.ts`** and **`test:radius-integration`** npm script.
- **`synthetic-radius.service.ts`** and repeatable job **`synth-radius-probe`**.
- Migration **`006_prepaid_integration_test_cards.sql`** replaced by cleanup migration.

---

## 7. Remaining warnings / operational notes

- **BullMQ queue rename**: Existing Redis keys under `bull:radius-manager:*` are **not** auto-migrated. After deploy, **drain or flush** old queue keys if needed, or let them expire; new repeatables register under `bull:futureradius-jobs:*`.
- **`futureradius_radius_accounting_updates_total`**: Incremented from a **time-window COUNT** on `radacct.acctupdatetime` (approximate throughput signal, not per-packet).
- **`RadiusAuthDegraded` alert**: Tuned for “many rejects, almost no accepts”; tune thresholds for your real auth volume.
- **Schema**: Subscribers use **`expiration_date`** (not `expires_at`); semantics unchanged.
- **`router_sync_jobs`**: Table created for future job-queue patterns; not yet populated by code paths.

---

## 8. Validation results

| Command | Result |
|---------|--------|
| `npm test` (in `api/`) | **PASS** — 31 tests |
| `npm run build` (in `api/`) | **PASS** — `tsc` |
| `npm run build` (in `frontend/`) | **PASS** — `vite build` |
| `docker compose config` | **PASS** |

---

## 9. FreeRADIUS / subscription notes (verified in code)

- **Auth / quota / expiry**: `usage.worker` policy sweep, expiry handling, quota hard deny via `RadiusService.applyQuotaHardDeny`, and `subscriber-access` tests align with **DB + radcheck** as enforcement layer.
- **Accounting “active” sessions**: `AccountingService` uses heartbeat freshness, not raw `acctstoptime IS NULL` alone, for online counts.
- **Speed**: Package `mikrotik_rate_limit` continues to flow through `RadiusService` → `radreply` (`Mikrotik-Rate-Limit`); Session-Timeout handled via package/subscriber expiration paths already in place.

---

## 10. Target architecture (post-audit)

| Layer | Role |
|-------|------|
| **MySQL** | Source of truth for subscribers, packages, billing, NAS devices, sessions projection |
| **FreeRADIUS** | RADIUS authentication/accounting authority (`radcheck`, `radreply`, `radacct`, `radpostauth`, `nas`) |
| **MikroTik** | NAS, CoA target, optional RouterOS API **read/sync** (not authoritative for billing) |
| **Workers** | Async jobs on **`future-radius-jobs`**, modular dispatch, locks, retries |
| **Observability** | Structured logs + Prometheus counters/alerts aligned with production signals |

---

*End of report.*
