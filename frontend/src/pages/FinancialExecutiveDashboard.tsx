import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Bell,
  CalendarCheck2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  X,
} from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { apiFetch, readApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasIspPermission } from "../lib/permissions";
import { useI18n } from "../context/LocaleContext";
import { Link } from "react-router-dom";
import { cn } from "../lib/utils";

type DashboardPayload = {
  widgets: Record<string, unknown>;
  charts: {
    monthly_revenue?: { month: string; amount: number }[];
    collections_by_manager?: { manager_id: string; manager_name: string; amount: number }[];
    expenses_by_category?: { category: string; amount: number }[];
    prepaid_sales_trend?: { month: string; amount: number }[];
    profit_loss_trend?: { month: string; revenue: number; expenses: number; profit: number }[];
  };
  kpis: Record<string, number>;
  package_profitability: { package_id: string; name: string; revenue: number; subscribers: number }[];
};

type AlertItem = {
  id: string;
  key: string;
  severity: "info" | "warning" | "danger";
  title_ar: string;
  detail_ar: string;
};

type ClosingRow = Record<string, unknown>;

function fmtMoney(n: number) {
  return n.toLocaleString("ar-SY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function W({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "emerald" | "rose" | "amber";
}) {
  const toneCls =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "rose"
        ? "text-rose-600 dark:text-rose-400"
        : tone === "amber"
          ? "text-amber-600 dark:text-amber-400"
          : "";
  return (
    <Card className="border-[hsl(var(--border))]/80 p-4">
      <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular-nums", toneCls)}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{sub}</div> : null}
    </Card>
  );
}

export function FinancialExecutiveDashboardPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canView = hasIspPermission(user?.role, user?.permissions, "financial_reports:view");
  const canCloseDay =
    user?.role === "admin" || hasIspPermission(user?.role, user?.permissions, "cashbox:manage");

  const [load, setLoad] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dash, setDash] = useState<DashboardPayload | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [closings, setClosings] = useState<ClosingRow[]>([]);
  const [closingMsg, setClosingMsg] = useState<string | null>(null);

  const [bd, setBd] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [expCash, setExpCash] = useState<string>("");
  const [actCash, setActCash] = useState<string>("");
  const [closeNotes, setCloseNotes] = useState("");
  const [sigName, setSigName] = useState("");

  const loadAll = useCallback(async () => {
    setLoad(true);
    setErr(null);
    try {
      const [dRes, aRes] = await Promise.all([
        apiFetch("/api/financial-analytics/dashboard"),
        apiFetch("/api/financial-analytics/alerts"),
      ]);
      if (!dRes.ok) throw new Error(await readApiError(dRes));
      setDash((await dRes.json()) as DashboardPayload);
      if (aRes.ok) {
        const aj = (await aRes.json()) as { items: AlertItem[] };
        setAlerts(aj.items ?? []);
      }
      if (canCloseDay) {
        const cRes = await apiFetch("/api/financial-analytics/closings");
        if (cRes.ok) {
          const cj = (await cRes.json()) as { items: ClosingRow[] };
          setClosings(cj.items ?? []);
        }
      } else {
        setClosings([]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setLoad(false);
    }
  }, [canCloseDay]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const w = dash?.widgets ?? {};
  const charts = dash?.charts ?? {};
  const kpis = dash?.kpis ?? {};

  const dangerCount = useMemo(() => alerts.filter((a) => a.severity === "danger").length, [alerts]);
  const warnCount = useMemo(() => alerts.filter((a) => a.severity === "warning").length, [alerts]);

  async function dismissAlert(key: string) {
    const res = await apiFetch("/api/financial-analytics/alerts/dismiss", {
      method: "POST",
      body: JSON.stringify({ alert_key: key }),
    });
    if (!res.ok) return;
    setAlerts((prev) => prev.filter((x) => x.key !== key));
  }

  async function submitClosing(e: React.FormEvent) {
    e.preventDefault();
    setClosingMsg(null);
    const actual = Number(actCash);
    if (Number.isNaN(actual)) {
      setClosingMsg(t("fd.close.invalid"));
      return;
    }
    const expected = expCash.trim() === "" ? actual : Number(expCash);
    const res = await apiFetch("/api/financial-analytics/closings", {
      method: "POST",
      body: JSON.stringify({
        business_date: bd,
        expected_cash: Number.isNaN(expected) ? actual : expected,
        actual_cash: actual,
        notes: closeNotes || undefined,
        signature_name: sigName || undefined,
      }),
    });
    if (!res.ok) {
      setClosingMsg(await readApiError(res));
      return;
    }
    setClosingMsg(t("fd.close.ok"));
    setActCash("");
    void loadAll();
  }

  if (!canView) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <ShieldAlert className="h-10 w-10 text-amber-500" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("fd.forbidden")}</p>
        <Link to="/" className="text-sm text-[hsl(var(--primary))] underline">
          {t("fd.backHome")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 print:space-y-4" dir="rtl">
      <div className="flex flex-col gap-3 print:hidden md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("fd.title")}</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("fd.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dangerCount + warnCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <Bell className="h-3.5 w-3.5" />
              {t("fd.alerts.badgePrefix")} ({dangerCount + warnCount})
            </span>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => void loadAll()} disabled={load}>
            {load ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ms-1">{t("common.refresh")}</span>
          </Button>
          <Link
            to="/financial-reports"
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--muted))]/40"
          >
            {t("fd.linkReports")}
          </Link>
        </div>
      </div>

      {err ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {err}
        </div>
      ) : null}

      {/* تنبيهات */}
      <Card className="border-amber-500/20 p-4 print:hidden">
        <div className="mb-3 flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          {t("fd.alerts.title")}
        </div>
        {alerts.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("fd.alerts.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li
                key={a.key}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between",
                  a.severity === "danger" && "border-rose-500/50 bg-rose-500/5",
                  a.severity === "warning" && "border-amber-500/40 bg-amber-500/5",
                  a.severity === "info" && "border-sky-500/40 bg-sky-500/5"
                )}
              >
                <div>
                  <div className="text-sm font-semibold">{a.title_ar}</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">{a.detail_ar}</div>
                </div>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[hsl(var(--border))] px-2 py-1 text-[11px] hover:bg-[hsl(var(--muted))]/50"
                  onClick={() => void dismissAlert(a.key)}
                >
                  <X className="h-3 w-3" />
                  {t("fd.alerts.dismiss")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {load && !dash ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--muted-foreground))]" />
        </div>
      ) : null}

      {dash ? (
        <>
          {/* KPI سريعة */}
          <div className="grid gap-3 print:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
            <W label={t("fd.kpi.arpu")} value={fmtMoney(Number(kpis.arpu ?? 0))} />
            <W
              label={t("fd.kpi.collection")}
              value={`${Number(kpis.collection_rate_percent ?? 0).toFixed(1)}٪`}
            />
            <W
              label={t("fd.kpi.churn")}
              value={`${Number(kpis.churn_rate_percent ?? 0).toFixed(1)}٪`}
            />
            <W
              label={t("fd.kpi.overdueShare")}
              value={`${Number(kpis.overdue_share_of_invoiced_percent ?? 0).toFixed(1)}٪`}
            />
          </div>

          {/* Widgets */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <W label={t("fd.w.revenueToday")} value={fmtMoney(Number(w.revenue_today ?? 0))} />
            <W label={t("fd.w.revenueMonth")} value={fmtMoney(Number(w.revenue_this_month ?? 0))} />
            <W label={t("fd.w.activeSubscribers")} value={String(w.active_subscribers ?? 0)} />
            <W label={t("fd.w.unpaidInvoices")} value={String(w.unpaid_invoices ?? 0)} />
            <W label={t("fd.w.overdueInvoices")} value={String(w.overdue_invoices ?? 0)} />
            <W label={t("fd.w.managerObligations")} value={fmtMoney(Number(w.manager_obligations_total ?? 0))} />
            <W label={t("fd.w.managerWallets")} value={fmtMoney(Number(w.manager_wallet_balances_total ?? 0))} />
            <W label={t("fd.w.prepaidToday")} value={fmtMoney(Number(w.prepaid_sales_today ?? 0))} />
            <W label={t("fd.w.expensesToday")} value={fmtMoney(Number(w.expenses_today ?? 0))} />
            <W label={t("fd.w.expensesMonth")} value={fmtMoney(Number(w.expenses_this_month ?? 0))} />
            <W
              label={t("fd.w.netProfit")}
              value={fmtMoney(Number(w.net_profit_month ?? 0))}
              tone={Number(w.net_profit_month ?? 0) >= 0 ? "emerald" : "rose"}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <TrendingUp className="h-4 w-4 text-violet-500" />
                {t("fd.top.managers")}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-xs text-[hsl(var(--muted-foreground))]">
                      <th className="py-2 ps-0 pe-2">{t("fd.col.manager")}</th>
                      <th className="py-2 ps-2 pe-0 text-end">{t("fd.col.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((w.top_managers_collections as { name: string; total: number }[]) ?? []).map((r, i) => (
                      <tr key={i} className="border-b border-[hsl(var(--border))]/60">
                        <td className="py-1.5">{r.name || "—"}</td>
                        <td className="py-1.5 text-end tabular-nums font-medium">{fmtMoney(Number(r.total ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <TrendingUp className="h-4 w-4 text-fuchsia-500" />
                {t("fd.top.packages")}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-xs text-[hsl(var(--muted-foreground))]">
                      <th className="py-2 ps-0 pe-2">{t("fd.col.package")}</th>
                      <th className="py-2 ps-2 pe-0 text-end">{t("fd.col.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((w.top_packages_revenue as { name: string; total: number }[]) ?? []).map((r, i) => (
                      <tr key={i} className="border-b border-[hsl(var(--border))]/60">
                        <td className="py-1.5">{r.name || "—"}</td>
                        <td className="py-1.5 text-end tabular-nums font-medium">{fmtMoney(Number(r.total ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <h3 className="mb-3 font-semibold">{t("fd.pkg.profit")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs text-[hsl(var(--muted-foreground))]">
                    <th className="py-2">{t("fd.col.package")}</th>
                    <th className="py-2 text-end">{t("fd.col.subscribers")}</th>
                    <th className="py-2 text-end">{t("fd.col.proxyRev")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(dash.package_profitability ?? []).map((r) => (
                    <tr key={r.package_id} className="border-b border-[hsl(var(--border))]/60">
                      <td className="py-1.5">{r.name}</td>
                      <td className="py-1.5 text-end tabular-nums">{r.subscribers}</td>
                      <td className="py-1.5 text-end tabular-nums">{fmtMoney(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Charts */}
          <div className="grid gap-6 xl:grid-cols-2 print:block">
            <Card className="p-4 print:break-inside-avoid">
              <h3 className="mb-2 font-semibold">{t("fd.chart.monthlyRevenue")}</h3>
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={charts.monthly_revenue ?? []}>
                    <defs>
                      <linearGradient id="mr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <Tooltip formatter={(v: number) => fmtMoney(Number(v))} />
                    <Area type="monotone" dataKey="amount" stroke="#7c3aed" fill="url(#mr)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4 print:break-inside-avoid">
              <h3 className="mb-2 font-semibold">{t("fd.chart.collectionsManager")}</h3>
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.collections_by_manager ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                    <XAxis dataKey="manager_name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={70} />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <Tooltip formatter={(v: number) => fmtMoney(Number(v))} />
                    <Bar dataKey="amount" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4 print:break-inside-avoid">
              <h3 className="mb-2 font-semibold">{t("fd.chart.expensesCategory")}</h3>
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(charts.expenses_by_category ?? []).map((x) => ({ ...x, label: x.category }))}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                    <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={68} />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <Tooltip formatter={(v: number) => fmtMoney(Number(v))} />
                    <Bar dataKey="amount" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4 print:break-inside-avoid">
              <h3 className="mb-2 font-semibold">{t("fd.chart.prepaidTrend")}</h3>
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={charts.prepaid_sales_trend ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <Tooltip formatter={(v: number) => fmtMoney(Number(v))} />
                    <Line type="monotone" dataKey="amount" stroke="#d946ef" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4 xl:col-span-2 print:break-inside-avoid">
              <h3 className="mb-2 font-semibold">{t("fd.chart.plTrend")}</h3>
              <div className="h-72 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={charts.profit_loss_trend ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={52} />
                    <Tooltip formatter={(v: number) => fmtMoney(Number(v))} />
                    <Legend />
                    <Area type="monotone" dataKey="revenue" stroke="#22c55e" fill="#22c55e33" name={t("fd.leg.revenue")} />
                    <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="#ef444433" name={t("fd.leg.expenses")} />
                    <Line type="monotone" dataKey="profit" stroke="#6366f1" strokeWidth={2} dot={false} name={t("fd.leg.profit")} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      ) : null}

      {/* إقفال يومي */}
      {canCloseDay ? (
        <Card className="border-violet-500/20 p-4 print:hidden">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <CalendarCheck2 className="h-4 w-4 text-violet-500" />
            {t("fd.close.title")}
          </div>
          <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">{t("fd.close.hint")}</p>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submitClosing}>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("fd.close.date")}</span>
              <input
                type="date"
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2"
                value={bd}
                onChange={(e) => setBd(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("fd.close.expected")}</span>
              <input
                type="number"
                step="0.01"
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2"
                value={expCash}
                onChange={(e) => setExpCash(e.target.value)}
                placeholder={t("fd.close.expectedPh")}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("fd.close.actual")}</span>
              <input
                type="number"
                step="0.01"
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2"
                value={actCash}
                onChange={(e) => setActCash(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("fd.close.signature")}</span>
              <input
                type="text"
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2"
                value={sigName}
                onChange={(e) => setSigName(e.target.value)}
              />
            </label>
            <label className="md:col-span-2 flex flex-col gap-1 text-sm">
              <span>{t("fd.close.notes")}</span>
              <textarea
                className="min-h-[72px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2"
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
              />
            </label>
            <div className="md:col-span-2">
              <Button type="submit" disabled={load}>
                {t("fd.close.submit")}
              </Button>
              {closingMsg ? <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{closingMsg}</p> : null}
            </div>
          </form>

          {closings.length > 0 ? (
            <div className="mt-6 border-t border-[hsl(var(--border))] pt-4">
              <h4 className="mb-2 text-sm font-semibold">{t("fd.close.recent")}</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[hsl(var(--muted-foreground))]">
                      <th className="py-1 text-start">{t("fd.close.col.date")}</th>
                      <th className="py-1 text-end">{t("fd.close.col.variance")}</th>
                      <th className="py-1 text-start">{t("fd.close.col.notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closings.slice(0, 12).map((row) => (
                      <tr key={String(row.id)} className="border-t border-[hsl(var(--border))]/50">
                        <td className="py-1.5 tabular-nums">{String(row.business_date ?? "").slice(0, 10)}</td>
                        <td className="py-1.5 text-end tabular-nums">{fmtMoney(Number(row.variance_amount ?? 0))}</td>
                        <td className="max-w-[200px] truncate py-1.5">{String(row.notes ?? "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="flex justify-end print:hidden">
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          {t("fd.print")}
        </Button>
      </div>
    </div>
  );
}
