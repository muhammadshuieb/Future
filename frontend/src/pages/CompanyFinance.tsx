import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import { canCollectManagerSettlement, hasIspPermission } from "../lib/permissions";
import { cn } from "../lib/utils";
import { Download, Loader2, Printer, RefreshCw } from "lucide-react";

type BalRow = {
  manager_id: string;
  name: string;
  email: string;
  wallet_balance: number;
  manager_obligation_balance: number;
};

export function CompanyFinancePage() {
  const { user } = useAuth();
  const role = user?.role;
  const perms = user?.permissions;

  const canSummary = hasIspPermission(role, perms, "financial_reports:view");
  const canWallets = hasIspPermission(role, perms, "managers:view_wallet");
  const canLedger = hasIspPermission(role, perms, "managers:view_wallet");
  const canStatement = hasIspPermission(role, perms, "managers:view_statement");
  const canSettleView = hasIspPermission(role, perms, "managers:view_statement");
  const canCollectSettlement = canCollectManagerSettlement(role, perms);
  const canCommissions =
    hasIspPermission(role, perms, "financial_reports:view") ||
    (role === "manager" && hasIspPermission(role, perms, "managers:view_statement"));
  const canExpenses = hasIspPermission(role, perms, "expenses:view");
  const canAssets = hasIspPermission(role, perms, "assets:view");
  const canCashboxRead =
    hasIspPermission(role, perms, "cashbox:manage") || hasIspPermission(role, perms, "financial_reports:view");
  const canReports = hasIspPermission(role, perms, "financial_reports:view");
  const canExport = hasIspPermission(role, perms, "financial_reports:export");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [managerFilter, setManagerFilter] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [balances, setBalances] = useState<BalRow[]>([]);
  const [ledger, setLedger] = useState<Record<string, unknown>[]>([]);
  const [statement, setStatement] = useState<Record<string, unknown>[]>([]);
  const [settlements, setSettlements] = useState<Record<string, unknown>[]>([]);
  const [commissions, setCommissions] = useState<Record<string, unknown>[]>([]);
  const [expenses, setExpenses] = useState<Record<string, unknown>[]>([]);
  const [assets, setAssets] = useState<Record<string, unknown>[]>([]);
  const [shifts, setShifts] = useState<Record<string, unknown>[]>([]);
  const [revByMgr, setRevByMgr] = useState<Record<string, unknown>[]>([]);
  const [oblig, setOblig] = useState<Record<string, unknown>[]>([]);
  const [unpaid, setUnpaid] = useState<Record<string, unknown>[]>([]);
  const [prepaid, setPrepaid] = useState<Record<string, unknown>[]>([]);

  const [settleAmount, setSettleAmount] = useState("");
  const [settleMethod, setSettleMethod] = useState("cash");
  const [settleNote, setSettleNote] = useState("");
  const [settleCurrency, setSettleCurrency] = useState<"USD" | "SYP" | "TRY">("USD");
  const [settleSaving, setSettleSaving] = useState(false);
  const [settleSuccess, setSettleSuccess] = useState<string | null>(null);

  const mgrQ = useMemo(() => {
    const m = managerFilter.trim();
    return m ? `?manager_id=${encodeURIComponent(m)}` : "";
  }, [managerFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const tasks: Promise<void>[] = [];

      if (canSummary) {
        tasks.push(
          (async () => {
            const r = await apiFetch("/api/company-finance/reports/summary");
            if (r.ok) setSummary((await r.json()) as Record<string, unknown>);
          })()
        );
      }
      if (canWallets) {
        tasks.push(
          (async () => {
            const r = await apiFetch("/api/company-finance/managers/balances");
            if (r.ok) {
              const j = (await r.json()) as { items: BalRow[] };
              setBalances(j.items ?? []);
            }
          })()
        );
      }
      if (canLedger) {
        tasks.push(
          (async () => {
            const r = await apiFetch(`/api/company-finance/wallet/ledger${mgrQ}`);
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setLedger(j.items ?? []);
            }
          })()
        );
      }
      if (canStatement) {
        const mid =
          managerFilter.trim() || (role === "manager" ? user?.id ?? "" : "");
        const stq = new URLSearchParams();
        if (mid) stq.set("manager_id", mid);
        if (from) stq.set("from", from);
        if (to) stq.set("to", to);
        tasks.push(
          (async () => {
            const r = await apiFetch(`/api/company-finance/reports/wallet-statement?${stq.toString()}`);
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setStatement(j.items ?? []);
            } else if (r.status === 400) setStatement([]);
          })()
        );
      }
      if (canSettleView) {
        tasks.push(
          (async () => {
            const r = await apiFetch(`/api/company-finance/settlements/payments${mgrQ}`);
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setSettlements(j.items ?? []);
            }
          })()
        );
      }
      if (canCommissions) {
        tasks.push(
          (async () => {
            const r = await apiFetch(`/api/company-finance/commissions${mgrQ}`);
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setCommissions(j.items ?? []);
            }
          })()
        );
      }
      if (canExpenses) {
        tasks.push(
          (async () => {
            const r = await apiFetch("/api/company-finance/expenses");
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setExpenses(j.items ?? []);
            }
          })()
        );
      }
      if (canAssets) {
        tasks.push(
          (async () => {
            const r = await apiFetch("/api/company-finance/assets");
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setAssets(j.items ?? []);
            }
          })()
        );
      }
      if (canCashboxRead) {
        tasks.push(
          (async () => {
            const r = await apiFetch("/api/company-finance/cashbox/shifts");
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setShifts(j.items ?? []);
            }
          })()
        );
      }
      if (canReports) {
        tasks.push(
          (async () => {
            const r = await apiFetch("/api/company-finance/reports/revenue-by-manager");
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setRevByMgr(j.items ?? []);
            }
          })(),
          (async () => {
            const r = await apiFetch("/api/company-finance/reports/manager-obligations");
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setOblig(j.items ?? []);
            }
          })(),
          (async () => {
            const r = await apiFetch("/api/company-finance/reports/unpaid-by-manager");
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setUnpaid(j.items ?? []);
            }
          })(),
          (async () => {
            const r = await apiFetch("/api/company-finance/reports/prepaid-sales-by-manager");
            if (r.ok) {
              const j = (await r.json()) as { items: Record<string, unknown>[] };
              setPrepaid(j.items ?? []);
            }
          })()
        );
      }

      await Promise.all(tasks);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [
    canSummary,
    canWallets,
    canLedger,
    canStatement,
    canSettleView,
    canCommissions,
    canExpenses,
    canAssets,
    canCashboxRead,
    canReports,
    mgrQ,
    managerFilter,
    from,
    to,
    role,
    user?.id,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportStatementCsv() {
    if (!canExport || !canStatement) return;
    const mid =
      managerFilter.trim() || (role === "manager" ? user?.id ?? "" : "");
    if (!mid) {
      setErr("اختر المدير لتصدير كشف المحفظة");
      return;
    }
    const stq = new URLSearchParams();
    stq.set("manager_id", mid);
    stq.set("format", "csv");
    if (from) stq.set("from", from);
    if (to) stq.set("to", to);
    const r = await apiFetch(`/api/company-finance/reports/wallet-statement?${stq.toString()}`);
    if (!r.ok) {
      const raw = await readApiError(r);
      setErr(formatStaffApiError(r.status, raw, (k: string) => k));
      return;
    }
    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `wallet-statement-${mid}.csv`;
    a.click();
    URL.revokeObjectURL(u);
  }

  const managerOptions = useMemo(() => {
    return balances.map((b) => ({ id: b.manager_id, label: `${b.name} (${b.email})` }));
  }, [balances]);

  const selectedManagerObligation = useMemo(() => {
    const mid = managerFilter.trim();
    if (!mid) return null;
    const row = balances.find((b) => b.manager_id === mid);
    return row ? Number(row.manager_obligation_balance) : null;
  }, [balances, managerFilter]);

  async function submitSettlement(e: React.FormEvent) {
    e.preventDefault();
    if (!canCollectSettlement) return;
    const mid = managerFilter.trim();
    const amount = Number(settleAmount);
    if (!mid) {
      setErr("اختر المدير أولاً");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr("أدخل مبلغ جباية صحيحاً");
      return;
    }
    if (selectedManagerObligation != null && amount > selectedManagerObligation + 0.005) {
      setErr(`المبلغ يتجاوز التزام المدير (${selectedManagerObligation.toFixed(2)})`);
      return;
    }
    setSettleSaving(true);
    setErr(null);
    setSettleSuccess(null);
    try {
      const res = await apiFetch("/api/company-finance/settlements/pay", {
        method: "POST",
        body: JSON.stringify({
          manager_id: mid,
          amount,
          currency: settleCurrency,
          payment_method: settleMethod,
          note: settleNote.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const raw = await readApiError(res);
        if (raw === "settlement_exceeds_obligation") {
          setErr("المبلغ يتجاوز التزام المدير الحالي");
        } else {
          setErr(formatStaffApiError(res.status, raw, (k: string) => k));
        }
        return;
      }
      const j = (await res.json()) as { manager_obligation_balance?: number };
      setSettleAmount("");
      setSettleNote("");
      setSettleSuccess(
        j.manager_obligation_balance != null
          ? `تم تسجيل الجباية. التزام المدير المتبقي: ${Number(j.manager_obligation_balance).toFixed(2)}`
          : "تم تسجيل الجباية بنجاح"
      );
      await load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSettleSaving(false);
    }
  }

  if (!canSummary && !canWallets && !canReports) {
    return (
      <div className="p-6 text-center text-sm opacity-80" dir="rtl">
        لا تملك صلاحية عرض هذه الصفحة (مطلوب عرض التقارير المالية أو محافظ المدراء).
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6" dir="rtl" lang="ar">
      <div className="mx-auto max-w-[1400px] space-y-4 print:p-2">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] pb-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight">المالية العامة للشركة</h1>
            <p className="text-xs opacity-70">لوحة مركزية للأرصدة، المحافظ، التقارير، المصروفات والصندوق</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              className="gap-1.5"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              تحديث
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
              <Printer className="h-3.5 w-3.5" />
              طباعة
            </Button>
          </div>
        </header>

        {err ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{err}</div>
        ) : null}

        <Card className="p-3 print:border-0">
          <div className="mb-2 text-xs font-semibold opacity-80">عوامل التصفية</div>
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <label className="flex flex-col gap-1">
              <span className="opacity-70">المدير</span>
              <select
                className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 min-w-[200px]"
                value={managerFilter}
                onChange={(e) => setManagerFilter(e.target.value)}
                disabled={role === "manager"}
              >
                <option value="">الكل</option>
                {managerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="opacity-70">من تاريخ (كشف المحفظة)</span>
              <input
                type="date"
                className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="opacity-70">إلى تاريخ</span>
              <input
                type="date"
                className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>
              تطبيق
            </Button>
            {canExport && canStatement ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void exportStatementCsv()} className="gap-1">
                <Download className="h-3 w-3" />
                تصدير CSV للكشف
              </Button>
            ) : null}
          </div>
        </Card>

        {loading ? (
          <div className="flex justify-center py-12 text-sm opacity-70">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : null}

        {canSummary && summary ? (
          <section className="space-y-2">
            <h2 className="text-sm font-bold">لوحة مالية عامة</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["total_revenue", "total_expenses", "net_profit"] as const).map((k) => (
                <Card key={k} className="p-3 text-xs">
                  <div className="opacity-70">
                    {k === "total_revenue" ? "إجمالي الإيرادات" : k === "total_expenses" ? "إجمالي المصروفات" : "صافي الربح"}
                  </div>
                  <div className="mt-1 font-mono text-base font-semibold">
                    {summary[k] != null ? String(summary[k]) : "—"}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ) : null}

        {canWallets ? (
          <section className="space-y-2">
            <h2 className="text-sm font-bold">أرصدة المدراء</h2>
            <div className="overflow-x-auto rounded-lg border border-[hsl(var(--border))]">
              <table className="w-full min-w-[640px] border-collapse text-xs">
                <thead className="bg-[hsl(var(--muted))]/40">
                  <tr>
                    <th className="border-b px-2 py-1.5 text-right">المدير</th>
                    <th className="border-b px-2 py-1.5 text-right">البريد</th>
                    <th className="border-b px-2 py-1.5 text-right">رصيد المحفظة</th>
                    <th className="border-b px-2 py-1.5 text-right">التزام الشركة</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.manager_id} className="hover:bg-[hsl(var(--muted))]/20">
                      <td className="border-b px-2 py-1.5">{b.name}</td>
                      <td className="border-b px-2 py-1.5 font-mono">{b.email}</td>
                      <td className="border-b px-2 py-1.5 font-mono">{Number(b.wallet_balance).toFixed(2)}</td>
                      <td className="border-b px-2 py-1.5 font-mono">{Number(b.manager_obligation_balance).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {canLedger ? (
          <section className="space-y-2">
            <h2 className="text-sm font-bold">سجل محفظة المدير (آخر حركات)</h2>
            <CompactTable rows={ledger} />
          </section>
        ) : null}

        {canStatement ? (
          <section className="space-y-2">
            <h2 className="text-sm font-bold">كشف المحفظة مع الرصيد الجاري</h2>
            <CompactTable rows={statement} />
          </section>
        ) : null}

        {canSettleView ? (
          <section className="space-y-2">
            <h2 className="text-sm font-bold">جباية من المدير — دفعات التسوية</h2>
            {canCollectSettlement ? (
              <Card className="p-3">
                <form onSubmit={(e) => void submitSettlement(e)} className="flex flex-wrap items-end gap-3 text-xs">
                  <p className="w-full text-[11px] opacity-70">
                    اختر المدير من عوامل التصفية أعلاه، ثم أدخل مبلغ الجباية (لا يتجاوز التزام الشركة).
                    {selectedManagerObligation != null ? (
                      <span className="mr-2 font-mono text-amber-200">
                        التزام حالي: {selectedManagerObligation.toFixed(2)}
                      </span>
                    ) : null}
                  </p>
                  <label className="flex flex-col gap-1">
                    <span className="opacity-70">المبلغ</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 w-28 font-mono"
                      value={settleAmount}
                      onChange={(e) => setSettleAmount(e.target.value)}
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="opacity-70">العملة</span>
                    <select
                      className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5"
                      value={settleCurrency}
                      onChange={(e) => setSettleCurrency(e.target.value as "USD" | "SYP" | "TRY")}
                    >
                      <option value="USD">USD</option>
                      <option value="SYP">SYP</option>
                      <option value="TRY">TRY</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="opacity-70">طريقة الدفع</span>
                    <select
                      className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5"
                      value={settleMethod}
                      onChange={(e) => setSettleMethod(e.target.value)}
                    >
                      <option value="cash">نقداً</option>
                      <option value="bank">تحويل بنكي</option>
                      <option value="check">شيك</option>
                    </select>
                  </label>
                  <label className="flex min-w-[180px] flex-1 flex-col gap-1">
                    <span className="opacity-70">ملاحظة</span>
                    <input
                      type="text"
                      className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5"
                      value={settleNote}
                      onChange={(e) => setSettleNote(e.target.value)}
                      maxLength={512}
                    />
                  </label>
                  <Button type="submit" size="sm" disabled={settleSaving || !managerFilter.trim()}>
                    {settleSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "تسجيل جباية"}
                  </Button>
                </form>
              </Card>
            ) : null}
            {settleSuccess ? (
              <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {settleSuccess}
              </p>
            ) : null}
            <CompactTable rows={settlements} />
          </section>
        ) : null}

        {canCommissions ? (
          <section className="space-y-2">
            <h2 className="text-sm font-bold">عمولات المدراء</h2>
            <CompactTable rows={commissions} />
          </section>
        ) : null}

        {canExpenses ? (
          <section className="space-y-2">
            <h2 className="text-sm font-bold">المصروفات</h2>
            <CompactTable rows={expenses} />
          </section>
        ) : null}

        {canAssets ? (
          <section className="space-y-2">
            <h2 className="text-sm font-bold">الأصول والمعدات</h2>
            <CompactTable rows={assets} />
          </section>
        ) : null}

        {canCashboxRead ? (
          <section className="space-y-2">
            <h2 className="text-sm font-bold">الصندوق اليومي (ورديات)</h2>
            <CompactTable rows={shifts} />
          </section>
        ) : null}

        {canReports ? (
          <section className="space-y-4">
            <h2 className="text-sm font-bold">التقارير</h2>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold opacity-80">إيرادات حسب المدير المسؤول</h3>
              <CompactTable rows={revByMgr} />
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold opacity-80">التزامات المدراء</h3>
              <CompactTable rows={oblig} />
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold opacity-80">مشتركون غير المسددون — حسب المسؤول</h3>
              <CompactTable rows={unpaid} />
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold opacity-80">مبيعات بطاقات مسبقة الدفع حسب المدير</h3>
              <CompactTable rows={prepaid} />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function CompactTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return <div className="text-xs opacity-60">لا بيانات</div>;
  }
  const keys = Object.keys(rows[0] ?? {});
  return (
    <div className="overflow-x-auto rounded-lg border border-[hsl(var(--border))]">
      <table className={cn("w-full border-collapse text-[11px]")}>
        <thead className="bg-[hsl(var(--muted))]/40">
          <tr>
            {keys.map((k) => (
              <th key={k} className="border-b px-1.5 py-1 text-right font-medium">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((row, i) => (
            <tr key={i} className="hover:bg-[hsl(var(--muted))]/15">
              {keys.map((k) => (
                <td key={k} className="border-b px-1.5 py-1 align-top font-mono">
                  {formatCell(row[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
