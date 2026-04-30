import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CircleAlert, ReceiptText, Wallet } from "lucide-react";
import { Card } from "../components/ui/Card";
import { apiFetch } from "../lib/api";
import { useFinancePeriod } from "../context/FinancePeriodContext";
import { FinancePeriodFilter } from "../components/finance/FinancePeriodFilter";
import { getFinancePeriodMonths, toMonthKeyFromIso } from "../lib/finance-period";
import { useI18n } from "../context/LocaleContext";

type InvoiceRow = { amount?: number | string; status?: string; issue_date?: string | null };
type PaymentRow = { amount?: number | string; paid_at?: string | null };
type ExpenseMonthly = { expense_cost?: number };

export function FinanceDashboardPage() {
  const { t } = useI18n();
  const { period } = useFinancePeriod();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [revenue, setRevenue] = useState<{ period: string; total: number }[]>([]);
  const [expenseByMonth, setExpenseByMonth] = useState<Record<string, number>>({});
  const months = useMemo(() => getFinancePeriodMonths(period), [period]);

  useEffect(() => {
    void (async () => {
      const [iRes, pRes, rRes] = await Promise.all([
        apiFetch("/api/invoices/"),
        apiFetch("/api/payments/"),
        apiFetch("/api/dashboard/charts/revenue"),
      ]);
      if (iRes.ok) setInvoices(((await iRes.json()) as { items?: InvoiceRow[] }).items ?? []);
      if (pRes.ok) setPayments(((await pRes.json()) as { items?: PaymentRow[] }).items ?? []);
      if (rRes.ok) setRevenue(((await rRes.json()) as { items?: { period: string; total: number }[] }).items ?? []);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(
        months.map(async (month) => {
          const res = await apiFetch(`/api/inventory/report/monthly?month=${encodeURIComponent(month)}`);
          if (!res.ok) return [month, 0] as const;
          const payload = (await res.json()) as ExpenseMonthly;
          return [month, Number(payload.expense_cost ?? 0)] as const;
        })
      );
      setExpenseByMonth(Object.fromEntries(entries));
    })();
  }, [months]);

  const monthSet = useMemo(() => new Set(months), [months]);
  const invoicedTotal = invoices
    .filter((row) => monthSet.has(toMonthKeyFromIso(row.issue_date)))
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const collectedTotal = payments
    .filter((row) => monthSet.has(toMonthKeyFromIso(row.paid_at)))
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const overdueTotal = invoices
    .filter((row) => monthSet.has(toMonthKeyFromIso(row.issue_date)))
    .filter((row) => String(row.status ?? "").toLowerCase() !== "paid")
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const expenseTotal = Object.values(expenseByMonth).reduce((sum, v) => sum + v, 0);
  const netProfit = collectedTotal - expenseTotal;

  const paymentsByMonth = payments.reduce<Record<string, number>>((acc, row) => {
    const key = toMonthKeyFromIso(row.paid_at);
    if (!key) return acc;
    acc[key] = (acc[key] ?? 0) + Number(row.amount ?? 0);
    return acc;
  }, {});
  const invoicedByMonth = revenue.reduce<Record<string, number>>((acc, row) => {
    acc[row.period] = Number(row.total ?? 0);
    return acc;
  }, {});

  const chartData = months.map((month) => ({
    month,
    invoiced: invoicedByMonth[month] ?? 0,
    collected: paymentsByMonth[month] ?? 0,
    expenses: expenseByMonth[month] ?? 0,
  }));

  const fmtMoney = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("finance.title")}</h1>
        <p className="text-sm opacity-70">{t("finance.subtitle")}</p>
      </div>

      <FinancePeriodFilter />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t("finance.kpi.invoiced")} value={fmtMoney(invoicedTotal)} icon={<ReceiptText className="h-4 w-4 text-indigo-500" />} />
        <MetricCard label={t("finance.kpi.collected")} value={fmtMoney(collectedTotal)} icon={<Wallet className="h-4 w-4 text-emerald-500" />} />
        <MetricCard label={t("finance.kpi.overdue")} value={fmtMoney(overdueTotal)} icon={<CircleAlert className="h-4 w-4 text-amber-500" />} />
        <MetricCard
          label={t("finance.kpi.profit")}
          value={fmtMoney(netProfit)}
          tone={netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
          icon={<Wallet className={`h-4 w-4 ${netProfit >= 0 ? "text-emerald-500" : "text-rose-500"}`} />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">{t("finance.trend.invoicedCollected")}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="financeInvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="financeCollGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => fmtMoney(Number(value ?? 0))} />
                <Area type="monotone" dataKey="invoiced" stroke="#6366f1" strokeWidth={2} fill="url(#financeInvGrad)" />
                <Area type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={2} fill="url(#financeCollGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">{t("finance.trend.expenses")}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => fmtMoney(Number(value ?? 0))} />
                <Bar dataKey="expenses" fill="#f43f5e" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <Card variant="solid" className="p-4">
      <div className="mb-1 flex items-center justify-between text-xs uppercase opacity-60">
        <span>{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-bold ${tone ?? ""}`}>{value}</div>
    </Card>
  );
}
