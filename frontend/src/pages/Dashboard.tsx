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
import { Wifi, Users, Clock, HardDrive, Server } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../context/LocaleContext";

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

  const stat = (label: string, value: string | number, icon: ReactNode, delay: number) => (
    <Card delay={delay * 0.05} className="flex items-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--muted))]">{icon}</div>
      <div>
        <div className="text-xs opacity-60">{label}</div>
        <div className="text-xl font-bold">{value}</div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div>
        <h1 className="text-2xl font-bold">{t("dash.title")}</h1>
        <p className="text-sm opacity-70">{t("dash.subtitle")}</p>
      </div>
      <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm opacity-80">{t("dash.searchSubscriber")}</div>
        <form
          className="flex w-full max-w-lg items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = subscriberSearch.trim();
            if (!q) return;
            navigate(`/users?q=${encodeURIComponent(q)}`);
          }}
        >
          <input
            className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
            placeholder={t("dash.searchSubscriberPlaceholder")}
            value={subscriberSearch}
            onChange={(e) => setSubscriberSearch(e.target.value)}
          />
        </form>
      </Card>
      {wsMsg && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          {wsMsg}
        </div>
      )}
      {summary?.backup?.has_recent_failure && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          <div className="font-semibold">{t("dash.backupFailedTitle")}</div>
          <div className="opacity-80">{summary.backup.last_error || t("dash.backupFailedDesc")}</div>
        </div>
      )}
      {summary?.backup && (
        <Card className="space-y-2">
          <div className="text-sm font-semibold">{t("dash.backupStatusTitle")}</div>
          <div className="text-sm">
            {t("dash.rcloneStatus")}:{" "}
            {summary.backup.rclone_enabled ? (
              summary.backup.rclone_connected ? (
                <span className="text-emerald-400">{t("dash.connected")}</span>
              ) : (
                <span className="text-red-400">{t("dash.disconnected")}</span>
              )
            ) : (
              <span className="opacity-70">{t("dash.disabled")}</span>
            )}
          </div>
          <div className="text-sm">
            {t("dash.dailyBackupUpload")}:{" "}
            {summary.backup.daily_backup_uploaded ? (
              <span className="text-emerald-400">{t("dash.uploadedToday")}</span>
            ) : (
              <span className="text-amber-300">{t("dash.notUploadedToday")}</span>
            )}
          </div>
        </Card>
      )}
      {summary?.whatsapp && (
        <Card className="space-y-2">
          <div className="text-sm font-semibold">{t("dash.whatsappStatusTitle")}</div>
          <div className="text-sm">
            {t("dash.whatsappConnection")}:{" "}
            {summary.whatsapp.enabled ? (
              summary.whatsapp.connected ? (
                <span className="text-emerald-400">{t("dash.connected")}</span>
              ) : (
                <span className="text-red-400">{t("dash.disconnected")}</span>
              )
            ) : (
              <span className="opacity-70">{t("dash.disabled")}</span>
            )}
          </div>
          <div className="text-sm">
            {t("dash.whatsappReminderDays")}: <span>{summary.whatsapp.reminder_days}</span>
          </div>
        </Card>
      )}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stat(t("dash.activeSub"), summary.active_subscribers, <Users className="h-6 w-6" />, 0)}
          {stat(t("dash.expired"), summary.expired_subscribers, <Clock className="h-6 w-6" />, 1)}
          {stat(t("dash.onlineNow"), summary.online_users, <Wifi className="h-6 w-6" />, 2)}
          {stat(t("dash.bandwidth"), fmtBytes(Number(summary.total_bandwidth_bytes)), <HardDrive className="h-6 w-6" />, 3)}
        </div>
      )}
      {summary && (
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <Server className="h-5 w-5" />
            <h2 className="font-semibold">{t("dash.nasFleet")}</h2>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">{summary.nas.total}</div>
              <div className="text-xs opacity-60">{t("dash.total")}</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">{summary.nas.online}</div>
              <div className="text-xs opacity-60">{t("dash.online")}</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-400">{summary.nas.offline}</div>
              <div className="text-xs opacity-60">{t("dash.offline")}</div>
            </div>
          </div>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">{t("dash.revenue")}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenue}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">{t("dash.growth")}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={growth}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="total" fill="hsl(var(--accent))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
