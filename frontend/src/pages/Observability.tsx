import { useCallback, useEffect, useState } from "react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useI18n } from "../context/LocaleContext";

type ObservabilityData = {
  system: {
    uptime_seconds: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers: number;
    };
    redis_latency_ms: number;
    worker: {
      status: "online" | "offline";
      last_heartbeat_at: string | null;
    };
  };
  whatsapp: {
    connected: boolean;
    failed_24h: number;
    retried_24h: number;
    reminder_days: number;
    message_interval_seconds: number;
  } | null;
  jobs: {
    counts: Record<string, number>;
    queue_lag_seconds: number;
    repeatables: { name: string; next: string | null }[];
    last_failed: {
      id: string;
      name: string;
      failed_reason: string | null;
      attempts_made: number;
      timestamp: string | null;
    }[];
  };
  backup: {
    status?: string;
    started_at?: string | null;
    finished_at?: string | null;
    error_message?: string | null;
  } | null;
};

export function ObservabilityPage() {
  const { t } = useI18n();
  const [data, setData] = useState<ObservabilityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/observability/summary");
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      const payload = (await res.json()) as ObservabilityData;
      setData(payload);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setError(msg || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      void load();
    }, 10000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("observability.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("observability.subtitle")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          {t("common.refresh")}
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {!data && !loading ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          {t("observability.noData")}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{t("observability.wahaHealth")}</h3>
          <p>{data?.whatsapp?.connected ? t("dash.connected") : t("dash.disconnected")}</p>
          <p className="text-xs opacity-70">failed_24h: {data?.whatsapp?.failed_24h ?? 0}</p>
          <p className="text-xs opacity-70">retried_24h: {data?.whatsapp?.retried_24h ?? 0}</p>
        </Card>
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{t("observability.queueLag")}</h3>
          <p>{data?.jobs?.queue_lag_seconds ?? 0}s</p>
          <p className="text-xs opacity-70">waiting: {data?.jobs?.counts?.waiting ?? 0}</p>
          <p className="text-xs opacity-70">failed: {data?.jobs?.counts?.failed ?? 0}</p>
        </Card>
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{t("observability.backupHealth")}</h3>
          <p>{String(data?.backup?.status ?? "unknown")}</p>
          {data?.backup?.error_message ? <p className="text-xs text-red-600 dark:text-red-300">{data.backup.error_message}</p> : null}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{t("observability.workerStatus")}</h3>
          <p>{data?.system?.worker?.status ?? "offline"}</p>
          <p className="text-xs opacity-70">{data?.system?.worker?.last_heartbeat_at ?? "—"}</p>
        </Card>
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{t("observability.redisLatency")}</h3>
          <p>{data?.system?.redis_latency_ms ?? 0}ms</p>
          <p className="text-xs opacity-70">uptime: {data?.system?.uptime_seconds ?? 0}s</p>
        </Card>
        <Card className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{t("observability.memoryUsage")}</h3>
          <p className="text-xs">heapUsed: {Math.round((data?.system?.memory?.heapUsed ?? 0) / 1024 / 1024)} MB</p>
          <p className="text-xs">rss: {Math.round((data?.system?.memory?.rss ?? 0) / 1024 / 1024)} MB</p>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">{t("observability.repeatableJobs")}</h3>
        <div className="space-y-2 text-sm">
          {(data?.jobs.repeatables ?? []).map((job) => (
            <div key={job.name} className="flex items-center justify-between rounded-lg bg-[hsl(var(--muted))]/40 px-3 py-2">
              <span>{job.name}</span>
              <span className="font-mono text-xs opacity-75">{job.next ? job.next.replace("T", " ").slice(0, 19) : "—"}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">{t("observability.lastErrors")}</h3>
        <div className="space-y-2 text-sm">
          {(data?.jobs.last_failed ?? []).map((row) => (
            <div key={String(row.id)} className="rounded-lg border border-[hsl(var(--border))] p-3">
              <p className="font-medium">{row.name}</p>
              <p className="text-xs opacity-75">{row.timestamp ? row.timestamp.replace("T", " ").slice(0, 19) : "—"}</p>
              <p className="text-xs text-red-600 dark:text-red-300">{row.failed_reason || "—"}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
