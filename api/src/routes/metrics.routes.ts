import { Router, type Request, type Response, type NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../lib/db.js";
import { hasTable } from "../db/schemaGuards.js";
import {
  CachedGaugeSampler,
  mysqlPoolConnections,
  radiusActiveSubscribers,
  radiusOpenSessions,
  registry,
} from "../services/metrics.service.js";

const router = Router();

const GAUGE_TTL_MS = Math.max(5_000, Number(process.env.METRICS_GAUGE_TTL_MS) || 30_000);

const sampler = new CachedGaugeSampler(GAUGE_TTL_MS, async () => {
  if (await hasTable(pool, "radacct")) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM radacct WHERE acctstoptime IS NULL`
    );
    radiusOpenSessions.set(Number(rows[0]?.c ?? 0));
  }
  if (await hasTable(pool, "subscribers")) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM subscribers WHERE status = 'active'`
    );
    radiusActiveSubscribers.set(Number(rows[0]?.c ?? 0));
  }
  // mysql2 pool internals: best-effort introspection. mysql2 v3 wraps the
  // connection lists in `Denque` objects (which expose `.length` but are not
  // native arrays), so we read `.length` defensively rather than asserting types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internal = pool as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const innerPool: any = internal?.pool ?? internal;
  const lenOf = (v: unknown): number => {
    const n = (v as { length?: number })?.length;
    return typeof n === "number" && Number.isFinite(n) ? n : NaN;
  };
  const total = lenOf(innerPool?._allConnections);
  const free = lenOf(innerPool?._freeConnections);
  const queued = lenOf(innerPool?._connectionQueue);
  if (Number.isFinite(total)) mysqlPoolConnections.set({ state: "total" }, total);
  if (Number.isFinite(free)) mysqlPoolConnections.set({ state: "free" }, free);
  if (Number.isFinite(total) && Number.isFinite(free)) {
    mysqlPoolConnections.set({ state: "used" }, total - free);
  }
  if (Number.isFinite(queued)) mysqlPoolConnections.set({ state: "queued" }, queued);
});

/**
 * Optional bearer token guard. When METRICS_BEARER_TOKEN is set, /metrics requires
 * `Authorization: Bearer <token>` (Prometheus supports this natively via
 * `authorization.credentials` in scrape_configs). When unset (default), the endpoint
 * is open — the operator is expected to bind the api behind a private network or
 * restrict `/metrics` at the edge (reverse proxy / firewall).
 */
function metricsAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = (process.env.METRICS_BEARER_TOKEN || "").trim();
  if (!expected) {
    next();
    return;
  }
  const header = String(req.headers["authorization"] ?? "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1].trim() !== expected) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="metrics"');
    res.status(401).end("unauthorized");
    return;
  }
  next();
}

/**
 * Prometheus scrape endpoint.
 * Live gauges are sampled lazily through `CachedGaugeSampler` so high-frequency scrapes
 * don't multiply MySQL load. Cached for METRICS_GAUGE_TTL_MS (default 30s).
 */
router.get("/", metricsAuth, async (_req, res) => {
  try {
    await sampler.maybeRefresh();
  } catch (e) {
    console.warn("[metrics] gauge sampling failed:", e instanceof Error ? e.message : e);
  }
  res.setHeader("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

export default router;
