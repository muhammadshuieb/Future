import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { Card } from "../components/ui/Card";
import { apiFetch, getStaffToken } from "../lib/api";
import {
  Wifi,
  Users,
  Clock,
  HardDrive,
  Server,
  Search,
  Cloud,
  CheckCircle2,
  XCircle,
  MessageCircle,
  AlertTriangle,
  TrendingUp,
  Activity,
  RefreshCw,
  Radio,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../context/LocaleContext";
import { cn } from "../lib/utils";

type OperationalAlert = {
  severity: "critical" | "warning" | "info";
  code: string;
  meta?: { nas_offline?: number };
};

type Summary = {
  total_subscribers: number;
  active_subscribers: number;
  expired_subscribers: number;
  disabled_subscribers: number;
  online_users: number;
  total_bandwidth_bytes: number;
  bandwidth_today_bytes: number;
  nas: { total: number; online: number; offline: number };
  freeradius: {
    status: "ok" | "degraded" | "stale" | "unknown";
    open_sessions: number;
    last_accounting_at: string | null;
  };
  alerts: OperationalAlert[];
  backup: {
    last_status: "none" | "running" | "success" | "failed";
    last_success_at: string | null;
    last_failed_at: string | null;
    last_error: string | null;
    has_recent_failure: boolean;
    rclone_enabled: boolean;
    rclone_connected: boolean;
    rclone_last_error: string | null;
    daily_backup_uploaded: boolean;
    daily_backup_at: string | null;
  };
  whatsapp: {
    enabled: boolean;
    configured: boolean;
    connected: boolean;
    reminder_days: number;
    auto_send_new: boolean;
    last_error: string | null;
    last_check_at: string | null;
  };
  host?: {
    hostname: string;
    platform: string;
    uptime_seconds: number;
    load_avg_1m: number;
    cpu_count: number;
    memory_total_bytes: number;
    memory_used_bytes: number;
    memory_used_percent: number;
  };
};

type Tone = "blue" | "amber" | "green" | "violet" | "emerald" | "rose" | "cyan" | "indigo";

const WS_DEBOUNCE_MS = 1200;
const AUTO_REFRESH_MS = 60_000;

export function DashboardPage() {
  const { t, isRtl, locale } = useI18n();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [growth, setGrowth] = useState<{ period: string; total: number }[]>([]);
  const [wsMsg, setWsMsg] = useState<string | null>(null);
  const [subscriberSearch, setSubscriberSearch] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(async (opts?: { manual?: boolean; showInitial?: boolean }) => {
    const showInit = opts?.showInitial ?? false;
    const manual = opts?.manual ?? false;
    if (manual) setManualRefreshing(true);
    try {
      if (showInit) setInitialLoading(true);
      const s = await apiFetch("/api/dashboard/summary");
      if (s.ok) setSummary((await s.json()) as Summary);
      const g = await apiFetch("/api/dashboard/charts/subscribers");
      if (g.ok) setGrowth(((await g.json()) as { items: { period: string; total: number }[] }).items);
      setLastUpdated(new Date());
    } finally {
      if (showInit) setInitialLoading(false);
      if (manual) setManualRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAll({ showInitial: true });
  }, [loadAll]);

  useEffect(() => {
    const id = window.setInterval(() => void loadAll(), AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadAll]);

  useEffect(() => {
    const tok = getStaffToken();
    if (!tok) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}://${host}/ws?token=${encodeURIComponent(tok)}`);

    const scheduleDebouncedReload = () => {
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void loadAll();
      }, WS_DEBOUNCE_MS);
    };

    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string) as {
          type?: string;
          name?: string;
          ip?: string;
          tenant_id?: string;
        };
        if (d.type === "connected") return;
        scheduleDebouncedReload();
        if (d.type === "nas_status") setWsMsg(`NAS: ${d.name ?? d.ip ?? "update"}`);
      } catch {
        scheduleDebouncedReload();
      }
    };
    return () => {
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      ws.close();
    };
  }, [loadAll]);

  useEffect(() => {
    if (!wsMsg) return;
    const fade = window.setTimeout(() => setWsMsg(null), 10_000);
    return () => clearTimeout(fade);
  }, [wsMsg]);

  const formattedLastUpdated = useMemo(() => {
    if (!lastUpdated) return null;
    return lastUpdated.toLocaleString(locale === "ar" ? "ar-SA" : "en-GB", {
      dateStyle: "short",
      timeStyle: "medium",
    });
  }, [lastUpdated, locale]);

  const fmtUptime = (sec: number) => {
    if (!sec || sec < 0) return "—";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const fmtBytes = (n: number) => {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let x = n;
    let i = 0;
    while (x >= 1024 && i < u.length - 1) {
      x /= 1024;
      i++;
    }
    return `${x.toFixed(1)} ${u[i]}`;
  };

  const activeRatio =
    summary && summary.total_subscribers > 0
      ? Math.round((summary.active_subscribers / summary.total_subscribers) * 100)
      : 0;
  const nasOnlineRatio = summary ? Math.round((summary.nas.online / Math.max(1, summary.nas.total)) * 100) : 0;
  const hostLoadRatio =
    summary?.host && summary.host.cpu_count > 0
      ? Math.min(100, Math.round((summary.host.load_avg_1m / summary.host.cpu_count) * 100))
      : 0;

  const freeradiusLabel = (status: Summary["freeradius"]["status"]) => {
    if (status === "ok") return t("dash.freeradiusOk");
    if (status === "degraded") return t("dash.freeradiusDegraded");
    if (status === "stale") return t("dash.freeradiusStale");
    return t("dash.freeradiusUnknown");
  };

  const formatAlertBody = (a: OperationalAlert) => {
    const key = `dash.alert.${a.code}`;
    const raw = t(key);
    if (a.meta?.nas_offline != null) return raw.replace(/\{n\}/g, String(a.meta.nas_offline));
    return raw === key ? a.code.replace(/_/g, " ") : raw;
  };

  const FinanceChevron = isRtl ? ChevronLeft : ChevronRight;

  const StatCardCompact = ({
    label,
    value,
    Icon,
    tone,
    delay,
    hint,
  }: {
    label: string;
    value: string | number;
    Icon: LucideIcon;
    tone: Tone;
    delay: number;
    hint?: string;
  }) => {
    const palettes: Record<Tone, { bg: string; text: string; ring: string }> = {
      blue: { bg: "bg-blue-500/10", text: "text-blue-500", ring: "ring-blue-500/20" },
      amber: { bg: "bg-amber-500/10", text: "text-amber-500", ring: "ring-amber-500/20" },
      green: { bg: "bg-green-500/10", text: "text-green-500", ring: "ring-green-500/20" },
      violet: { bg: "bg-violet-500/10", text: "text-violet-500", ring: "ring-violet-500/20" },
      emerald: { bg: "bg-emerald-500/10", text: "text-emerald-500", ring: "ring-emerald-500/20" },
      rose: { bg: "bg-rose-500/10", text: "text-rose-500", ring: "ring-rose-500/20" },
      cyan: { bg: "bg-cyan-500/10", text: "text-cyan-500", ring: "ring-cyan-500/20" },
      indigo: { bg: "bg-indigo-500/10", text: "text-indigo-500", ring: "ring-indigo-500/20" },
    };
    const s = palettes[tone];
    return (
      <Card delay={delay * 0.04} className={cn("border-[hsl(var(--border))]/80 !p-3", "")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium opacity-65">{label}</div>
            <div className="mt-1.5 truncate text-xl font-semibold tracking-tight tabular-nums">{value}</div>
            {hint ? <div className="mt-1 line-clamp-2 text-[10px] opacity-55">{hint}</div> : null}
          </div>
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1", s.bg, s.text, s.ring)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </Card>
    );
  };

  const StatusPill = ({ ok, text }: { ok: boolean; text: string }) => (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {text}
    </span>
  );

  const ServiceCard = ({
    title,
    Icon,
    children,
    delay,
    toneClass,
  }: {
    title: string;
    Icon: LucideIcon;
    children: ReactNode;
    delay: number;
    toneClass: string;
  }) => (
    <Card delay={delay * 0.04} variant="subtle" className="border-[hsl(var(--border))]/70 !p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg ring-1", toneClass)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-xs font-semibold leading-tight">{title}</div>
      </div>
      <div className="space-y-1.5 text-[11px]">{children}</div>
    </Card>
  );

  const LoadingCard = () => (
    <Card className="!p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="h-2.5 w-24 animate-pulse rounded bg-[hsl(var(--muted))]" />
        <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-[hsl(var(--muted))]" />
      </div>
      <div className="mt-3 h-6 w-16 animate-pulse rounded bg-[hsl(var(--muted))]" />
    </Card>
  );

  return (
    <div className="space-y-4" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight lg:text-2xl">{t("dash.title")}</h1>
            <p className="text-xs opacity-70 lg:text-sm">{t("dash.subtitleOperational")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] opacity-65">
            {formattedLastUpdated ? (
              <span className="tabular-nums">
                {t("dash.lastUpdated")}: {formattedLastUpdated}
              </span>
            ) : null}
            <span className="hidden sm:inline opacity-40">•</span>
            <span>{t("dash.autoRefreshHint")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={manualRefreshing || initialLoading}
              onClick={() => void loadAll({ manual: true })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/70 px-3 py-1.5 text-xs font-semibold backdrop-blur transition",
                "hover:border-[hsl(var(--primary))]/40 hover:bg-[hsl(var(--muted))]/50",
                "disabled:pointer-events-none disabled:opacity-50"
              )}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", manualRefreshing && "animate-spin")} />
              {t("dash.refresh")}
            </button>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-stretch lg:w-auto lg:flex-col lg:items-stretch xl:flex-row xl:items-stretch">
          <Link to="/financial-dashboard" className="block flex-1 sm:flex-none xl:flex-initial">
            <Card
              delay={0.02}
              className={cn(
                "group h-full min-h-[3.25rem] border border-emerald-500/25 bg-emerald-500/[0.07] transition",
                "!p-3 hover:border-emerald-500/40 hover:bg-emerald-500/10 dark:bg-emerald-500/10"
              )}
            >
              <div className="flex h-full items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold leading-snug">{t("dash.openFinanceBoard")}</div>
                  <div className="mt-0.5 text-[10px] opacity-65">{t("dash.openFinanceBoardHint")}</div>
                </div>
                <FinanceChevron className="h-4 w-4 shrink-0 text-emerald-600 opacity-80 transition group-hover:translate-x-0.5 rtl:rotate-180 group-hover:rtl:-translate-x-0.5" />
              </div>
            </Card>
          </Link>
        </div>
      </div>

      {/* Search */}
      <Card className="flex flex-col gap-2 !p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500 ring-1 ring-indigo-500/20">
            <Search className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="text-xs font-semibold">{t("dash.searchSubscriber")}</div>
          </div>
        </div>
        <form
          className="flex w-full max-w-md flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = subscriberSearch.trim();
            if (!q) return;
            navigate(`/users?q=${encodeURIComponent(q)}`);
          }}
        >
          <div className="relative w-full">
            <Search className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-45 start-2.5" />
            <input
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 py-2 ps-8 text-xs outline-none backdrop-blur transition placeholder:opacity-50 focus:border-[hsl(var(--primary))]/50 focus:ring-1 focus:ring-[hsl(var(--primary))]/25"
              placeholder={t("dash.searchSubscriberPlaceholder")}
              value={subscriberSearch}
              onChange={(e) => setSubscriberSearch(e.target.value)}
            />
          </div>
        </form>
      </Card>

      {wsMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{wsMsg}</span>
        </div>
      )}

      {/* System alerts */}
      {summary?.alerts && summary.alerts.length > 0 && (
        <Card className="border-[hsl(var(--border))]/80 !p-3">
          <div className="mb-2 flex items-center gap-2">
            <LayoutGrid className="h-3.5 w-3.5 opacity-65" />
            <h2 className="text-xs font-semibold">{t("dash.systemAlertsTitle")}</h2>
          </div>
          <ul className="flex flex-col gap-1.5">
            {summary.alerts.map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-snug",
                  a.severity === "critical"
                    ? "border-red-500/35 bg-red-500/[0.07]"
                    : a.severity === "warning"
                      ? "border-amber-500/30 bg-amber-500/[0.06]"
                      : "border-[hsl(var(--border))]/80 bg-[hsl(var(--muted))]/35"
                )}
              >
                {a.severity === "info" ? (
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
                ) : (
                  <AlertTriangle
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0",
                      a.severity === "critical" ? "text-red-500" : "text-amber-500"
                    )}
                  />
                )}
                <span>{formatAlertBody(a)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {initialLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <LoadingCard key={i} />
          ))}
        </div>
      ) : null}

      {/* Operational snapshot */}
      {summary ? (
        <Card className="border-[hsl(var(--border))]/80 !p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/25">
                <Activity className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold">{t("dash.operationalSnapshot")}</span>
            </div>
            <span className="rounded-full bg-[hsl(var(--muted))]/50 px-2 py-0.5 text-[10px] opacity-75">
              {t("dash.subscriberShareActive")}: {activeRatio}%
            </span>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] sm:grid-cols-4 lg:grid-cols-8">
            <div>
              <div className="opacity-55">{t("dash.cpuLoadLabel")}</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(2, hostLoadRatio)}%` }} />
                </div>
                <span className="tabular-nums">{hostLoadRatio}%</span>
              </div>
            </div>
            <div>
              <div className="opacity-55">{t("dash.nasOnlineSlice")}</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(2, nasOnlineRatio)}%` }} />
                </div>
                <span className="tabular-nums">{nasOnlineRatio}%</span>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Subscriber metrics */}
      {summary && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-65">{t("dash.subscribersSection")}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCardCompact label={t("dash.totalSubscribers")} value={summary.total_subscribers} Icon={Users} tone="indigo" delay={0} hint={t("dash.totalSubscribersHint")} />
            <StatCardCompact label={t("dash.activeSub")} value={summary.active_subscribers} Icon={Users} tone="blue" delay={1} hint={t("dash.activeAccountsHint")} />
            <StatCardCompact label={t("dash.expired")} value={summary.expired_subscribers} Icon={Clock} tone="amber" delay={2} hint={t("dash.expiredByDateHint")} />
            <StatCardCompact label={t("dash.disabledSubscribers")} value={summary.disabled_subscribers} Icon={XCircle} tone="rose" delay={3} hint={t("dash.disabledHint")} />
            <StatCardCompact label={t("dash.onlineNow")} value={summary.online_users} Icon={Wifi} tone="green" delay={4} hint={t("dash.freshSessionsHint")} />
            <StatCardCompact label={t("dash.bandwidthToday")} value={fmtBytes(Number(summary.bandwidth_today_bytes))} Icon={HardDrive} tone="violet" delay={5} hint={t("dash.bandwidthTodayHint")} />
          </div>
        </div>
      )}

      {/* Integrated services */}
      {summary ? (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-65">{t("dash.integrationSection")}</h2>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <Card delay={0.05} variant="subtle" className="border-[hsl(var(--border))]/70 !p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
                  <Server className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="text-xs font-semibold">{t("dash.nasFleet")}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-lg bg-[hsl(var(--muted))]/40 py-2">
                  <div className="text-lg font-bold tabular-nums">{summary.nas.total}</div>
                  <div className="opacity-55">{t("dash.total")}</div>
                </div>
                <div className="rounded-lg bg-emerald-500/10 py-2 ring-1 ring-emerald-500/15">
                  <div className="text-lg font-bold tabular-nums text-emerald-600">{summary.nas.online}</div>
                  <div className="opacity-55">{t("dash.online")}</div>
                </div>
                <div className="rounded-lg bg-red-500/10 py-2 ring-1 ring-red-500/15">
                  <div className="text-lg font-bold tabular-nums text-red-600">{summary.nas.offline}</div>
                  <div className="opacity-55">{t("dash.offline")}</div>
                </div>
              </div>
            </Card>

            <ServiceCard
              title={t("dash.freeradiusTitle")}
              Icon={Radio}
              delay={1}
              toneClass="bg-cyan-500/10 text-cyan-600 ring-cyan-500/20 dark:text-cyan-400"
            >
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="opacity-65">{t("dash.freeradiusStatusLabel")}</span>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                    summary.freeradius.status === "ok"
                      ? "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400"
                      : summary.freeradius.status === "degraded"
                        ? "bg-amber-500/12 text-amber-800 ring-amber-500/25 dark:text-amber-300"
                        : summary.freeradius.status === "stale"
                          ? "bg-red-500/12 text-red-700 ring-red-500/25 dark:text-red-400"
                          : "bg-[hsl(var(--muted))]/60 text-[hsl(var(--foreground))]/80 ring-[hsl(var(--border))]"
                  )}
                >
                  {summary.freeradius.status === "ok" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {freeradiusLabel(summary.freeradius.status)}
                </span>
              </div>
              <div className="flex justify-between opacity-85">
                <span className="opacity-65">{t("dash.freeradiusOpenSessions")}</span>
                <span className="font-mono tabular-nums">{summary.freeradius.open_sessions}</span>
              </div>
              <div className="flex justify-between opacity-85">
                <span className="opacity-65">{t("dash.freeradiusLastAccounting")}</span>
                <span className="max-w-[60%] truncate text-end font-mono text-[10px]">
                  {summary.freeradius.last_accounting_at
                    ? new Date(summary.freeradius.last_accounting_at).toLocaleString(locale === "ar" ? "ar-SA" : "en-GB", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : t("dash.noneYet")}
                </span>
              </div>
            </ServiceCard>

            <ServiceCard
              title={t("dash.whatsappStatusTitle")}
              Icon={MessageCircle}
              delay={2}
              toneClass="bg-green-500/10 text-green-600 ring-green-500/20 dark:text-green-400"
            >
              <div className="flex justify-between gap-1">
                <span className="opacity-65">{t("dash.whatsappConnection")}</span>
                {summary.whatsapp.enabled ? (
                  <StatusPill ok={summary.whatsapp.connected} text={summary.whatsapp.connected ? t("dash.connected") : t("dash.disconnected")} />
                ) : (
                  <span className="rounded-full bg-[hsl(var(--muted))]/60 px-2 py-0.5 text-[10px] opacity-70">{t("dash.disabled")}</span>
                )}
              </div>
              <div className="flex justify-between opacity-85">
                <span className="opacity-65">{t("dash.whatsappReminderDays")}</span>
                <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-medium text-indigo-600">{summary.whatsapp.reminder_days}</span>
              </div>
            </ServiceCard>

            <ServiceCard title={t("dash.backupStatusTitle")} Icon={Cloud} delay={3} toneClass="bg-sky-500/10 text-sky-600 ring-sky-500/20 dark:text-sky-400">
              <div className="flex justify-between gap-1">
                <span className="opacity-65">{t("dash.rcloneStatus")}</span>
                {summary.backup.rclone_enabled ? (
                  <StatusPill ok={summary.backup.rclone_connected} text={summary.backup.rclone_connected ? t("dash.connected") : t("dash.disconnected")} />
                ) : (
                  <span className="rounded-full bg-[hsl(var(--muted))]/60 px-2 py-0.5 text-[10px] opacity-70">{t("dash.disabled")}</span>
                )}
              </div>
              <div className="flex justify-between gap-1">
                <span className="opacity-65">{t("dash.dailyBackupUpload")}</span>
                <StatusPill ok={summary.backup.daily_backup_uploaded} text={summary.backup.daily_backup_uploaded ? t("dash.uploadedToday") : t("dash.notUploadedToday")} />
              </div>
            </ServiceCard>
          </div>
        </div>
      ) : null}

      {/* Host */}
      {summary?.host ? (
        <Card className="!p-3">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500 ring-1 ring-indigo-500/20">
              <Server className="h-4 w-4" />
            </div>
            <h2 className="text-xs font-semibold">{t("dash.hostTitle")}</h2>
          </div>
          <dl className="grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div>
              <dt className="opacity-55">{t("dash.hostHostname")}</dt>
              <dd className="truncate font-mono font-medium">{summary.host.hostname}</dd>
            </div>
            <div>
              <dt className="opacity-55">{t("dash.hostPlatform")}</dt>
              <dd className="truncate font-mono">{summary.host.platform}</dd>
            </div>
            <div>
              <dt className="opacity-55">{t("dash.hostUptime")}</dt>
              <dd className="tabular-nums">{fmtUptime(summary.host.uptime_seconds)}</dd>
            </div>
            <div>
              <dt className="opacity-55">{t("dash.hostLoad")}</dt>
              <dd className="font-mono tabular-nums">{summary.host.load_avg_1m.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="opacity-55">{t("dash.hostCpus")}</dt>
              <dd>{summary.host.cpu_count}</dd>
            </div>
            <div>
              <dt className="opacity-55">{t("dash.hostRam")}</dt>
              <dd className="tabular-nums">
                {summary.host.memory_used_percent.toFixed(1)}% · {fmtBytes(summary.host.memory_used_bytes)} / {fmtBytes(summary.host.memory_total_bytes)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] opacity-45">{t("dash.hostFootnote")}</p>
        </Card>
      ) : null}

      <Card className="!p-3">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500 ring-1 ring-violet-500/25">
            <TrendingUp className="h-4 w-4" />
          </div>
          <h2 className="text-xs font-semibold">{t("dash.growth")}</h2>
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={growth}>
              <defs>
                <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={1} />
                  <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.45} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={36} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 10,
                  fontSize: 11,
                }}
              />
              <Bar dataKey="total" fill="url(#growthGrad)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
