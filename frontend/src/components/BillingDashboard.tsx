import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CircleDollarSign, TrendingUp, Users } from "lucide-react";
import { Card } from "./ui/Card";
import { apiFetch } from "../lib/api";
import { useI18n } from "../context/LocaleContext";

type MoneyRow = { currency: string; amount: number };

type BillingStats = {
  totalRevenue: number;
  monthlyRevenue: number;
  activeSubscribers: number;
  pendingInvoices: number;
  overdueAmount: number;
  period: string;
  paymentLifetimeByCurrency?: MoneyRow[];
  paymentPeriodByCurrency?: MoneyRow[];
  overdueByCurrency?: MoneyRow[];
};

function formatMoneyByCurrency(rows: MoneyRow[] | undefined, fallbackAmount: number): string {
  const list = Array.isArray(rows) ? rows.filter((r) => Number(r.amount) > 0) : [];
  if (list.length === 0) {
    return fallbackAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return list
    .map((r) => {
      const cur = String(r.currency ?? "USD").toUpperCase();
      const amt = Number(r.amount ?? 0);
      return `${cur}\u00A0${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    })
    .join(" · ");
}

function StatCard({
  title,
  value,
  icon,
  delay,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  delay: number;
}) {
  return (
    <Card delay={delay} variant="subtle" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="text-sm font-medium">{title}</span>
        {icon}
      </div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
    </Card>
  );
}

export function BillingDashboard() {
  const { t } = useI18n();
  const [stats, setStats] = useState<BillingStats | null>(null);
  const [period, setPeriod] = useState("month");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      const res = await apiFetch(`/api/billing/stats?period=${encodeURIComponent(period)}`);
      if (!res.ok) {
        if (!cancelled) setError(t("billing.stats.loadError"));
        return;
      }
      const raw = (await res.json()) as Partial<BillingStats> & { periodRevenue?: number };
      const data: BillingStats = {
        totalRevenue: Number(raw.totalRevenue ?? 0),
        monthlyRevenue: Number(raw.monthlyRevenue ?? raw.periodRevenue ?? 0),
        activeSubscribers: Number(raw.activeSubscribers ?? 0),
        pendingInvoices: Number(raw.pendingInvoices ?? 0),
        overdueAmount: Number(raw.overdueAmount ?? 0),
        period: typeof raw.period === "string" ? raw.period : "month",
        paymentLifetimeByCurrency: raw.paymentLifetimeByCurrency,
        paymentPeriodByCurrency: raw.paymentPeriodByCurrency,
        overdueByCurrency: raw.overdueByCurrency,
      };
      if (!cancelled) setStats(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [period, t]);

  const periodKey = ["week", "month", "quarter", "year"].includes(period) ? period : "month";
  const windowLabel = t(`billing.stats.window.${periodKey}`);

  const pendingInvoicesLabel =
    stats && stats.pendingInvoices === 1 ? t("billing.stats.invoiceSingular") : t("billing.stats.invoicePlural");

  const totalDisplay = stats
    ? formatMoneyByCurrency(stats.paymentLifetimeByCurrency, stats.totalRevenue)
    : "";
  const periodDisplay = stats
    ? formatMoneyByCurrency(stats.paymentPeriodByCurrency, stats.monthlyRevenue)
    : "";
  const overdueDisplay = stats ? formatMoneyByCurrency(stats.overdueByCurrency, stats.overdueAmount) : "";

  return (
    <div className="mb-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("billing.stats.summary")}</h2>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
          aria-label={t("billing.stats.summary")}
        >
          <option value="week">{t("billing.stats.period.week")}</option>
          <option value="month">{t("billing.stats.period.month")}</option>
          <option value="quarter">{t("billing.stats.period.quarter")}</option>
          <option value="year">{t("billing.stats.period.year")}</option>
        </select>
      </div>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !stats ? (
        <p className="text-sm text-muted-foreground">{t("billing.stats.loading")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            delay={0}
            title={t("billing.stats.totalCollected")}
            value={totalDisplay}
            icon={<CircleDollarSign className="h-5 w-5 text-emerald-600" aria-hidden />}
          />
          <StatCard
            delay={0.05}
            title={`${t("billing.stats.collectedInWindow")} (${windowLabel})`}
            value={periodDisplay}
            icon={<TrendingUp className="h-5 w-5 text-sky-600" aria-hidden />}
          />
          <StatCard
            delay={0.1}
            title={t("billing.stats.activeSessions")}
            value={stats.activeSubscribers.toLocaleString()}
            icon={<Users className="h-5 w-5 text-violet-600" aria-hidden />}
          />
          <StatCard
            delay={0.15}
            title={t("billing.stats.overdueAndPending")}
            value={`${overdueDisplay} · ${stats.pendingInvoices} ${pendingInvoicesLabel}`}
            icon={<AlertCircle className="h-5 w-5 text-amber-600" aria-hidden />}
          />
        </div>
      )}
    </div>
  );
}
