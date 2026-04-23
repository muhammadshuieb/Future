import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Fingerprint, LogIn, LogOut, Network, UserCircle, Wifi } from "lucide-react";
import { userApiFetch, setUserToken } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
function formatBytesLabel(n: string): string {
  let v = 0n;
  try {
    v = BigInt(n || "0");
  } catch {
    v = 0n;
  }
  if (v <= 0n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let x = Number(v);
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : x >= 10 ? 1 : 2)} ${units[i]}`;
}

type TrafficPoint = {
  period: string;
  sessions_count: number;
  online_seconds: number;
  download_bytes: string;
  upload_bytes: string;
  total_bytes: string;
};

type TrafficSession = {
  radacctid: string;
  start_time: string | null;
  stop_time: string | null;
  online_seconds: number;
  download_bytes: string;
  upload_bytes: string;
  total_bytes: string;
  framed_ip: string | null;
  caller_id: string | null;
  nas_ip: string | null;
  is_active: boolean;
};

type TrafficReport = {
  username: string;
  filter?: {
    from: string | null;
    to: string | null;
  };
  totals: {
    daily_online_seconds: number;
    daily_download_bytes: string;
    daily_upload_bytes: string;
    daily_total_bytes: string;
    monthly_online_seconds: number;
    monthly_download_bytes: string;
    monthly_upload_bytes: string;
    monthly_total_bytes: string;
  };
  daily: TrafficPoint[];
  monthly: TrafficPoint[];
  yearly: TrafficPoint[];
  sessions: TrafficSession[];
};

export function UserPortalLogin() {
  const { t, isRtl, locale, setLocale } = useI18n();
  const [loginMode, setLoginMode] = useState<"phone" | "username">("phone");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await userApiFetch("/api/user/login", {
      method: "POST",
      body: JSON.stringify(
        loginMode === "phone"
          ? { phone }
          : { username, password }
      ),
    });
    if (!r.ok) {
      setErr(t("userPortalLogin.error"));
      return;
    }
    const data = (await r.json()) as { token: string };
    setUserToken(data.token);
    nav("/user/dashboard");
  }

  return (
    <div
      className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-slate-900/40 via-[hsl(var(--background))] to-cyan-950/30 px-4 py-10"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute end-0 top-0 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute bottom-0 start-0 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto w-full max-w-md"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-600 dark:text-cyan-300">
              <Wifi className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-bold text-[hsl(var(--foreground))]">{t("userPortalLogin.brand")}</div>
              <div className="text-[10px] opacity-60">{t("userPortalLogin.badge")}</div>
            </div>
          </div>
        </div>

        <Card className="p-5 shadow-lg ring-1 ring-cyan-500/10">
          <h1 className="text-lg font-bold">{t("userPortalLogin.title")}</h1>
          <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
            {loginMode === "phone" ? t("userPortalLogin.subtitlePhone") : t("userPortalLogin.subtitleUser")}
          </p>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={loginMode === "phone" ? "default" : "outline"}
              onClick={() => {
                setLoginMode("phone");
                setErr("");
              }}
            >
              {t("userPortalLogin.modePhone")}
            </Button>
            <Button
              type="button"
              variant={loginMode === "username" ? "default" : "outline"}
              onClick={() => {
                setLoginMode("username");
                setErr("");
              }}
            >
              {t("userPortalLogin.modeUser")}
            </Button>
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            {loginMode === "phone" ? (
              <TextField
                label={t("userPortalLogin.phone")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            ) : (
              <TextField
                label={t("userPortalLogin.user")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            )}
            {loginMode === "username" ? (
              <TextField
                label={t("userPortalLogin.pass")}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            ) : null}
            <label className="text-xs text-[hsl(var(--muted-foreground))]">
              {t("userPortalLogin.langLabel")}
            </label>
            <select
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 px-3 py-2.5 text-sm"
              value={locale}
              onChange={(e) => setLocale(e.target.value as "ar" | "en")}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
            {err ? <p className="text-sm text-red-500 dark:text-red-400">{err}</p> : null}
            <Button type="submit" className="w-full">
              <LogIn className="me-2 h-4 w-4" />
              {t("userPortalLogin.submit")}
            </Button>
          </form>
        </Card>

      </motion.div>
    </div>
  );
}

export function UserPortalDashboard() {
  const { t, isRtl } = useI18n();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState<"subscriber" | "traffic">("subscriber");
  const [traffic, setTraffic] = useState<TrafficReport | null>(null);
  const [trafficFrom, setTrafficFrom] = useState("");
  const [trafficTo, setTrafficTo] = useState("");
  const [trafficLoading, setTrafficLoading] = useState(false);
  const nav = useNavigate();
  function onLogout() {
    setUserToken(null);
    nav("/user/login", { replace: true });
  }

  useEffect(() => {
    void (async () => {
      const r = await userApiFetch("/api/user/me");
      if (!r.ok) {
        nav("/user/login", { replace: true });
        return;
      }
      setData(await r.json());
    })();
  }, [nav]);

  const sub = (data?.subscriber ?? {}) as Record<string, unknown>;
  const fullName = [String(sub?.first_name ?? "").trim(), String(sub?.last_name ?? "").trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
  const nickname = String(sub?.nickname ?? "").trim();
  const phone = String(sub?.phone ?? "").trim();
  const regionName = String(sub?.region_name ?? "").trim();
  const quota = String(data?.quota_bytes ?? "0");
  const rem = data?.remaining_bytes != null ? String(data.remaining_bytes) : null;
  const used = String(data?.usage_bytes ?? "0");

  const loadTraffic = useCallback(
    async (opts?: { from?: string; to?: string }) => {
      const from = opts?.from ?? trafficFrom;
      const to = opts?.to ?? trafficTo;
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const suffix = q.toString() ? `?${q.toString()}` : "";
      setTrafficLoading(true);
      try {
        const r = await userApiFetch(`/api/user/me/traffic-report${suffix}`);
        if (r.ok) {
          setTraffic((await r.json()) as TrafficReport);
        } else {
          setTraffic(null);
        }
      } finally {
        setTrafficLoading(false);
      }
    },
    [trafficFrom, trafficTo]
  );

  useEffect(() => {
    if (activeTab === "traffic" && !traffic && !trafficLoading) {
      void loadTraffic({ from: trafficFrom, to: trafficTo });
    }
  }, [activeTab, traffic, trafficLoading, loadTraffic, trafficFrom, trafficTo]);

  function fmtDuration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds || 0));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}d ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }

  function fmtDateTime(value: string | null): string {
    if (!value) return "—";
    return value.slice(0, 19).replace("T", " ");
  }

  const usageChartData = useMemo(() => {
    if (!traffic) return [];
    return traffic.daily
      .slice()
      .reverse()
      .map((d) => ({
        period: d.period,
        totalGb: Number(d.total_bytes) / 1024 ** 3,
      }));
  }, [traffic]);

  const monthlyChartData = useMemo(() => {
    if (!traffic) return [];
    return traffic.monthly
      .slice()
      .reverse()
      .map((d) => ({
        period: d.period,
        totalGb: Number(d.total_bytes) / 1024 ** 3,
      }));
  }, [traffic]);

  if (!data) {
    return (
      <div className="min-h-screen p-6 text-sm opacity-70" dir={isRtl ? "rtl" : "ltr"}>
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-b from-cyan-950/20 to-[hsl(var(--background))] px-4 py-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <UserCircle className="h-7 w-7 text-cyan-500" />
            {t("userPortalDash.title")}
          </h1>
          <Button type="button" variant="outline" onClick={onLogout}>
            <LogOut className="me-2 h-4 w-4" />
            {t("header.logout")}
          </Button>
        </div>
        <Card className="p-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={activeTab === "subscriber" ? "default" : "outline"}
              onClick={() => setActiveTab("subscriber")}
            >
              {t("users.profile")}
            </Button>
            <Button
              type="button"
              variant={activeTab === "traffic" ? "default" : "outline"}
              onClick={() => setActiveTab("traffic")}
            >
              {t("profile.trafficTitle")}
            </Button>
          </div>
        </Card>

        {activeTab === "subscriber" ? (
          <Card className="p-4">
            <dl className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="flex items-center gap-1 text-[hsl(var(--muted-foreground))]">
                  <Network className="h-4 w-4" />
                  {t("userPortalDash.speed")}
                </dt>
                <dd className="font-medium">{String(sub?.mikrotik_rate_limit ?? "—")}</dd>
              </div>
              <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="text-[hsl(var(--muted-foreground))]">{t("users.fullName")}</dt>
                <dd className="font-medium">{fullName || "—"}</dd>
              </div>
              <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="text-[hsl(var(--muted-foreground))]">{t("users.nickname")}</dt>
                <dd className="font-medium">{nickname || "—"}</dd>
              </div>
              <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="text-[hsl(var(--muted-foreground))]">{t("users.region")}</dt>
                <dd className="font-medium">{regionName || "—"}</dd>
              </div>
              <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="text-[hsl(var(--muted-foreground))]">{t("users.phone")}</dt>
                <dd className="font-medium">{phone || "—"}</dd>
              </div>
              <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="text-[hsl(var(--muted-foreground))]">{t("userPortalDash.expiry")}</dt>
                <dd className="font-medium">
                  {sub?.expiration_date != null
                    ? String(sub.expiration_date).slice(0, 10)
                    : "—"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="text-[hsl(var(--muted-foreground))]">{t("userPortalDash.start")}</dt>
                <dd className="font-medium">
                  {sub?.start_date != null ? String(sub.start_date).slice(0, 10) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[hsl(var(--muted-foreground))]">{t("userPortalDash.usage")}</dt>
                <dd className="mt-1 font-mono text-xs">
                  {formatBytesLabel(used)} / {formatBytesLabel(quota)}
                  {rem != null && (
                    <span className="ms-2 text-cyan-600 dark:text-cyan-400">
                      ({t("userPortalDash.rem")}: {formatBytesLabel(rem)})
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-[hsl(var(--muted-foreground))]">
                  <Fingerprint className="h-3.5 w-3.5" />
                  {t("userPortalDash.currentIp")}
                </dt>
                <dd className="mt-1 font-mono text-sm">{String(data.current_ip ?? "—")}</dd>
              </div>
            </dl>
          </Card>
        ) : null}

        {activeTab === "traffic" ? (
          <Card className="space-y-4 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold opacity-80">{t("profile.trafficTitle")}</h2>
              <Button type="button" variant="outline" onClick={() => void loadTraffic()}>
                {trafficLoading ? t("common.loading") : t("common.refresh")}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
              <TextField
                type="date"
                label={t("profile.dateFrom")}
                value={trafficFrom}
                onChange={(e) => setTrafficFrom(e.target.value)}
              />
              <TextField
                type="date"
                label={t("profile.dateTo")}
                value={trafficTo}
                onChange={(e) => setTrafficTo(e.target.value)}
              />
              <div className="flex items-end">
                <Button type="button" onClick={() => void loadTraffic()}>
                  {t("profile.applyFilter")}
                </Button>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setTrafficFrom("");
                    setTrafficTo("");
                    void loadTraffic({ from: "", to: "" });
                  }}
                >
                  {t("profile.clearFilter")}
                </Button>
              </div>
            </div>
            {!traffic ? (
              <p className="text-sm opacity-70">{t("profile.trafficEmpty")}</p>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="p-3">
                    <div className="mb-2 text-xs font-semibold opacity-70">{t("profile.dailyUsageChart")}</div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={usageChartData}>
                          <defs>
                            <linearGradient id="trafficDailyUser" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v: number) => `${v.toFixed(2)} GB`} />
                          <Area
                            type="monotone"
                            dataKey="totalGb"
                            stroke="hsl(var(--primary))"
                            fill="url(#trafficDailyUser)"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                  <Card className="p-3">
                    <div className="mb-2 text-xs font-semibold opacity-70">{t("profile.monthlyUsageChart")}</div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={monthlyChartData}>
                          <defs>
                            <linearGradient id="trafficMonthlyUser" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                              <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v: number) => `${v.toFixed(2)} GB`} />
                          <Area
                            type="monotone"
                            dataKey="totalGb"
                            stroke="#10b981"
                            fill="url(#trafficMonthlyUser)"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[hsl(var(--border))] p-3">
                    <div className="text-xs opacity-60">{t("profile.dailyTotals")}</div>
                    <div className="mt-2 text-sm">
                      <div>{t("profile.totalOnline")}: <span className="font-mono">{fmtDuration(traffic.totals.daily_online_seconds)}</span></div>
                      <div>{t("profile.download")}: <span className="font-mono">{formatBytesLabel(traffic.totals.daily_download_bytes)}</span></div>
                      <div>{t("profile.upload")}: <span className="font-mono">{formatBytesLabel(traffic.totals.daily_upload_bytes)}</span></div>
                      <div>{t("profile.totalUsage")}: <span className="font-mono">{formatBytesLabel(traffic.totals.daily_total_bytes)}</span></div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] p-3">
                    <div className="text-xs opacity-60">{t("profile.monthlyTotals")}</div>
                    <div className="mt-2 text-sm">
                      <div>{t("profile.totalOnline")}: <span className="font-mono">{fmtDuration(traffic.totals.monthly_online_seconds)}</span></div>
                      <div>{t("profile.download")}: <span className="font-mono">{formatBytesLabel(traffic.totals.monthly_download_bytes)}</span></div>
                      <div>{t("profile.upload")}: <span className="font-mono">{formatBytesLabel(traffic.totals.monthly_upload_bytes)}</span></div>
                      <div>{t("profile.totalUsage")}: <span className="font-mono">{formatBytesLabel(traffic.totals.monthly_total_bytes)}</span></div>
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))]">
                  <div className="border-b border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold opacity-70">
                    {t("profile.sessionsDetails")}
                  </div>
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-[hsl(var(--muted))]/50">
                        <tr>
                          <th className="px-2 py-2 text-start">#</th>
                          <th className="px-2 py-2 text-start">{t("profile.sessionStart")}</th>
                          <th className="px-2 py-2 text-start">{t("profile.sessionStop")}</th>
                          <th className="px-2 py-2 text-start">{t("profile.totalOnline")}</th>
                          <th className="px-2 py-2 text-start">{t("profile.totalUsage")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {traffic.sessions.map((s, idx) => (
                          <tr key={s.radacctid} className="border-t border-[hsl(var(--border))]/50">
                            <td className="px-2 py-2 font-mono">{idx + 1}</td>
                            <td className="px-2 py-2 font-mono">{fmtDateTime(s.start_time)}</td>
                            <td className="px-2 py-2 font-mono">{s.is_active ? t("profile.activeSession") : fmtDateTime(s.stop_time)}</td>
                            <td className="px-2 py-2 font-mono">{fmtDuration(s.online_seconds)}</td>
                            <td className="px-2 py-2 font-mono">{formatBytesLabel(s.total_bytes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
