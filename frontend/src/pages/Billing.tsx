import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDollarSign, Clock3, ReceiptText, Wallet } from "lucide-react";
import { apiFetch } from "../lib/api";
import { Card } from "../components/ui/Card";
import { useFinancePeriod } from "../context/FinancePeriodContext";
import { getFinancePeriodMonths, inFinancePeriod } from "../lib/finance-period";
import { FinancePeriodFilter } from "../components/finance/FinancePeriodFilter";

type InvoiceRow = {
  id?: string | number;
  invoice_no?: string;
  status?: string;
  amount?: number | string;
  currency?: string;
  issue_date?: string | null;
};

type PaymentRow = {
  id?: string | number;
  invoice_no?: string;
  amount?: number | string;
  currency?: string;
  paid_at?: string;
};

function asAmount(value: number | string | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value: number, currency?: string) {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();
}

export function BillingPage() {
  const { period } = useFinancePeriod();
  const periodMonthSet = useMemo(() => new Set(getFinancePeriodMonths(period)), [period]);
  const [inv, setInv] = useState<InvoiceRow[]>([]);
  const [pay, setPay] = useState<PaymentRow[]>([]);

  useEffect(() => {
    void (async () => {
      const [a, b] = await Promise.all([apiFetch("/api/invoices/"), apiFetch("/api/payments/")]);
      if (a.ok) setInv(((await a.json()) as { items?: InvoiceRow[] }).items ?? []);
      if (b.ok) setPay(((await b.json()) as { items?: PaymentRow[] }).items ?? []);
    })();
  }, []);

  const invoices = useMemo(
    () =>
      inv
        .filter((i) => inFinancePeriod(i.issue_date, periodMonthSet))
        .sort((a, b) => String(b.issue_date ?? "").localeCompare(String(a.issue_date ?? "")))
        .slice(0, 200),
    [inv, periodMonthSet]
  );
  const payments = useMemo(
    () =>
      pay
        .filter((p) => inFinancePeriod(p.paid_at, periodMonthSet))
        .sort((a, b) => String(b.paid_at ?? "").localeCompare(String(a.paid_at ?? "")))
        .slice(0, 200),
    [pay, periodMonthSet]
  );
  const totalInvoiced = invoices.reduce((sum, item) => sum + asAmount(item.amount), 0);
  const totalPaid = payments.reduce((sum, item) => sum + asAmount(item.amount), 0);
  const pendingCount = invoices.filter((item) => String(item.status ?? "").toLowerCase() !== "paid").length;

  function statusBadge(status?: string) {
    const normalized = String(status ?? "").toLowerCase();
    const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium";
    if (normalized === "paid") return `${base} bg-emerald-500/10 text-emerald-600`;
    if (normalized === "overdue") return `${base} bg-red-500/10 text-red-600`;
    return `${base} bg-amber-500/10 text-amber-600`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-sm opacity-70">Professional invoice and payment tracking for daily finance operations.</p>
      </div>

      <FinancePeriodFilter />

      <div className="grid gap-4 md:grid-cols-3">
        <Card variant="solid" className="p-4">
          <div className="mb-2 flex items-center justify-between text-xs uppercase opacity-60">
            <span>Total Invoiced</span>
            <ReceiptText className="h-4 w-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold">{formatMoney(totalInvoiced)}</div>
        </Card>
        <Card variant="solid" className="p-4">
          <div className="mb-2 flex items-center justify-between text-xs uppercase opacity-60">
            <span>Total Paid</span>
            <Wallet className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold">{formatMoney(totalPaid)}</div>
        </Card>
        <Card variant="solid" className="p-4">
          <div className="mb-2 flex items-center justify-between text-xs uppercase opacity-60">
            <span>Pending Invoices</span>
            <Clock3 className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold">{pendingCount.toLocaleString()}</div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-semibold">Invoices in selected period</h2>
          <div className="max-h-[430px] overflow-auto">
            <ul className="space-y-2 text-sm">
              {invoices.map((i) => (
                <li key={String(i.id ?? i.invoice_no)} className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))]/50 px-3 py-2">
                  <div>
                    <div className="font-medium">{String(i.invoice_no ?? "—")}</div>
                    <div className="mt-1">
                      <span className={statusBadge(i.status)}>{String(i.status ?? "pending")}</span>
                    </div>
                  </div>
                  <div className="text-right font-semibold">
                    <span className="inline-flex items-center gap-1">
                      <CircleDollarSign className="h-4 w-4 opacity-60" />
                      {formatMoney(asAmount(i.amount), i.currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">Payments in selected period</h2>
          <div className="max-h-[430px] overflow-auto">
            <ul className="space-y-2 text-sm">
              {payments.map((p) => (
                <li key={String(p.id ?? `${p.invoice_no}-${p.paid_at}`)} className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))]/50 px-3 py-2">
                  <div>
                    <div className="font-medium">{String(p.invoice_no ?? "—")}</div>
                    <div className="mt-1 inline-flex items-center gap-1 text-xs opacity-70">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      {String(p.paid_at ?? "—")}
                    </div>
                  </div>
                  <div className="text-right font-semibold">{formatMoney(asAmount(p.amount), p.currency)}</div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
