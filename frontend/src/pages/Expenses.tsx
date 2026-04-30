import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, CircleDollarSign, Pencil, Plus, Receipt, Trash2, TriangleAlert } from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { SelectField, TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useFinancePeriod } from "../context/FinancePeriodContext";
import { getFinancePeriodMonths } from "../lib/finance-period";
import { FinancePeriodFilter } from "../components/finance/FinancePeriodFilter";

type ExpenseRow = {
  id: string;
  name: string;
  sku: string;
  category_id?: string | null;
  unit_cost?: number;
  stock_qty?: number;
};
type Category = { id: string; name: string };
type MonthlyReport = {
  month: string;
  expense_cost: number;
  stock_added_cost: number;
  payments_total: number;
  invoices_total: number;
};

export function ExpensesPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unitCost, setUnitCost] = useState("0");
  const [stockQty, setStockQty] = useState("0");
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { period } = useFinancePeriod();
  const periodMonths = useMemo(() => getFinancePeriodMonths(period), [period]);

  const load = useCallback(async () => {
    const [productsRes, categoriesRes] = await Promise.all([
      apiFetch("/api/inventory/products"),
      apiFetch("/api/inventory/categories"),
    ]);
    if (productsRes.ok) {
      const j = (await productsRes.json()) as { items: ExpenseRow[] };
      setItems(j.items ?? []);
    }
    if (categoriesRes.ok) {
      const j = (await categoriesRes.json()) as { items: Category[] };
      setCategories(j.items ?? []);
    }
  }, []);

  const loadReport = useCallback(async () => {
    const rows = await Promise.all(
      periodMonths.map(async (month) => {
        const res = await apiFetch(`/api/inventory/report/monthly?month=${encodeURIComponent(month)}`);
        if (!res.ok) return null;
        return (await res.json()) as MonthlyReport;
      })
    );
    const valid = rows.filter((item): item is MonthlyReport => Boolean(item));
    const combined: MonthlyReport = {
      month: periodMonths.join(","),
      expense_cost: valid.reduce((sum, item) => sum + Number(item.expense_cost ?? 0), 0),
      stock_added_cost: valid.reduce((sum, item) => sum + Number(item.stock_added_cost ?? 0), 0),
      payments_total: valid.reduce((sum, item) => sum + Number(item.payments_total ?? 0), 0),
      invoices_total: valid.reduce((sum, item) => sum + Number(item.invoices_total ?? 0), 0),
    };
    setReport(combined);
  }, [periodMonths]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );
  const expenseCost = Number(report?.expense_cost ?? 0);
  const stockAddedCost = Number(report?.stock_added_cost ?? 0);
  const paymentsTotal = Number(report?.payments_total ?? 0);
  const invoicesTotal = Number(report?.invoices_total ?? 0);
  const monthlyProfit = paymentsTotal - expenseCost;
  const overdueAmount = Math.max(0, invoicesTotal - paymentsTotal);
  const maxFinanceValue = Math.max(invoicesTotal, paymentsTotal, expenseCost, stockAddedCost, 1);
  const financeBars = [
    { key: "invoiced", label: t("expenses.totalInvoiced"), value: invoicesTotal, tone: "bg-indigo-500/80" },
    { key: "collected", label: t("expenses.totalPayments"), value: paymentsTotal, tone: "bg-emerald-500/80" },
    { key: "expenses", label: t("expenses.totalExpenses"), value: expenseCost, tone: "bg-rose-500/80" },
    { key: "stock", label: t("expenses.totalStockAdded"), value: stockAddedCost, tone: "bg-amber-500/80" },
  ];

  async function createExpense() {
    setMessage(null);
    if (!sku.trim() || !name.trim()) return;
    const res = await apiFetch("/api/inventory/products", {
      method: "POST",
      body: JSON.stringify({
        sku: sku.trim(),
        name: name.trim(),
        category_id: categoryId || null,
        unit_cost: Number(unitCost || 0),
        stock_qty: Number(stockQty || 0),
      }),
    });
    if (!res.ok) {
      const raw = await readApiError(res);
      setMessage(formatStaffApiError(res.status, raw, t));
      return;
    }
    setSku("");
    setName("");
    setCategoryId("");
    setUnitCost("0");
    setStockQty("0");
    await load();
  }

  async function editExpense(item: ExpenseRow) {
    const nextName = prompt(t("expenses.name"), item.name) ?? item.name;
    const nextCostRaw = prompt(t("expenses.amount"), String(item.unit_cost ?? 0)) ?? String(item.unit_cost ?? 0);
    const nextQtyRaw = prompt(t("expenses.qty"), String(item.stock_qty ?? 0)) ?? String(item.stock_qty ?? 0);
    const res = await apiFetch(`/api/inventory/products/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: nextName.trim(),
        unit_cost: Number(nextCostRaw || 0),
        stock_qty: Number(nextQtyRaw || 0),
      }),
    });
    if (!res.ok) {
      const raw = await readApiError(res);
      setMessage(formatStaffApiError(res.status, raw, t));
      return;
    }
    await load();
  }

  async function deleteExpense(item: ExpenseRow) {
    if (!confirm(`${t("common.delete")} ${item.name}?`)) return;
    const res = await apiFetch(`/api/inventory/products/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      const raw = await readApiError(res);
      setMessage(formatStaffApiError(res.status, raw, t));
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("expenses.title")}</h1>
        <p className="text-sm opacity-70">{t("expenses.subtitle")}</p>
      </div>

      <FinancePeriodFilter />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card className="p-4" variant="solid">
          <div className="mb-1 flex items-center justify-between text-xs uppercase opacity-60">
            <span>{t("expenses.totalInvoiced")}</span>
            <Receipt className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold">{invoicesTotal.toFixed(2)}</div>
        </Card>
        <Card className="p-4" variant="solid">
          <div className="mb-1 flex items-center justify-between text-xs uppercase opacity-60">
            <span>{t("expenses.totalPayments")}</span>
            <ArrowDownCircle className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold">{paymentsTotal.toFixed(2)}</div>
        </Card>
        <Card className="p-4" variant="solid">
          <div className="mb-1 flex items-center justify-between text-xs uppercase opacity-60">
            <span>{t("expenses.totalExpenses")}</span>
            <ArrowUpCircle className="h-4 w-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold">{expenseCost.toFixed(2)}</div>
        </Card>
        <Card className="p-4" variant="solid">
          <div className="mb-1 flex items-center justify-between text-xs uppercase opacity-60">
            <span>{t("expenses.monthlyProfit")}</span>
            <CircleDollarSign className={`h-4 w-4 ${monthlyProfit >= 0 ? "text-emerald-500" : "text-rose-500"}`} />
          </div>
          <div className={`text-2xl font-bold ${monthlyProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {monthlyProfit.toFixed(2)}
          </div>
        </Card>
        <Card className="p-4" variant="solid">
          <div className="mb-1 flex items-center justify-between text-xs uppercase opacity-60">
            <span>{t("expenses.monthlyOverdue")}</span>
            <TriangleAlert className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{overdueAmount.toFixed(2)}</div>
        </Card>
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("expenses.monthlyComparison")}</h2>
          <span className="text-xs opacity-70">{periodMonths.join(" / ")}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {financeBars.map((bar) => (
            <div key={bar.key} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="opacity-70">{bar.label}</span>
                <span className="font-medium">{bar.value.toFixed(2)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-[hsl(var(--muted))]/60">
                <div className={`h-2.5 rounded-full ${bar.tone}`} style={{ width: `${Math.min((bar.value / maxFinanceValue) * 100, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="grid gap-3 p-4 md:grid-cols-5">
        <TextField label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
        <TextField label={t("expenses.name")} value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label={t("expenses.categoryName")} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{t("common.none")}</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </SelectField>
        <TextField label={t("expenses.amount")} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
        <TextField label={t("expenses.qty")} value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
        <div className="md:col-span-5">
          <Button type="button" onClick={() => void createExpense()}>
            <Plus className="me-2 h-4 w-4" />
            {t("common.add")}
          </Button>
        </div>
      </Card>
      <Card className="sticky-list-panel flex flex-wrap items-center gap-3 p-4 text-sm">
        <Button type="button" variant="outline" onClick={() => void loadReport()}>
          {t("common.refresh")}
        </Button>
        <div className="opacity-80">
          {t("expenses.totalExpenses")}: <strong>{Number(report?.expense_cost ?? 0).toFixed(2)}</strong>
        </div>
        <div className="opacity-80">
          {t("expenses.totalPayments")}: <strong>{Number(report?.payments_total ?? 0).toFixed(2)}</strong>
        </div>
        <div className="opacity-80">
          {t("expenses.monthlyProfit")}:{" "}
          <strong className={monthlyProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
            {monthlyProfit.toFixed(2)}
          </strong>
        </div>
      </Card>
      {message ? <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">{message}</p> : null}
      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="sticky-list-table w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
                <th className="px-4 py-3 text-left">{t("expenses.name")}</th>
                <th className="px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-left">{t("expenses.categoryName")}</th>
                <th className="px-4 py-3 text-left">{t("expenses.amount")}</th>
                <th className="px-4 py-3 text-left">{t("expenses.qty")}</th>
                <th className="px-4 py-3 text-left">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[hsl(var(--border))]/60">
                  <td className="px-4 py-3">{item.name}</td>
                  <td className="px-4 py-3 font-mono text-xs opacity-80">{item.sku}</td>
                  <td className="px-4 py-3">{item.category_id ? categoryNameById.get(item.category_id) ?? "—" : "—"}</td>
                  <td className="px-4 py-3">{Number(item.unit_cost ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3">{Number(item.stock_qty ?? 0)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => void editExpense(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="outline" className="text-red-600" onClick={() => void deleteExpense(item)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 ? <p className="p-6 text-center text-sm opacity-60">{t("expenses.empty")}</p> : null}
      </Card>
    </div>
  );
}
