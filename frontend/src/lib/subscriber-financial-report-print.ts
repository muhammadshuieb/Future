import { translate, type Locale } from "../i18n/translations";
import { apiFetch, readApiError } from "./api";

function uiLocale(): Locale {
  if (typeof document === "undefined") return "ar";
  return document.documentElement.lang === "en" ? "en" : "ar";
}

type Report = {
  generated_at: string;
  subscriber: {
    id: string;
    username: string;
    subscription_since: string | null;
    expiration_date: string | null;
    current_package: string | null;
    list_price: number;
    currency: string;
  };
  invoices: Array<{
    invoice_no: string;
    amount: number;
    currency: string;
    status: string;
    issue_date: string | null;
    due_date: string | null;
    paid_sum: number;
    balance: number;
  }>;
  payments: Array<{
    invoice_no: string;
    amount: number;
    currency: string;
    method: string;
    paid_at: string | null;
  }>;
  totals: {
    total_invoiced: number;
    total_recorded_payments: number;
    outstanding_balance: number;
  };
};

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function printSubscriberFinancialReport(
  subscriberId: string,
  labels: {
    title: string;
    subscriber: string;
    since: string;
    expires: string;
    package: string;
    invoices: string;
    issueDate: string;
    payments: string;
    paymentDate: string;
    totals: string;
    invoiced: string;
    paid: string;
    outstanding: string;
    noData: string;
    loadError: string;
  },
  /** Open synchronously from a click handler before any await, or popup blockers may prevent printing. */
  previewWindow?: Window | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  let w = previewWindow ?? null;
  const loadErrMsg = translate(uiLocale(), "users.financialReportPrint.loadError");
  if (!w) {
    w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return { ok: false, error: loadErrMsg };
  }

  const enc = encodeURIComponent(subscriberId);
  let r: Response;
  try {
    r = await apiFetch(`/api/subscribers/${enc}/financial-report`);
  } catch (e) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
    return { ok: false, error: `${loadErrMsg}: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!r.ok) {
    const raw = await readApiError(r);
    try {
      w.close();
    } catch {
      /* ignore */
    }
    return { ok: false, error: `${loadErrMsg}: ${raw}` };
  }
  const rep = (await r.json()) as Report;
  const dir = typeof document !== "undefined" && document.documentElement.getAttribute("dir") === "rtl" ? "rtl" : "ltr";
  const rowsInv = rep.invoices.length
    ? rep.invoices
        .map(
          (i) =>
            `<tr><td>${esc(i.invoice_no)}</td><td>${esc(i.issue_date ?? "—")}</td><td>${esc(i.status)}</td><td>${i.amount.toLocaleString()} ${esc(i.currency)}</td><td>${i.paid_sum.toLocaleString()}</td><td>${i.balance.toLocaleString()}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="6">${esc(labels.noData)}</td></tr>`;
  const rowsPay = rep.payments.length
    ? rep.payments
        .map(
          (p) =>
            `<tr><td>${esc(p.invoice_no)}</td><td>${esc(p.paid_at ?? "—")}</td><td>${esc(p.method)}</td><td>${p.amount.toLocaleString()} ${esc(p.currency)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="4">${esc(labels.noData)}</td></tr>`;

  const html = `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"/><title>${esc(labels.title)}</title>
<style>
body{font-family:system-ui,sans-serif;padding:16px;color:#111}
h1{font-size:18px}
table{border-collapse:collapse;width:100%;margin-top:12px;font-size:12px}
th,td{border:1px solid #ccc;padding:6px;text-align:${dir === "rtl" ? "right" : "left"}}
th{background:#f3f4f6}
.summary{margin-top:16px;font-size:13px;line-height:1.6}
</style></head><body>
<h1>${esc(labels.title)}</h1>
<p><strong>${esc(labels.subscriber)}</strong> ${esc(rep.subscriber.username)} (${esc(rep.subscriber.id)})</p>
<p>${esc(labels.since)}: ${esc(rep.subscriber.subscription_since ?? "—")} — ${esc(labels.expires)}: ${esc(rep.subscriber.expiration_date ?? "—")}</p>
<p>${esc(labels.package)}: ${esc(rep.subscriber.current_package ?? "—")} (${rep.subscriber.list_price.toLocaleString()} ${esc(rep.subscriber.currency)})</p>
<h2>${esc(labels.invoices)}</h2>
<table><thead><tr><th>#</th><th>${esc(labels.issueDate)}</th><th>Status</th><th>Amount</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${rowsInv}</tbody></table>
<h2>${esc(labels.payments)}</h2>
<table><thead><tr><th>#</th><th>${esc(labels.paymentDate)}</th><th>Method</th><th>Amount</th></tr></thead><tbody>${rowsPay}</tbody></table>
<div class="summary">
<strong>${esc(labels.totals)}</strong><br/>
${esc(labels.invoiced)}: ${rep.totals.total_invoiced.toLocaleString()}<br/>
${esc(labels.paid)}: ${rep.totals.total_recorded_payments.toLocaleString()}<br/>
${esc(labels.outstanding)}: ${rep.totals.outstanding_balance.toLocaleString()}<br/>
<small>${esc(rep.generated_at)}</small>
</div>
<script>window.onload=function(){window.print();}</script>
</body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
  return { ok: true };
}
