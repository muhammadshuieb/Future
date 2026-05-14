import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../context/LocaleContext";
import { cn } from "../lib/utils";

type Summary = {
  active_subscribers: number;
  expired_subscribers: number;
  online_users: number;
  total_bandwidth_bytes: number;
  nas: { total: number; online: number; offline: number };
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
const statTones: Record<Tone, { bg: string; text: string; ring: string; bar: string }> = {
  blue: { bg: "bg-blue-500/10", text: "text-blue-500", ring: "ring-blue-500/20", bar: "bg-blue-500" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-500", ring: "ring-amber-500/20", bar: "bg-amber-500" },
  green: { bg: "bg-green-500/10", text: "text-green-500", ring: "ring-green-500/20", bar: "bg-green-500" },
  violet: { bg: "bg-violet-500/10", text: "text-violet-500", ring: "ring-violet-500/20", bar: "bg-violet-500" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-500", ring: "ring-emerald-500/20", bar: "bg-emerald-500" },
  rose: { bg: "bg-rose-500/10", text: "text-rose-500", ring: "ring-rose-500/20", bar: "bg-rose-500" },
  cyan: { bg: "bg-cyan-500/10", text: "text-cyan-500", ring: "ring-cyan-500/20", bar: "bg-cyan-500" },
  indigo: { bg: "bg-indigo-500/10", text: "text-indigo-500", ring: "ring-indigo-500/20", bar: "bg-indigo-500" },
};

export function DashboardPage() {
  const { t, isRtl } = useI18n();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [growth, setGrowth] = useState<{ period: string; total: number }[]>([]);
  const [wsMsg, setWsMsg] = useState<string | null>(null);
  const [subscriberSearch, setSubscriberSearch] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoadingSummary(true);
      try {
        const s = await apiFetch("/api/dashboard/summary");
        if (s.ok) setSummary((await s.json()) as Summary);
      } finally {
        setLoadingSummary(false);
      }
    })();
    void (async () => {
      const g = await apiFetch("/api/dashboard/charts/subscribers");
      if (g.ok) setGrowth(((await g.json()) as { items: typeof growth }).items);
    })();
  }, []);

  useEffect(() => {
    const tok = getStaffToken();
    if (!tok) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}://${host}/ws?token=${encodeURIComponent(tok)}`);
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string) as { type?: string; name?: string; ip?: string };
        if (d.type === "nas_status") setWsMsg(`NAS: ${d.name ?? d.ip ?? "update"}`);
      } catch {
        setWsMsg(String(ev.data).slice(0, 80));
      }
    };
    return () => ws.close();
  }, []);

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
  const activeRatio = summary
    ? Math.round((summary.active_subscribers / Math.max(1, summary.active_subscribers + summary.expired_subscribers)) * 100)
    : 0;
  const nasOnlineRatio = summary ? Math.round((summary.nas.online / Math.max(1, summary.nas.total)) * 100) : 0;
  const hostLoadRatio = summary?.host ? Math.min(100, Math.round((summary.host.load_avg_1m / Math.max(1, summary.host.cpu_count)) * 100)) : 0;
  const statusLabel = t("dash.systemStatus");
  const healthyLabel = t("dash.systemStable");
  const refreshedLabel = t("dash.liveDataBadge");
  const StatCard = ({
    label,
    value,
    Icon,
    tone,
    delay,
    hint,
    progress,
  }: {
    label: string;
    value: string | number;
    Icon: LucideIcon;
    tone: Tone;
    delay: number;
    hint?: string;
    progress?: number;
  }) => {
    const s = statTones[tone];
    return (
      <Card delay={delay * 0.05} className="overflow-hidden border-[hsl(var(--border))]/80 p-0">
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-medium opacity-55">{label}</div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
            </div>
            <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl ring-1", s.bg, s.text, s.ring)}>
              <Icon className="h-5 w-5" />
            </div>
          </div>
          {hint ? <div className="mt-3 text-xs opacity-60">{hint}</div> : null}
          {typeof progress === "number" ? (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
              <div className={cn("h-full rounded-full", s.bar)} style={{ width: `${Math.max(3, Math.min(100, progress))}%` }} />
            </div>
          ) : null}
        </div>
      </Card>
    );
  };

  const LoadingCard = () => (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="h-3 w-28 animate-pulse rounded bg-[hsl(var(--muted))]" />
        <div className="h-10 w-10 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />
      </div>
      <div className="mt-5 h-8 w-20 animate-pulse rounded bg-[hsl(var(--muted))]" />
      <div className="mt-4 h-1.5 animate-pulse rounded-full bg-[hsl(var(--muted))]" />
    </Card>
  );

  const SystemOverview = () => {
    if (!summary) return null;
    return (
      <Card className="overflow-hidden p-0">
        <div className="grid gap-0 lg:grid-cols-[1.35fr_1fr]">
          <div className="border-b border-[hsl(var(--border))]/70 p-5 lg:border-b-0 lg:border-e">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-xs font-medium opacity-55">{statusLabel}</div>
                  <div className="text-2xl font-semibold tracking-tight">{healthyLabel}</div>
                </div>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
                <Activity className="h-3.5 w-3.5" />
                {refreshedLabel}
              </span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[hsl(var(--border))]/70 p-3">
                <div className="text-xs opacity-55">{t("dash.activeSub")}</div>
                <div className="mt-1 text-xl font-semibold">{summary.active_subscribers}</div>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))]/70 p-3">
                <div className="text-xs opacity-55">{t("dash.onlineNow")}</div>
                <div className="mt-1 text-xl font-semibold">{summary.online_users}</div>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))]/70 p-3">
                <div className="text-xs opacity-55">{t("dash.nasFleet")}</div>
                <div className="mt-1 text-xl font-semibold">{summary.nas.total}</div>
              </div>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="opacity-60">{t("dash.subscriberActivity")}</span>
                <span className="font-medium">{activeRatio}%</span>
              </div>
              <div className="h-2 rounded-full bg-[hsl(var(--muted))]">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(3, activeRatio)}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="opacity-60">{t("dash.cpuLoadLabel")}</span>
                <span className="font-medium">{hostLoadRatio}%</span>
              </div>
              <div className="h-2 rounded-full bg-[hsl(var(--muted))]">
                <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(3, hostLoadRatio)}%` }} />
              </div>
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const StatusPill = ({ ok, text }: { ok: boolean; text: string }) => (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        ok ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
      )}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {text}
    </span>
  );

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("dash.title")}</h1>
        <p className="text-sm opacity-70">{t("dash.subtitle")}</p>
      </div>

      {/* Search */}
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">{t("dash.searchSubscriber")}</div>
            <div className="text-xs opacity-60">{t("dash.searchSubscriberPlaceholder")}</div>
          </div>
        </div>
        <form
          className="flex w-full max-w-lg items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = subscriberSearch.trim();
            if (!q) return;
            navigate(`/users?q=${encodeURIComponent(q)}`);
          }}
        >
          <div className="relative w-full">
            <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 start-3" />
            <input
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 backdrop-blur px-3 py-2.5 ps-9 text-sm outline-none transition focus:border-[hsl(var(--primary))]/60 focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              placeholder={t("dash.searchSubscriberPlaceholder")}
              value={subscriberSearch}
              onChange={(e) => setSubscriberSearch(e.target.value)}
            />
          </div>
        </form>
      </Card>

      {wsMsg && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          <span>{wsMsg}</span>
        </div>
      )}

      {loadingSummary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <LoadingCard />
          <LoadingCard />
          <LoadingCard />
          <LoadingCard />
        </div>
      ) : null}

      <SystemOverview />

      {summary?.backup?.has_recent_failure && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 text-red-500" />
          <div>
            <div className="font-semibold text-red-600 dark:text-red-400">{t("dash.backupFailedTitle")}</div>
            <div className="opacity-80">{summary.backup.last_error || t("dash.backupFailedDesc")}</div>
          </div>
        </div>
      )}

      {/* Service status cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {summary?.backup && (
          <Card className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                <Cloud className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold">{t("dash.backupStatusTitle")}</div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="opacity-70">{t("dash.rcloneStatus")}</span>
              {summary.backup.rclone_enabled ? (
                <StatusPill
                  ok={summary.backup.rclone_connected}
                  text={summary.backup.rclone_connected ? t("dash.connected") : t("dash.disconnected")}
                />
              ) : (
                <span className="rounded-full bg-[hsl(var(--muted))]/60 px-2.5 py-1 text-xs opacity-70">
                  {t("dash.disabled")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="opacity-70">{t("dash.dailyBackupUpload")}</span>
              <StatusPill
                ok={summary.backup.daily_backup_uploaded}
                text={summary.backup.daily_backup_uploaded ? t("dash.uploadedToday") : t("dash.notUploadedToday")}
              />
            </div>
          </Card>
        )}

        {summary?.whatsapp && (
          <Card className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10 text-green-500">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold">{t("dash.whatsappStatusTitle")}</div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="opacity-70">{t("dash.whatsappConnection")}</span>
              {summary.whatsapp.enabled ? (
                <StatusPill
                  ok={summary.whatsapp.connected}
                  text={summary.whatsapp.connected ? t("dash.connected") : t("dash.disconnected")}
                />
              ) : (
                <span className="rounded-full bg-[hsl(var(--muted))]/60 px-2.5 py-1 text-xs opacity-70">
                  {t("dash.disabled")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="opacity-70">{t("dash.whatsappReminderDays")}</span>
              <span className="rounded-full bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-500">
                {summary.whatsapp.reminder_days}
              </span>
            </div>
          </Card>
        )}
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t("dash.activeSub")}
            value={summary.active_subscribers}
            Icon={Users}
            tone="blue"
            delay={0}
            hint={t("dash.activeAccountsHint")}
            progress={activeRatio}
          />
          <StatCard label={t("dash.expired")} value={summary.expired_subscribers} Icon={Clock} tone="amber" delay={1} hint={t("dash.expiredAccountsHint")} progress={100 - activeRatio} />
          <StatCard label={t("dash.onlineNow")} value={summary.online_users} Icon={Wifi} tone="green" delay={2} hint={t("dash.freshSessionsHint")} progress={Math.min(100, Math.round((summary.online_users / Math.max(1, summary.active_subscribers)) * 100))} />
          <StatCard
            label={t("dash.bandwidth")}
            value={fmtBytes(Number(summary.total_bandwidth_bytes))}
            Icon={HardDrive}
            tone="violet"
            delay={3}
            hint={
              summary.total_bandwidth_bytes ? t("dash.bandwidthFromAggregates") : t("dash.bandwidthRawSkipped")
            }
            progress={summary.total_bandwidth_bytes ? 70 : 5}
          />
        </div>
      )}

      {summary?.host && (
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
              <Server className="h-5 w-5" />
            </div>
            <h2 className="font-semibold">{t("dash.hostTitle")}</h2>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs opacity-60">{t("dash.hostHostname")}</dt>
              <dd className="font-mono text-xs font-medium">{summary.host.hostname}</dd>
            </div>
            <div>
              <dt className="text-xs opacity-60">{t("dash.hostPlatform")}</dt>
              <dd className="font-mono text-xs">{summary.host.platform}</dd>
            </div>
            <div>
              <dt className="text-xs opacity-60">{t("dash.hostUptime")}</dt>
              <dd className="font-medium">{fmtUptime(summary.host.uptime_seconds)}</dd>
            </div>
            <div>
              <dt className="text-xs opacity-60">{t("dash.hostLoad")}</dt>
              <dd className="font-mono text-xs">{summary.host.load_avg_1m.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs opacity-60">{t("dash.hostCpus")}</dt>
              <dd>{summary.host.cpu_count}</dd>
            </div>
            <div>
              <dt className="text-xs opacity-60">{t("dash.hostRam")}</dt>
              <dd>
                {summary.host.memory_used_percent.toFixed(1)}% آ· {fmtBytes(summary.host.memory_used_bytes)} /{" "}
                {fmtBytes(summary.host.memory_total_bytes)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs opacity-50">{t("dash.hostFootnote")}</p>
        </Card>
      )}

      {summary && (
        <Card>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-500">
              <Server className="h-5 w-5" />
            </div>
            <h2 className="font-semibold">{t("dash.nasFleet")}</h2>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-[hsl(var(--muted))]/40 p-4 text-center">
              <div className="text-2xl font-bold tracking-tight">{summary.nas.total}</div>
              <div className="text-xs opacity-60">{t("dash.total")}</div>
            </div>
            <div className="rounded-xl bg-emerald-500/10 p-4 text-center ring-1 ring-emerald-500/20">
              <div className="text-2xl font-bold tracking-tight text-emerald-500">{summary.nas.online}</div>
              <div className="text-xs opacity-60">{t("dash.online")}</div>
            </div>
            <div className="rounded-xl bg-red-500/10 p-4 text-center ring-1 ring-red-500/20">
              <div className="text-2xl font-bold tracking-tight text-red-500">{summary.nas.offline}</div>
              <div className="text-xs opacity-60">{t("dash.offline")}</div>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(3, nasOnlineRatio)}%` }} />
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-1">
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500">
              <TrendingUp className="h-5 w-5" />
            </div>
            <h2 className="font-semibold">{t("dash.growth")}</h2>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={growth}>
                <defs>
                  <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={1} />
                    <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="total" fill="url(#growthGrad)" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
