import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Info,
  Bug,
  ShieldAlert,
  RefreshCw,
  Trash2,
  Download,
  Play,
  Pause,
  ChevronRight,
} from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField, SelectField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/utils";

type LogRow = {
  id: number;
  created_at: string;
  level: "error" | "warn" | "info" | "debug";
  source: string;
  category: string | null;
  message: string;
  stack: string | null;
  meta: Record<string, unknown> | null;
};

type LogsResponse = {
  items: LogRow[];
  totals: Record<"error" | "warn" | "info" | "debug", number>;
  sources: { source: string; count: number }[];
};

const LEVEL_STYLES: Record<LogRow["level"], { tile: string; text: string; ring: string; Icon: typeof AlertTriangle }> = {
  error: {
    tile: "bg-red-500/15 text-red-500",
    text: "text-red-600 dark:text-red-400",
    ring: "ring-red-500/30",
    Icon: ShieldAlert,
  },
  warn: {
    tile: "bg-amber-500/15 text-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    ring: "ring-amber-500/30",
    Icon: AlertTriangle,
  },
  info: {
    tile: "bg-sky-500/15 text-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    ring: "ring-sky-500/30",
    Icon: Info,
  },
  debug: {
    tile: "bg-violet-500/15 text-violet-500",
    text: "text-violet-600 dark:text-violet-400",
    ring: "ring-violet-500/30",
    Icon: Bug,
  },
};

export function ServerLogsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [level, setLevel] = useState<"" | LogRow["level"]>("");
  const [source, setSource] = useState<string>("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState<number>(250);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const mountedRef = useRef(true);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    if (source) params.set("source", source);
    if (q.trim()) params.set("q", q.trim());
    params.set("limit", String(limit));
    return params.toString();
  }, [level, source, q, limit]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/server-logs?${queryString}`);
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      const payload = (await res.json()) as LogsResponse;
      if (mountedRef.current) setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [queryString, t]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => void load(), 7_000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  async function handleClear(scope: "all" | "older_than_7_days") {
    const confirmMsg = scope === "all" ? t("logs.confirm_clear_all") : t("logs.confirm_clear_old");
    if (!window.confirm(confirmMsg)) return;
    try {
      const res = await apiFetch(`/api/server-logs?scope=${scope}`, { method: "DELETE" });
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleExport() {
    if (!data || data.items.length === 0) return;
    const lines = data.items.map((row) => {
      const stamp = row.created_at.replace("T", " ").slice(0, 23);
      const meta = row.meta ? ` meta=${JSON.stringify(row.meta)}` : "";
      const stack = row.stack ? `\n${row.stack}` : "";
      return `[${stamp}] ${row.level.toUpperCase()} ${row.source}${row.category ? `/${row.category}` : ""} — ${row.message}${meta}${stack}`;
    });
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `server-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const totals = data?.totals ?? { error: 0, warn: 0, info: 0, debug: 0 };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("logs.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("logs.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setAutoRefresh((v) => !v)}
            title={autoRefresh ? t("logs.pause_auto") : t("logs.resume_auto")}
          >
            {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {autoRefresh ? t("logs.auto_on") : t("logs.auto_off")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t("common.refresh")}
          </Button>
          <Button type="button" variant="outline" onClick={handleExport} disabled={!data?.items.length}>
            <Download className="h-4 w-4" />
            {t("logs.export")}
          </Button>
          {isAdmin ? (
            <>
              <Button type="button" variant="outline" onClick={() => void handleClear("older_than_7_days")}>
                <Trash2 className="h-4 w-4" />
                {t("logs.clear_old")}
              </Button>
              <Button type="button" variant="danger" onClick={() => void handleClear("all")}>
                <Trash2 className="h-4 w-4" />
                {t("logs.clear_all")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Totals */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        {(Object.keys(totals) as LogRow["level"][]).map((lvl) => {
          const style = LEVEL_STYLES[lvl];
          const Icon = style.Icon;
          return (
            <Card key={lvl} className="flex items-center gap-3">
              <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", style.tile)}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide opacity-60">{t(`logs.level_${lvl}`)}</div>
                <div className={cn("text-2xl font-bold", style.text)}>{totals[lvl]}</div>
                <div className="text-[11px] opacity-50">{t("logs.last_24h")}</div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card variant="subtle" className="flex flex-wrap items-end gap-3">
        <SelectField label={t("logs.level")} value={level} onChange={(e) => setLevel((e.target.value || "") as typeof level)} className="min-w-[10rem]">
          <option value="">{t("logs.all")}</option>
          <option value="error">{t("logs.level_error")}</option>
          <option value="warn">{t("logs.level_warn")}</option>
          <option value="info">{t("logs.level_info")}</option>
          <option value="debug">{t("logs.level_debug")}</option>
        </SelectField>
        <SelectField label={t("logs.source")} value={source} onChange={(e) => setSource(e.target.value)} className="min-w-[10rem]">
          <option value="">{t("logs.all")}</option>
          {(data?.sources ?? []).map((s) => (
            <option key={s.source} value={s.source}>
              {s.source} ({s.count})
            </option>
          ))}
        </SelectField>
        <TextField
          label={t("logs.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("logs.search_hint")}
          className="flex-1 min-w-[14rem]"
        />
        <SelectField label={t("logs.limit")} value={String(limit)} onChange={(e) => setLimit(Number(e.target.value) || 250)}>
          {[100, 250, 500, 1000].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectField>
      </Card>

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {/* Log stream */}
      <Card className="p-0">
        {data?.items.length === 0 && !loading ? (
          <p className="px-6 py-10 text-center text-sm opacity-70">{t("logs.empty")}</p>
        ) : null}
        <ul className="divide-y divide-[hsl(var(--border))]/60">
          {(data?.items ?? []).map((row) => {
            const style = LEVEL_STYLES[row.level];
            const Icon = style.Icon;
            const open = !!expanded[row.id];
            return (
              <li key={row.id} className="px-4 py-3 sm:px-6">
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                  className="flex w-full items-start gap-3 text-left"
                >
                  <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1", style.tile, style.ring)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={cn("rounded-full px-2 py-0.5 font-semibold uppercase", style.tile)}>{row.level}</span>
                      <span className="rounded-full bg-[hsl(var(--muted))]/60 px-2 py-0.5 font-medium">{row.source}</span>
                      {row.category ? (
                        <span className="rounded-full bg-[hsl(var(--muted))]/40 px-2 py-0.5 opacity-80">{row.category}</span>
                      ) : null}
                      <span className="font-mono opacity-60">
                        {row.created_at.replace("T", " ").slice(0, 19)}
                      </span>
                    </div>
                    <p className={cn("mt-1 break-words text-sm font-medium", style.text)}>{row.message}</p>
                  </div>
                  <ChevronRight className={cn("mt-2 h-4 w-4 shrink-0 opacity-60 transition-transform", open && "rotate-90")} />
                </button>
                {open && (row.stack || row.meta) ? (
                  <div className="mt-2 ms-11 space-y-2">
                    {row.meta ? (
                      <pre className="overflow-x-auto rounded-xl bg-[hsl(var(--muted))]/60 p-3 text-[11px] leading-relaxed opacity-85">
                        {JSON.stringify(row.meta, null, 2)}
                      </pre>
                    ) : null}
                    {row.stack ? (
                      <pre className="overflow-x-auto rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-[11px] leading-relaxed text-red-600 dark:text-red-300">
                        {row.stack}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
