import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleDollarSign, Clock3, ReceiptText, Wallet } from "lucide-react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { ActionDialog } from "../components/ui/ActionDialog";
import { useFinancePeriod } from "../context/FinancePeriodContext";
import { getFinancePeriodMonths, inFinancePeriod } from "../lib/finance-period";
import { FinancePeriodFilter } from "../components/finance/FinancePeriodFilter";
import { BillingDashboard } from "../components/BillingDashboard";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/utils";

type InvoiceRow = {
  id?: string | number;
  subscriber_id?: string | null;
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

function canWriteFinance(role: string | undefined) {
  return role === "admin" || role === "manager" || role === "accountant";
}

export function BillingPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const financeWrite = canWriteFinance(user?.role);
  const { period } = useFinancePeriod();
  const periodMonthSet = useMemo(() => new Set(getFinancePeriodMonths(period)), [period]);
  const [inv, setInv] = useState<InvoiceRow[]>([]);
  const [pay, setPay] = useState<PaymentRow[]>([]);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [packageRef, setPackageRef] = useState("");
  const [packageConfirmOpen, setPackageConfirmOpen] = useState(false);
  const [packageLoading, setPackageLoading] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const packagePayPendingRef = useRef("");

  const reload = useCallback(async () => {
    const [a, b] = await Promise.all([apiFetch("/api/invoices/"), apiFetch("/api/payments/")]);
    if (a.ok) setInv(((await a.json()) as { items?: InvoiceRow[] }).items ?? []);
    if (b.ok) setPay(((await b.json()) as { items?: PaymentRow[] }).items ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  function openPackageConfirm() {
    const id = packageRef.trim();
    if (!id) {
      setMsg({ type: "err", text: t("common.required") });
      return;
    }
    packagePayPendingRef.current = id;
    setPackageConfirmOpen(true);
  }

  async function confirmPackagePayment() {
    const subId = packagePayPendingRef.current.trim();
    setPackageConfirmOpen(false);
    if (!subId || !financeWrite) return;
    setPackageLoading(true);
    setMsg(null);
    try {
      const enc = encodeURIComponent(subId);
      const r = await apiFetch(`/api/subscribers/${enc}/record-package-payment`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const raw = await readApiError(r);
        setMsg({ type: "err", text: formatStaffApiError(r.status, raw, t) });
        return;
      }
      setMsg({ type: "ok", text: t("users.packagePaid") });
      await reload();
    } finally {
      setPackageLoading(false);
    }
  }

  async function onPayInvoice(invoiceId: string) {
    if (!financeWrite) return;
    setPayingInvoiceId(invoiceId);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/invoices/${invoiceId}/mark-paid`, {
        method: "POST",
        body: JSON.stringify({ payment_method: "manual" }),
      });
      if (!res.ok) {
        const raw = await readApiError(res);
        setMsg({ type: "err", text: formatStaffApiError(res.status, raw, t) });
        return;
      }
      setMsg({ type: "ok", text: t("profile.invoicePaid") });
      await reload();
    } finally {
      setPayingInvoiceId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("billing.title")}</h1>
        <p className="text-sm opacity-70">{t("billing.subtitle")}</p>
      </div>

      {msg ? (
        <div
          className={cn(
            "rounded-xl border px-3 py-2 text-sm",
            msg.type === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200"
          )}
        >
          {msg.text}
        </div>
      ) : null}

      <FinancePeriodFilter />

      <BillingDashboard />

      {financeWrite ? (
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">{t("billing.packageSection")}</h2>
          <p className="text-sm opacity-70">{t("billing.packagePayHint")}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <TextField
                label={t("billing.subscriberRef")}
                placeholder={t("billing.subscriberRefPlaceholder")}
                value={packageRef}
                onChange={(e) => setPackageRef(e.target.value)}
              />
            </div>
            <Button type="button" onClick={openPackageConfirm} disabled={packageLoading}>
              {packageLoading ? t("common.loading") : t("users.payPackage")}
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card variant="solid" className="p-4">
          <div className="mb-2 flex items-center justify-between text-xs uppercase opacity-60">
            <span>{t("billing.totalInvoiced")}</span>
            <ReceiptText className="h-4 w-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold">{formatMoney(totalInvoiced)}</div>
        </Card>
        <Card variant="solid" className="p-4">
          <div className="mb-2 flex items-center justify-between text-xs uppercase opacity-60">
            <span>{t("billing.totalPaid")}</span>
            <Wallet className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold">{formatMoney(totalPaid)}</div>
        </Card>
        <Card variant="solid" className="p-4">
          <div className="mb-2 flex items-center justify-between text-xs uppercase opacity-60">
            <span>{t("billing.pendingInvoices")}</span>
            <Clock3 className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold">{pendingCount.toLocaleString()}</div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-semibold">{t("billing.invoicesInPeriod")}</h2>
          <div className="max-h-[430px] overflow-auto">
            <ul className="space-y-2 text-sm">
              {invoices.map((i) => {
                const idStr = i.id != null ? String(i.id) : "";
                const unpaid = String(i.status ?? "").toLowerCase() !== "paid";
                return (
                  <li
                    key={idStr || String(i.invoice_no)}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))]/50 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{String(i.invoice_no ?? "—")}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={statusBadge(i.status)}>{String(i.status ?? "pending")}</span>
                        {i.subscriber_id ? (
                          <span className="text-xs opacity-60">
                            {String(i.subscriber_id)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-semibold">
                        <CircleDollarSign className="h-4 w-4 opacity-60" />
                        {formatMoney(asAmount(i.amount), i.currency)}
                      </span>
                      {financeWrite && unpaid && idStr ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="whitespace-nowrap px-2 py-1 text-xs"
                          onClick={() => void onPayInvoice(idStr)}
                          disabled={payingInvoiceId === idStr}
                        >
                          {payingInvoiceId === idStr ? t("common.loading") : t("profile.payInvoice")}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">{t("billing.paymentsInPeriod")}</h2>
          <div className="max-h-[430px] overflow-auto">
            <ul className="space-y-2 text-sm">
              {payments.map((p) => (
                <li
                  key={String(p.id ?? `${p.invoice_no}-${p.paid_at}`)}
                  className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))]/50 px-3 py-2"
                >
                  <div>
                    <div className="font-medium">{String(p.invoice_no ?? "—")}</div>
                    <div className="mt-1 inline-flex items-center gap-1 text-xs opacity-70">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      {String(p.paid_at ?? "—")}
                    </div>
                  </div>
                  <div className="text-end font-semibold">{formatMoney(asAmount(p.amount), p.currency)}</div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <ActionDialog
        open={packageConfirmOpen}
        title={t("users.payPackage")}
        message={t("users.payPackageConfirm")}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onClose={() => setPackageConfirmOpen(false)}
        onConfirm={() => {
          void confirmPackagePayment();
        }}
      />
    </div>
  );
}
