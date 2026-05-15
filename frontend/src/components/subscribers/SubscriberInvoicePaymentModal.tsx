import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../context/LocaleContext";
import { apiFetch, formatStaffApiError, readApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { SelectField, TextField } from "../ui/TextField";

type Pkg = { id: string; name: string; price?: number | string | null; currency?: string | null };

type BillingContext = {
  subscriber: {
    id: string;
    username: string;
    package_id: string | null;
    package_name: string | null;
    package_price: number;
    currency: string;
    billing_period_days: number;
    created_at: string | null;
    start_date: string | null;
    expiration_date: string | null;
  };
  open_invoice: {
    id: string;
    invoice_no: string;
    amount: number;
    currency: string;
    status: string;
    balance: number;
    paid_sum: number;
  } | null;
  arrears_total: number;
  unpaid_invoices: Array<{
    id: string;
    invoice_no: string;
    amount: number;
    currency: string;
    balance: number;
    status: string;
    issue_date: string | null;
  }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  subscriberId: string;
  username: string;
  packages: Pkg[];
  onFinished: (result: { deferred?: boolean; partial?: boolean; allocation?: boolean }) => void;
};

function numOrZero(v: string): number {
  const n = Number(String(v).replace(/,/g, ".").trim());
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function SubscriberInvoicePaymentModal({
  open,
  onClose,
  subscriberId,
  username,
  packages,
  onFinished,
}: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ctx, setCtx] = useState<BillingContext | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [packageId, setPackageId] = useState("");
  const [initialPackageId, setInitialPackageId] = useState<string | null>(null);
  const [invoiceAmountStr, setInvoiceAmountStr] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [payTiming, setPayTiming] = useState<"immediate" | "defer">("immediate");
  const [payAmountStr, setPayAmountStr] = useState("");
  const [dueDateStr, setDueDateStr] = useState("");
  const [sendWaReminder, setSendWaReminder] = useState(false);
  const [allocationMode, setAllocationMode] = useState(false);
  const [allocInputs, setAllocInputs] = useState<Record<string, string>>({});
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState("");

  const loadContext = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    setCtx(null);
    try {
      const enc = encodeURIComponent(subscriberId);
      const r = await apiFetch(`/api/subscribers/${enc}/billing-context`);
      if (!r.ok) {
        const raw = await readApiError(r);
        setLoadErr(formatStaffApiError(r.status, raw, t));
        return;
      }
      const data = (await r.json()) as BillingContext;
      setCtx(data);
      const orig = data.subscriber.package_id;
      setInitialPackageId(orig);
      const pid = orig ?? packages[0]?.id ?? "";
      setPackageId(pid);
      const cur = data.open_invoice;
      const due = cur && cur.balance > 0 ? cur.balance : data.subscriber.package_price;
      setInvoiceAmountStr(due > 0 ? String(due) : "");
      setCurrency((cur?.currency ?? data.subscriber.currency ?? "USD").toUpperCase());
      setPayTiming("immediate");
      setPayAmountStr("");
      setDueDateStr("");
      setSendWaReminder(false);
      setAllocationMode(false);
      const allocInit: Record<string, string> = {};
      for (const inv of data.unpaid_invoices) {
        allocInit[inv.id] = "";
      }
      setAllocInputs(allocInit);
    } finally {
      setLoading(false);
    }
  }, [subscriberId, t, packages]);

  useEffect(() => {
    if (open) void loadContext();
  }, [open, loadContext]);

  function sortedUnpaid() {
    if (!ctx) return [];
    return [...ctx.unpaid_invoices].sort((a, b) => String(a.issue_date ?? "").localeCompare(String(b.issue_date ?? "")));
  }

  function fillOldestFirst() {
    const total = numOrZero(payAmountStr);
    if (!ctx || total <= 0) return;
    const next: Record<string, string> = { ...allocInputs };
    for (const k of Object.keys(next)) next[k] = "";
    let left = round2(total);
    for (const inv of sortedUnpaid()) {
      if (left <= 0) break;
      const apply = Math.min(left, inv.balance);
      next[inv.id] = apply > 0 ? String(apply) : "";
      left = round2(left - apply);
    }
    setAllocInputs(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);
    setSaving(true);
    try {
      const enc = encodeURIComponent(subscriberId);
      const invoiceAmount = numOrZero(invoiceAmountStr);
      if (invoiceAmount <= 0) {
        setFormErr(t("users.paymentModal.amountRequired"));
        return;
      }
      const body: Record<string, unknown> = {
        pay_timing: payTiming === "defer" ? "defer" : "immediate",
        payment_method: "manual",
      };
      if (packageId && packageId !== (initialPackageId ?? "")) {
        body.package_id = packageId;
      }
      body.invoice_amount = invoiceAmount;
      body.currency = currency === "SYP" ? "SYP" : currency === "TRY" ? "TRY" : "USD";

      if (payTiming === "defer") {
        if (dueDateStr.trim()) {
          body.due_date = dueDateStr.trim();
        }
        if (sendWaReminder) {
          body.send_whatsapp_reminder = true;
        }
      }

      if (payTiming === "immediate" && subscriptionExpiresAt.trim()) {
        body.subscription_expires_at = subscriptionExpiresAt.trim();
      }

      if (payTiming === "immediate" && allocationMode && ctx && ctx.unpaid_invoices.length > 1) {
        const pairs: { invoice_id: string; amount: number }[] = [];
        for (const inv of ctx.unpaid_invoices) {
          const v = numOrZero(allocInputs[inv.id] ?? "");
          if (v > 0) pairs.push({ invoice_id: inv.id, amount: round2(v) });
        }
        if (pairs.length === 0) {
          setFormErr(t("users.paymentModal.allocationEmpty"));
          return;
        }
        const sumAlloc = round2(pairs.reduce((s, p) => s + p.amount, 0));
        if (sumAlloc <= 0) {
          setFormErr(t("users.paymentModal.allocationEmpty"));
          return;
        }
        for (const p of pairs) {
          const inv = ctx.unpaid_invoices.find((i) => i.id === p.invoice_id);
          if (!inv || p.amount > inv.balance + 0.0001) {
            setFormErr(t("users.paymentModal.allocationExceeds"));
            return;
          }
        }
        body.payment_allocations = pairs;
        body.pay_amount = sumAlloc;
      } else if (payTiming === "immediate") {
        const remaining =
          ctx?.open_invoice && ctx.open_invoice.balance > 0
            ? ctx.open_invoice.balance
            : invoiceAmount;
        const payN = payAmountStr.trim() ? numOrZero(payAmountStr) : remaining;
        if (payN <= 0) {
          setFormErr(t("users.paymentModal.payAmountInvalid"));
          return;
        }
        if (payN < remaining - 0.0001) {
          body.pay_amount = payN;
        }
      }

      const r = await apiFetch(`/api/subscribers/${enc}/record-package-payment`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const raw = await readApiError(r);
        setFormErr(formatStaffApiError(r.status, raw, t));
        return;
      }
      const out = (await r.json()) as { deferred?: boolean; partial?: boolean; allocation?: boolean };
      onFinished({
        deferred: Boolean(out.deferred),
        partial: Boolean(out.partial),
        allocation: Boolean(out.allocation),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const portalOnlyErr = loadErr?.toLowerCase().includes("portal_only");

  return (
    <Modal open={open} onClose={onClose} title={t("users.paymentModal.title")} wide>
      <p className="text-sm opacity-70">
        {username} <span className="font-mono text-xs opacity-60">({subscriberId})</span>
      </p>

      {loading ? (
        <p className="mt-4 text-sm opacity-70">{t("common.loading")}</p>
      ) : loadErr ? (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          {loadErr}
          {portalOnlyErr ? (
            <p className="mt-2 text-xs opacity-90">{t("users.paymentModal.portalOnlyHint")}</p>
          ) : null}
        </div>
      ) : ctx ? (
        <form onSubmit={(e) => void onSubmit(e)} className="mt-4 space-y-4">
          {formErr ? (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
              {formErr}
            </div>
          ) : null}

          <div className="rounded-xl border border-[hsl(var(--border))]/60 bg-[hsl(var(--muted))]/30 p-3 text-sm">
            <div className="font-medium">{t("users.package")}</div>
            <div className="mt-1 opacity-80">
              {ctx.subscriber.package_name ?? "—"} — {ctx.subscriber.package_price.toLocaleString()}{" "}
              {ctx.subscriber.currency}
            </div>
            {ctx.open_invoice ? (
              <div className="mt-2 text-xs opacity-80">
                {t("users.paymentModal.openInvoice")}: {ctx.open_invoice.invoice_no} —{" "}
                {t("users.paymentModal.balance")}: {ctx.open_invoice.balance.toLocaleString()}{" "}
                {ctx.open_invoice.currency}
              </div>
            ) : null}
          </div>

          {ctx.arrears_total > 0.01 ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
              <div className="font-medium">{t("users.paymentModal.arrearsTitle")}</div>
              <div className="mt-1">
                {t("users.paymentModal.arrearsTotal")}: {ctx.arrears_total.toLocaleString()}{" "}
                {ctx.subscriber.currency}
              </div>
              {ctx.unpaid_invoices.length > 1 ? (
                <ul className="mt-2 max-h-28 list-inside list-disc overflow-auto text-xs opacity-90">
                  {ctx.unpaid_invoices.map((inv) => (
                    <li key={inv.id}>
                      {inv.invoice_no} — {inv.balance.toLocaleString()} {inv.currency}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {packages.length > 0 ? (
            <SelectField label={t("users.paymentModal.packageOverride")} value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.price != null && p.price !== "" ? ` (${p.price} ${p.currency ?? ""})` : ""}
                </option>
              ))}
            </SelectField>
          ) : (
            <p className="text-xs opacity-70">{t("users.paymentModal.noPackages")}</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t("users.paymentModal.invoiceAmount")}
              value={invoiceAmountStr}
              onChange={(e) => setInvoiceAmountStr(e.target.value)}
              inputMode="decimal"
            />
            <SelectField label={t("packages.currency")} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="SYP">SYP</option>
              <option value="TRY">TRY</option>
            </SelectField>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("users.paymentModal.payTiming")}</legend>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="payTiming"
                checked={payTiming === "immediate"}
                onChange={() => {
                  setPayTiming("immediate");
                  setAllocationMode(false);
                }}
              />
              {t("users.paymentModal.payNow")}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="payTiming"
                checked={payTiming === "defer"}
                onChange={() => {
                  setPayTiming("defer");
                  setAllocationMode(false);
                }}
              />
              {t("users.paymentModal.payLater")}
            </label>
          </fieldset>

          {payTiming === "defer" ? (
            <div className="space-y-3 rounded-xl border border-[hsl(var(--border))]/50 p-3">
              <TextField
                type="date"
                label={t("users.paymentModal.dueDate")}
                value={dueDateStr}
                onChange={(e) => setDueDateStr(e.target.value)}
              />
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sendWaReminder}
                  onChange={(e) => setSendWaReminder(e.target.checked)}
                />
                {t("users.paymentModal.sendWaReminder")}
              </label>
              <p className="text-xs opacity-70">{t("users.paymentModal.sendWaReminderHint")}</p>
            </div>
          ) : null}

          {payTiming === "immediate" && ctx.unpaid_invoices.length > 1 ? (
            <div className="space-y-2 rounded-xl border border-[hsl(var(--border))]/50 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={allocationMode}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setAllocationMode(on);
                    if (on && !payAmountStr.trim() && ctx.arrears_total > 0) {
                      setPayAmountStr(String(ctx.arrears_total));
                    }
                  }}
                />
                {t("users.paymentModal.allocationMode")}
              </label>
              {allocationMode ? (
                <div className="space-y-2">
                  <TextField
                    label={t("users.paymentModal.allocationTotal")}
                    value={payAmountStr}
                    onChange={(e) => setPayAmountStr(e.target.value)}
                    inputMode="decimal"
                  />
                  <Button type="button" variant="outline" className="text-xs" onClick={() => fillOldestFirst()}>
                    {t("users.paymentModal.fillOldestFirst")}
                  </Button>
                  <div className="max-h-40 overflow-auto text-xs">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-[hsl(var(--border))] text-start opacity-80">
                          <th className="py-1 pe-2">{t("users.paymentModal.invCol")}</th>
                          <th className="py-1 pe-2">{t("users.paymentModal.balanceCol")}</th>
                          <th className="py-1">{t("users.paymentModal.payCol")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedUnpaid().map((inv) => (
                          <tr key={inv.id} className="border-b border-[hsl(var(--border))]/40">
                            <td className="py-1 pe-2 font-mono">{inv.invoice_no}</td>
                            <td className="py-1 pe-2">
                              {inv.balance.toLocaleString()} {inv.currency}
                            </td>
                            <td className="py-1">
                              <input
                                className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1 py-0.5 font-mono"
                                value={allocInputs[inv.id] ?? ""}
                                onChange={(e) =>
                                  setAllocInputs((prev) => ({ ...prev, [inv.id]: e.target.value }))
                                }
                                inputMode="decimal"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {payTiming === "immediate" ? (
            <TextField
              type="date"
              label={t("users.paymentModal.subscriptionExpires")}
              value={subscriptionExpiresAt}
              onChange={(e) => setSubscriptionExpiresAt(e.target.value)}
              hint={t("users.paymentModal.subscriptionExpiresHint")}
            />
          ) : null}

          {payTiming === "immediate" && !allocationMode ? (
            <TextField
              label={t("users.paymentModal.payAmountHint")}
              value={payAmountStr}
              onChange={(e) => setPayAmountStr(e.target.value)}
              placeholder={t("users.paymentModal.payAmountPlaceholder")}
              inputMode="decimal"
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))]/50 pt-3">
            <Button type="submit" disabled={saving}>
              {saving ? t("common.loading") : payTiming === "defer" ? t("users.paymentModal.saveDefer") : t("users.paymentModal.submitPay")}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Link
              to={`/billing?subscriber=${encodeURIComponent(subscriberId)}`}
              className="ms-auto text-sm text-[hsl(var(--primary))] hover:underline"
            >
              {t("users.paymentModal.openBilling")}
            </Link>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
