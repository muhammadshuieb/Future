import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AreaChart,
  Area,
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
  DollarSign,
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
};

type Tone = "blue" | "amber" | "green" | "violet" | "emerald" | "rose" | "cyan" | "indigo";
const statTones: Record<Tone, { bg: string; text: string; ring: string }> = {
  blue: { bg: "bg-blue-500/10", text: "text-blue-500", ring: "ring-blue-500/20" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-500", ring: "ring-amber-500/20" },
  green: { bg: "bg-green-500/10", text: "text-green-500", ring: "ring-green-500/20" },
  violet: { bg: "bg-violet-500/10", text: "text-violet-500", ring: "ring-violet-500/20" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-500", ring: "ring-emerald-500/20" },
  rose: { bg: "bg-rose-500/10", text: "text-rose-500", ring: "ring-rose-500/20" },
  cyan: { bg: "bg-cyan-500/10", text: "text-cyan-500", ring: "ring-cyan-500/20" },
  indigo: { bg: "bg-indigo-500/10", text: "text-indigo-500", ring: "ring-indigo-500/20" },
};

export function DashboardPage() {
  const { t, isRtl } = useI18n();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [revenue, setRevenue] = useState<{ period: string; total: number }[]>([]);
  const [growth, setGrowth] = useState<{ period: string; total: number }[]>([]);
  const [wsMsg, setWsMsg] = useState<string | null>(null);
  const [subscriberSearch, setSubscriberSearch] = useState("");

  useEffect(() => {
    void (async () => {
      const [s, r, g] = await Promise.all([
        apiFetch("/api/dashboard/summary"),
        apiFetch("/api/dashboard/charts/revenue"),
        apiFetch("/api/dashboard/charts/subscribers"),
      ]);
      if (s.ok) setSummary((await s.json()) as Summary);
      if (r.ok) setRevenue(((await r.json()) as { items: typeof revenue }).items);
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

  const StatCard = ({
    label,
    value,
    Icon,
    tone,
    delay,
  }: {
    label: string;
    value: string | number;
    Icon: LucideIcon;
    tone: Tone;
    delay: number;
  }) => {
    const s = statTones[tone];
    return (
      <Card delay={delay * 0.05} className="relative overflow-hidden">
        <div
          className={cn(
            "pointer-events-none absolute -end-6 -top-6 h-28 w-28 rounded-full blur-2xl opacity-40",
            s.bg
          )}
        />
        <div className="flex items-center gap-4">
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl ring-1", s.bg, s.text, s.ring)}>
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs opacity-60">{label}</div>
            <div className="text-2xl font-bold tracking-tight">{value}</div>
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
          <StatCard label={t("dash.activeSub")} value={summary.active_subscribers} Icon={Users} tone="blue" delay={0} />
          <StatCard label={t("dash.expired")} value={summary.expired_subscribers} Icon={Clock} tone="amber" delay={1} />
          <StatCard label={t("dash.onlineNow")} value={summary.online_users} Icon={Wifi} tone="green" delay={2} />
          <StatCard
            label={t("dash.bandwidth")}
            value={fmtBytes(Number(summary.total_bandwidth_bytes))}
            Icon={HardDrive}
            tone="violet"
            delay={3}
          />
        </div>
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
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <DollarSign className="h-5 w-5" />
            </div>
            <h2 className="font-semibold">{t("dash.revenue")}</h2>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenue}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
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
                <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#revGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

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
