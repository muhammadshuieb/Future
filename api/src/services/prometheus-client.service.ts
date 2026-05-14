/**
 * Thin client over Prometheus HTTP API + Alertmanager API used by the
 * "System Health" page. Both are optional; if PROMETHEUS_URL or
 * ALERTMANAGER_URL is unset we silently return empty results so the panel
 * still renders the in-process metrics it always has.
 *
 * Network model: in docker-compose the api container talks to prometheus and
 * alertmanager over the docker network using their service names — see
 * docker-compose.yml. Outside docker the env variables can point at any
 * reachable host:port.
 */

const PROM = (process.env.PROMETHEUS_URL || "http://prometheus:9090").replace(/\/+$/, "");
const ALERTMANAGER = (process.env.ALERTMANAGER_URL || "http://alertmanager:9093").replace(/\/+$/, "");
const TIMEOUT_MS = Math.max(500, Number(process.env.OBSERVABILITY_FETCH_TIMEOUT_MS) || 1500);

async function safeFetch<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface PromInstantSample {
  metric: Record<string, string>;
  value: [number, string]; // [unix_ts, value]
}

export interface PromInstantResponse {
  status: "success" | "error";
  data?: { resultType: "vector"; result: PromInstantSample[] };
}

export async function promQuery(expr: string): Promise<PromInstantSample[]> {
  const url = `${PROM}/api/v1/query?query=${encodeURIComponent(expr)}`;
  const r = await safeFetch<PromInstantResponse>(url);
  if (!r || r.status !== "success" || !r.data) return [];
  return r.data.result;
}

/** Convenience for queries that should return a single scalar. Returns null
 *  if Prometheus is unreachable or the result vector is empty. */
export async function promScalar(expr: string): Promise<number | null> {
  const rows = await promQuery(expr);
  if (rows.length === 0) return null;
  const v = Number(rows[0].value[1]);
  return Number.isFinite(v) ? v : null;
}

export interface AlertmanagerAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
  endsAt?: string;
  status: { state: "active" | "suppressed" | "unprocessed"; silencedBy?: string[] };
  fingerprint?: string;
}

export async function fetchActiveAlerts(): Promise<AlertmanagerAlert[]> {
  const url = `${ALERTMANAGER}/api/v2/alerts?active=true&silenced=false&inhibited=false`;
  const r = await safeFetch<AlertmanagerAlert[]>(url);
  return Array.isArray(r) ? r : [];
}

export async function fetchTargetsUp(): Promise<{ job: string; instance: string; up: boolean }[]> {
  const rows = await promQuery("up");
  return rows.map((row) => ({
    job: row.metric.job ?? "",
    instance: row.metric.instance ?? "",
    up: Number(row.value[1]) === 1,
  }));
}
