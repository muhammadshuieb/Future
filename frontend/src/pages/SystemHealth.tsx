import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useI18n } from "../context/LocaleContext";

type RemediationStep = { i18n: string; command?: string };

type RemediationEntry = {
  alertname: string;
  severity: "info" | "warning" | "critical";
  cause_i18n: string;
  steps: RemediationStep[];
};

type SystemHealthData = {
  generated_at: string;
  live: {
    open_sessions: number | null;
    active_subscribers: number | null;
    mysql_pool: {
      total: number | null;
      used: number | null;
      free: number | null;
      queued: number | null;
    };
    queue_lag_seconds: number | null;
    process: {
      uptime_seconds: number;
      memory: { rss: number; heapUsed: number; heapTotal: number };
    };
    disk: { total: number; used: number; free: number; pct: number; sampledAt: string } | null;
  };
  rates: {
    auth_fail_per_sec: number | null;
    radius_auth_reject_per_sec: number | null;
    coa_timeout_per_sec: number | null;
    worker_cycle_p95_seconds: number | null;
    http_requests_per_sec: number | null;
  };
  targets_up: { job: string; instance: string; up: boolean }[];
  coa_by_nas: Record<string, { ok: number; fail: number; timeout: number; encode_error: number }>;
  alerts: {
    alertname: string;
    severity: string;
    summary: string;
    description: string;
    instances: { labels: Record<string, string>; startsAt: string }[];
    remediation: RemediationEntry | null;
  }[];
  symptoms: RemediationEntry[];
  grafana_url: string | null;
};

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function formatUptime(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function severityBadge(severity: string): { bg: string; text: string; label: string } {
  switch (severity) {
    case "critical":
      return { bg: "bg-red-500/15 border-red-500/40", text: "text-red-700 dark:text-red-300", label: "CRITICAL" };
    case "warning":
      return { bg: "bg-amber-500/15 border-amber-500/40", text: "text-amber-700 dark:text-amber-300", label: "WARNING" };
    default:
      return { bg: "bg-sky-500/15 border-sky-500/40", text: "text-sky-700 dark:text-sky-300", label: "INFO" };
  }
}

function statColour(ok: boolean, warn = false): string {
  if (warn) return "text-amber-600 dark:text-amber-300";
  return ok ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300";
}

export function SystemHealthPage() {
  const { t } = useI18n();
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/observability/system-health");
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      setData((await res.json()) as SystemHealthData);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh every 15 seconds — matches Prometheus default scrape interval
  // so the page never lags behind by more than one cycle.
  useEffect(() => {
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const memUsedMb = data ? Math.round((data.live.process.memory.rss || 0) / 1024 / 1024) : 0;
  const memHigh = memUsedMb > 768;
  const diskPct = data?.live.disk?.pct ?? 0;
  const diskHigh = diskPct >= 85;
  const queueLag = data?.live.queue_lag_seconds ?? 0;
  const queueHigh = queueLag > 60;

  const poolTotal = data?.live.mysql_pool.total ?? 0;
  const poolUsed = data?.live.mysql_pool.used ?? 0;
  const poolPct = poolTotal > 0 ? Math.round((poolUsed / poolTotal) * 100) : 0;

  const coaRows = useMemo(() => {
    if (!data) return [] as { nas: string; ok: number; fail: number; timeout: number; encode_error: number }[];
    return Object.entries(data.coa_by_nas).map(([nas, v]) => ({ nas, ...v }));
  }, [data]);

  const targetSummary = useMemo(() => {
    if (!data) return { up: 0, total: 0 };
    return {
      up: data.targets_up.filter((t) => t.up).length,
      total: data.targets_up.length,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("systemHealth.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("systemHealth.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.grafana_url ? (
            <a
              href={data.grafana_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))]/40"
            >
              {t("systemHealth.openGrafana")}
            </a>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {/* Active alerts — most operationally important section, rendered first */}
      <section>
        <h2 className="mb-3 text-base font-semibold">{t("systemHealth.activeAlerts")}</h2>
        {data && data.alerts.length === 0 && data.symptoms.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-emerald-600 dark:text-emerald-300">
              ✓ {t("systemHealth.allClear")}
            </p>
          </Card>
        ) : null}
        <div className="space-y-3">
          {data?.alerts.map((alert) => {
            const badge = severityBadge(alert.severity);
            return (
              <Card key={alert.alertname} className={`border ${badge.bg} p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                      <h3 className="text-sm font-semibold">{alert.alertname}</h3>
                    </div>
                    <p className="mt-1 text-sm opacity-90">{alert.summary || alert.description}</p>
                  </div>
                  <span className="text-xs opacity-60">
                    {alert.instances[0]?.startsAt
                      ? new Date(alert.instances[0].startsAt).toLocaleString()
                      : ""}
                  </span>
                </div>

                {alert.instances.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {alert.instances.slice(0, 8).map((inst, i) => (
                      <span
                        key={i}
                        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-2 py-0.5 text-[10px] font-mono"
                      >
                        {Object.entries(inst.labels)
                          .filter(([k]) => k !== "alertname" && k !== "severity")
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" ")}
                      </span>
                    ))}
                  </div>
                ) : null}

                {alert.remediation ? <RemediationCard entry={alert.remediation} t={t} /> : null}
              </Card>
            );
          })}

          {data?.symptoms.map((s) => (
            <Card key={s.alertname} className="border bg-amber-500/10 border-amber-500/40 p-5">
              <div className="flex items-center gap-2">
                <span className="rounded-full border bg-amber-500/15 border-amber-500/40 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  PRE-ALERT
                </span>
                <h3 className="text-sm font-semibold">{t(`remediation.${s.alertname}.title`)}</h3>
              </div>
              <RemediationCard entry={s} t={t} />
            </Card>
          ))}
        </div>
      </section>

      {/* Live KPIs row */}
      <section>
        <h2 className="mb-3 text-base font-semibold">{t("systemHealth.liveKpis")}</h2>
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Kpi
            title={t("systemHealth.kpi.openSessions")}
            value={String(data?.live.open_sessions ?? "—")}
            subtitle={t("systemHealth.kpi.openSessions.hint")}
          />
          <Kpi
            title={t("systemHealth.kpi.activeSubscribers")}
            value={String(data?.live.active_subscribers ?? "—")}
            subtitle={t("systemHealth.kpi.activeSubscribers.hint")}
          />
          <Kpi
            title={t("systemHealth.kpi.queueLag")}
            value={`${formatNumber(queueLag, 0)}s`}
            subtitle={t("systemHealth.kpi.queueLag.hint")}
            valueClassName={statColour(!queueHigh, queueLag > 30 && !queueHigh)}
          />
          <Kpi
            title={t("systemHealth.kpi.workerP95")}
            value={`${formatNumber(data?.rates.worker_cycle_p95_seconds, 2)}s`}
            subtitle={t("systemHealth.kpi.workerP95.hint")}
          />
          <Kpi
            title={t("systemHealth.kpi.authFailRate")}
            value={`${formatNumber(data?.rates.auth_fail_per_sec, 2)}/s`}
            subtitle={t("systemHealth.kpi.authFailRate.hint")}
            valueClassName={statColour((data?.rates.auth_fail_per_sec ?? 0) <= 0.5)}
          />
          <Kpi
            title="RADIUS rejects (radpostauth)"
            value={`${formatNumber(data?.rates.radius_auth_reject_per_sec, 2)}/s`}
            subtitle="Worker-sampled reject rate from FreeRADIUS post-auth log"
            valueClassName={statColour((data?.rates.radius_auth_reject_per_sec ?? 0) < 1)}
          />
          <Kpi
            title={t("systemHealth.kpi.coaTimeouts")}
            value={`${formatNumber(data?.rates.coa_timeout_per_sec, 2)}/s`}
            subtitle={t("systemHealth.kpi.coaTimeouts.hint")}
            valueClassName={statColour((data?.rates.coa_timeout_per_sec ?? 0) === 0)}
          />
          <Kpi
            title={t("systemHealth.kpi.httpReqs")}
            value={`${formatNumber(data?.rates.http_requests_per_sec, 1)}/s`}
            subtitle={t("systemHealth.kpi.httpReqs.hint")}
          />
        </div>
      </section>

      {/* Server resource cards */}
      <section>
        <h2 className="mb-3 text-base font-semibold">{t("systemHealth.serverHealth")}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-5">
            <h3 className="text-sm font-semibold opacity-80">{t("systemHealth.memory")}</h3>
            <p className={`mt-2 text-2xl font-bold ${memHigh ? "text-amber-600 dark:text-amber-300" : ""}`}>
              {memUsedMb} MB
            </p>
            <p className="mt-1 text-xs opacity-70">
              heapUsed {Math.round((data?.live.process.memory.heapUsed ?? 0) / 1024 / 1024)} MB
            </p>
            <p className="mt-1 text-xs opacity-70">
              uptime {formatUptime(data?.live.process.uptime_seconds)}
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold opacity-80">{t("systemHealth.disk")}</h3>
            <p className={`mt-2 text-2xl font-bold ${diskHigh ? "text-red-600 dark:text-red-300" : ""}`}>
              {data?.live.disk ? `${diskPct.toFixed(1)}%` : "—"}
            </p>
            <p className="mt-1 text-xs opacity-70">
              {data?.live.disk
                ? `${formatBytes(data.live.disk.used)} / ${formatBytes(data.live.disk.total)}`
                : t("systemHealth.disk.unavailable")}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]/40">
              <div
                className={`h-full ${diskHigh ? "bg-red-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, diskPct)}%` }}
              />
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold opacity-80">{t("systemHealth.mysqlPool")}</h3>
            <p className="mt-2 text-2xl font-bold">
              {poolUsed}/{poolTotal} <span className="text-sm opacity-60">({poolPct}%)</span>
            </p>
            <p className="mt-1 text-xs opacity-70">
              {t("systemHealth.mysqlPool.free")}: {data?.live.mysql_pool.free ?? "—"}
            </p>
            <p className="mt-1 text-xs opacity-70">
              {t("systemHealth.mysqlPool.queued")}: {data?.live.mysql_pool.queued ?? 0}
            </p>
          </Card>
        </div>
      </section>

      {/* Prometheus targets */}
      <section>
        <h2 className="mb-3 text-base font-semibold">
          {t("systemHealth.targets")}{" "}
          <span className="text-xs opacity-70">
            ({targetSummary.up}/{targetSummary.total})
          </span>
        </h2>
        <Card className="p-5">
          {data && data.targets_up.length === 0 ? (
            <p className="text-xs opacity-70">{t("systemHealth.targets.unavailable")}</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {data?.targets_up.map((tgt, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">{tgt.job}</span>
                    <span className="ml-2 font-mono text-xs opacity-70">{tgt.instance}</span>
                  </div>
                  <span className={`text-xs font-semibold ${tgt.up ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}>
                    {tgt.up ? "UP" : "DOWN"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* CoA breakdown — answers "which MikroTik is failing CoA?" */}
      <section>
        <h2 className="mb-3 text-base font-semibold">{t("systemHealth.coaTitle")}</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-[hsl(var(--muted))]/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">NAS</th>
                <th className="px-3 py-2 font-medium">{t("systemHealth.coa.ok")}</th>
                <th className="px-3 py-2 font-medium">{t("systemHealth.coa.timeout")}</th>
                <th className="px-3 py-2 font-medium">{t("systemHealth.coa.fail")}</th>
                <th className="px-3 py-2 font-medium">{t("systemHealth.coa.encodeError")}</th>
              </tr>
            </thead>
            <tbody>
              {coaRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-xs opacity-60">
                    {t("systemHealth.coa.empty")}
                  </td>
                </tr>
              ) : (
                coaRows.map((row) => (
                  <tr key={row.nas} className="border-t border-[hsl(var(--border))]">
                    <td className="px-3 py-2 font-mono text-xs">{row.nas}</td>
                    <td className="px-3 py-2">{row.ok.toFixed(0)}</td>
                    <td className={`px-3 py-2 ${row.timeout > 0 ? "text-red-600 dark:text-red-300 font-semibold" : ""}`}>
                      {row.timeout.toFixed(0)}
                    </td>
                    <td className={`px-3 py-2 ${row.fail > 0 ? "text-amber-600 dark:text-amber-300" : ""}`}>
                      {row.fail.toFixed(0)}
                    </td>
                    <td className="px-3 py-2">{row.encode_error.toFixed(0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>

      <p className="text-[11px] opacity-50">
        {t("systemHealth.lastUpdated")}: {data?.generated_at ? new Date(data.generated_at).toLocaleString() : "—"}
      </p>
    </div>
  );
}

function Kpi({
  title,
  value,
  subtitle,
  valueClassName,
}: {
  title: string;
  value: string;
  subtitle?: string;
  valueClassName?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold opacity-70">{title}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${valueClassName ?? ""}`}>{value}</p>
      {subtitle ? <p className="mt-1 text-[11px] opacity-60">{subtitle}</p> : null}
    </Card>
  );
}

function RemediationCard({ entry, t }: { entry: RemediationEntry; t: (k: string) => string }) {
  return (
    <details className="mt-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 p-3 text-sm">
      <summary className="cursor-pointer select-none font-medium">
        {t("systemHealth.howToFix")}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-sm opacity-90">
          <span className="font-semibold">{t("systemHealth.likelyCause")}: </span>
          {t(entry.cause_i18n)}
        </p>
        <ol className="list-decimal space-y-2 ps-5">
          {entry.steps.map((step, i) => (
            <li key={i} className="space-y-1">
              <p>{t(step.i18n)}</p>
              {step.command ? (
                <pre className="overflow-x-auto rounded-md bg-black/80 p-2 text-[11px] text-green-300">
                  <code>{step.command}</code>
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
