import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Printer, FileSpreadsheet, ChevronRight } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { apiFetch, getApiBase, getStaffToken, readApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasIspPermission } from "../lib/permissions";
import { useI18n } from "../context/LocaleContext";
import { Link } from "react-router-dom";
import { cn } from "../lib/utils";

type BalRow = { manager_id: string; name: string };

export function FinancialReportsHubPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canReports = hasIspPermission(user?.role, user?.permissions, "financial_reports:view");
  const canExport = hasIspPermission(user?.role, user?.permissions, "financial_reports:export");
  const canStatement =
    hasIspPermission(user?.role, user?.permissions, "managers:view_statement") ||
    user?.role === "manager";
  const canWallets = hasIspPermission(user?.role, user?.permissions, "managers:view_wallet");

  const [managers, setManagers] = useState<BalRow[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [managerId, setManagerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ title: string; rows: Record<string, unknown>[]; columns: string[] } | null>(
    null
  );
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (!canWallets && user?.role !== "manager") return;
      const r = await apiFetch("/api/company-finance/managers/balances");
      if (r.ok) {
        const j = (await r.json()) as { items: BalRow[] };
        setManagers(j.items ?? []);
        if (user?.role === "manager") setManagerId(user.sub ?? "");
        else if (j.items?.[0]) setManagerId(j.items[0].manager_id);
      }
    })();
  }, [canWallets, user?.role, user?.sub]);

  const q = useMemo(() => {
    const p = new URLSearchParams();
    if (from.trim()) p.set("from", from.trim().slice(0, 10));
    if (to.trim()) p.set("to", to.trim().slice(0, 10));
    if (managerId.trim()) p.set("manager_id", managerId.trim());
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [from, to, managerId]);

  const mgrQs = useMemo(() => {
    const p = new URLSearchParams();
    if (managerId.trim()) p.set("manager_id", managerId.trim());
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [managerId]);

  const loadJson = async (path: string, title: string) => {
    setLoading(true);
    setErr(null);
    setPreview(null);
    try {
      const res = await apiFetch(path);
      if (!res.ok) throw new Error(await readApiError(res));
      const j = (await res.json()) as Record<string, unknown>;
      let rows: Record<string, unknown>[] = [];
      if (Array.isArray(j.items)) {
        rows = j.items as Record<string, unknown>[];
      } else {
        rows = [j];
      }
      const columns = rows.length ? Object.keys(rows[0]!) : [];
      setPreview({ title, rows, columns });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = useCallback(
    async (path: string, filename: string) => {
      if (!canExport) {
        setErr(t("fd.reports.exportDenied"));
        return;
      }
      const token = getStaffToken();
      const join = path.includes("?") ? "&" : "?";
      const res = await fetch(`${getApiBase()}${path}${join}format=csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        setErr(await readApiError(res));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [canExport, t]
  );

  const ReportAction = ({
    title,
    desc,
    onPreview,
    csvPath,
    csvName,
    showCsv,
  }: {
    title: string;
    desc: string;
    onPreview: () => void;
    csvPath?: string;
    csvName?: string;
    showCsv?: boolean;
  }) => (
    <Card className="flex flex-col gap-2 border-[hsl(var(--border))]/80 p-4">
      <div className="font-semibold">{title}</div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{desc}</p>
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        <Button type="button" size="sm" variant="outline" onClick={onPreview} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
          <span className="ms-1">{t("fd.reports.view")}</span>
        </Button>
        {showCsv && csvPath && csvName ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void downloadCsv(csvPath, csvName)}
            disabled={!canExport}
            title={!canExport ? t("fd.reports.exportDenied") : undefined}
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span className="ms-1">CSV</span>
          </Button>
        ) : null}
      </div>
    </Card>
  );

  if (!canReports && !canStatement) {
    return (
      <div className="p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">{t("fd.forbidden")}</div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("fd.reports.title")}</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("fd.reports.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/financial-dashboard"
            className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm hover:bg-[hsl(var(--muted))]/40"
          >
            {t("fd.reports.backDash")}
          </Link>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            <span className="ms-1">{t("fd.print")}</span>
          </Button>
        </div>
      </div>

      <Card className="space-y-3 p-4 print:hidden">
        <div className="text-sm font-semibold">{t("fd.reports.filters")}</div>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs">
            {t("fd.reports.from")}
            <input
              type="date"
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t("fd.reports.to")}
            <input
              type="date"
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {(canWallets || user?.role === "manager") && (
            <label className="flex flex-col gap-1 text-xs md:col-span-2">
              {t("fd.reports.manager")}
              <select
                className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5"
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
                disabled={user?.role === "manager"}
              >
                <option value="">{t("fd.reports.pickManager")}</option>
                {managers.map((m) => (
                  <option key={m.manager_id} value={m.manager_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Card>

      {err ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm">{err}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 print:hidden">
        {canReports ? (
          <ReportAction
            title={t("fd.reports.card.summary")}
            desc={t("fd.reports.card.summaryDesc")}
            onPreview={() => void loadJson("/api/company-finance/reports/summary", t("fd.reports.card.summary"))}
          />
        ) : null}
        {canReports ? (
          <ReportAction
            title={t("fd.reports.card.revByMgr")}
            desc={t("fd.reports.card.revByMgrDesc")}
            onPreview={() =>
              void loadJson("/api/company-finance/reports/revenue-by-manager", t("fd.reports.card.revByMgr"))
            }
          />
        ) : null}
        {canReports ? (
          <ReportAction
            title={t("fd.reports.card.obligations")}
            desc={t("fd.reports.card.obligationsDesc")}
            onPreview={() =>
              void loadJson("/api/company-finance/reports/manager-obligations", t("fd.reports.card.obligations"))
            }
          />
        ) : null}
        {canReports ? (
          <ReportAction
            title={t("fd.reports.card.unpaid")}
            desc={t("fd.reports.card.unpaidDesc")}
            onPreview={() =>
              void loadJson("/api/company-finance/reports/unpaid-by-manager", t("fd.reports.card.unpaid"))
            }
          />
        ) : null}
        {canReports ? (
          <ReportAction
            title={t("fd.reports.card.prepaid")}
            desc={t("fd.reports.card.prepaidDesc")}
            onPreview={() =>
              void loadJson(
                "/api/company-finance/reports/prepaid-sales-by-manager",
                t("fd.reports.card.prepaid")
              )
            }
          />
        ) : null}
        {canWallets || user?.role === "manager" ? (
          <ReportAction
            title={t("fd.reports.card.ledger")}
            desc={t("fd.reports.card.ledgerDesc")}
            onPreview={() =>
              void loadJson(`/api/company-finance/wallet/ledger${mgrQs}`, t("fd.reports.card.ledger"))
            }
          />
        ) : null}
        {canStatement ? (
          <ReportAction
            title={t("fd.reports.card.walletStmt")}
            desc={t("fd.reports.card.walletStmtDesc")}
            onPreview={() => {
              if (!managerId) {
                setErr(t("fd.reports.needManager"));
                return;
              }
              void loadJson(
                `/api/company-finance/reports/wallet-statement${q}`,
                t("fd.reports.card.walletStmt")
              );
            }}
            showCsv={Boolean(managerId)}
            csvPath={`/api/company-finance/reports/wallet-statement${q}`}
            csvName="wallet-statement.csv"
          />
        ) : null}
        {canStatement || canReports ? (
          <ReportAction
            title={t("fd.reports.card.commissions")}
            desc={t("fd.reports.card.commissionsDesc")}
            onPreview={() =>
              void loadJson(`/api/company-finance/commissions${mgrQs}`, t("fd.reports.card.commissions"))
            }
          />
        ) : null}
        {canStatement || canReports ? (
          <ReportAction
            title={t("fd.reports.card.settlements")}
            desc={t("fd.reports.card.settlementsDesc")}
            onPreview={() =>
              void loadJson("/api/company-finance/settlements/payments", t("fd.reports.card.settlements"))
            }
          />
        ) : null}
        {canReports && hasIspPermission(user?.role, user?.permissions, "expenses:view") ? (
          <ReportAction
            title={t("fd.reports.card.expenses")}
            desc={t("fd.reports.card.expensesDesc")}
            onPreview={() => void loadJson("/api/company-finance/expenses", t("fd.reports.card.expenses"))}
          />
        ) : null}
        {canReports && hasIspPermission(user?.role, user?.permissions, "assets:view") ? (
          <ReportAction
            title={t("fd.reports.card.assets")}
            desc={t("fd.reports.card.assetsDesc")}
            onPreview={() => void loadJson("/api/company-finance/assets", t("fd.reports.card.assets"))}
          />
        ) : null}
      </div>

      {preview && preview.rows.length > 0 ? (
        <Card className="overflow-hidden p-4 print:border-0">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">{preview.title}</h2>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {preview.rows.length} {t("fd.reports.rows")}
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-[hsl(var(--border))]">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="bg-[hsl(var(--muted))]/40">
                <tr>
                  {preview.columns.map((c) => (
                    <th key={c} className="whitespace-nowrap px-2 py-2 text-start font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 200).map((row, i) => (
                  <tr
                    key={i}
                    className={cn("border-t border-[hsl(var(--border))]/60", i % 2 === 1 && "bg-[hsl(var(--muted))]/20")}
                  >
                    {preview.columns.map((c) => (
                      <td key={c} className="max-w-[220px] truncate px-2 py-1.5">
                        {row[c] != null ? String(row[c]) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : preview && preview.rows.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("fd.reports.empty")}</p>
      ) : null}
    </div>
  );
}
