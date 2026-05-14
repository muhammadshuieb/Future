import client, { Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Central Prometheus registry for the API/worker process.
 *
 * Why a single shared registry:
 *   - `prom-client` defaults register globally; explicit naming makes scope obvious in tests.
 *   - The same module is imported by `worker/usage.worker.ts` so worker metrics live in the
 *     same registry that the api process exposes via `/metrics`. They share the same Node
 *     runtime through the `worker` service container; for split processes Prometheus would
 *     scrape each separately on its own /metrics port.
 *
 * Naming conventions follow Prometheus best practices:
 *   - snake_case, suffix `_total` for counters, `_seconds`/`_bytes` for histograms/gauges.
 *   - Labels stay low-cardinality (no usernames or per-user data ever).
 */
export const registry: Registry = new client.Registry();

client.collectDefaultMetrics({ register: registry, prefix: "futureradius_" });

export const httpRequestsTotal = new Counter({
  name: "futureradius_http_requests_total",
  help: "Count of HTTP requests handled by the API.",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "futureradius_http_request_duration_seconds",
  help: "HTTP request latency in seconds.",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const workerCycleDurationSeconds = new Histogram({
  name: "futureradius_worker_cycle_duration_seconds",
  help: "Duration of one usage/quota worker cycle.",
  labelNames: ["mode"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const expiredUsersTotal = new Counter({
  name: "futureradius_expired_users_total",
  help: "Subscribers transitioned to expired after CoA / RADIUS enforcement.",
  registers: [registry],
});

export const quotaExceededTotal = new Counter({
  name: "futureradius_quota_exceeded_total",
  help: "Subscribers suspended for lifetime quota exhaustion.",
  registers: [registry],
});

export const workerStaleSessionsClosedTotal = new Counter({
  name: "futureradius_worker_stale_sessions_closed_total",
  help: "Number of radacct rows closed because they exceeded STALE_SESSION_MINUTES with no Acct-Update.",
  registers: [registry],
});

export const coaDisconnectTotal = new Counter({
  name: "futureradius_coa_disconnect_total",
  help: "Count of CoA Disconnect-Request attempts grouped by NAS host and outcome.",
  labelNames: ["nas", "result"] as const,
  registers: [registry],
});

export const radiusOpenSessions = new Gauge({
  name: "futureradius_radius_open_sessions",
  help: "Open radacct rows (acctstoptime IS NULL) at last sample.",
  registers: [registry],
});

export const radiusActiveSubscribers = new Gauge({
  name: "futureradius_radius_active_subscribers",
  help: "Active subscribers (status = active).",
  registers: [registry],
});

export const mysqlQueryDurationSeconds = new Histogram({
  name: "futureradius_mysql_query_duration_seconds",
  help: "Duration of selected MySQL operations measured at the application layer.",
  labelNames: ["op"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const bullmqQueueLagSeconds = new Gauge({
  name: "futureradius_bullmq_queue_lag_seconds",
  help: "Time the oldest waiting job has been waiting in the BullMQ queue.",
  labelNames: ["queue"] as const,
  registers: [registry],
});

export const mysqlPoolConnections = new Gauge({
  name: "futureradius_mysql_pool_connections",
  help: "Snapshot of mysql2 pool connection counts.",
  labelNames: ["state"] as const, // total | free | used | queued
  registers: [registry],
});

export const authFailedTotal = new Counter({
  name: "futureradius_auth_failed_total",
  help: "Failed login attempts grouped by reason (panel + portal).",
  labelNames: ["surface", "reason"] as const,
  registers: [registry],
});

export const radiusAuthAcceptTotal = new Counter({
  name: "futureradius_radius_auth_accept_total",
  help: "FreeRADIUS Access-Accept rows observed in radpostauth since worker boot.",
  registers: [registry],
});

export const radiusAuthRejectTotal = new Counter({
  name: "futureradius_radius_auth_reject_total",
  help: "FreeRADIUS non-Accept replies observed in radpostauth since worker boot.",
  registers: [registry],
});

export const radiusAccountingUpdatesTotal = new Counter({
  name: "futureradius_radius_accounting_updates_total",
  help: "Approximate radacct accounting touches sampled during RADIUS monitor cycles.",
  registers: [registry],
});

export const routerApiFailuresTotal = new Counter({
  name: "futureradius_router_api_failures_total",
  help: "MikroTik RouterOS API call failures.",
  labelNames: ["command"] as const,
  registers: [registry],
});

/** @deprecated Synthetic probe removed; counter unused. */
export const synthCheckTotal = new Counter({
  name: "futureradius_synth_check_total",
  help: "Deprecated; kept so old Grafana panels do not break.",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const hostDiskBytes = new Gauge({
  name: "futureradius_host_disk_bytes",
  help: "Disk usage on a target mountpoint (bytes).",
  labelNames: ["mount", "state"] as const, // state: total | used | free
  registers: [registry],
});

/** Helper for ad-hoc instrumentation: `await timeMysql("usage_cycle", () => doWork())`. */
export async function timeMysql<T>(op: string, fn: () => Promise<T>): Promise<T> {
  const end = mysqlQueryDurationSeconds.startTimer({ op });
  try {
    return await fn();
  } finally {
    end();
  }
}

/**
 * Cached gauge sampler. /metrics may be scraped every 5–15s; we don't want to hit
 * MySQL with two COUNT(*) queries every scrape because on a multi-million-row radacct
 * COUNT can take seconds. The sampler memoises results for `ttlMs` (default 30s).
 */
export class CachedGaugeSampler {
  private last = 0;
  private inFlight: Promise<void> | null = null;
  constructor(
    private readonly ttlMs: number,
    private readonly sampler: () => Promise<void>
  ) {}

  /** Trigger a refresh if cache is older than ttlMs. Returns immediately on cache hit. */
  async maybeRefresh(): Promise<void> {
    const now = Date.now();
    if (now - this.last < this.ttlMs) return;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        await this.sampler();
        this.last = Date.now();
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }
}
