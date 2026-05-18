import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Printer, FileSpreadsheet, ChevronRight } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { apiFetch, getApiBase, getStaffToken, readApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasIspPermission } from "../lib/permissions";
import { useI18n } from "../context/LocaleContext";
import { Link } from "react-router-dom";
import { cn } from "../lib/utils";
import {
  formatFinanceCell,
  parseFinanceReportPayload,
  type FinanceReportPreview,
} from "../lib/finance-report-preview";

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
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<FinanceReportPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      if (!canWallets && user?.role !== "manager") return;
      const r = await apiFetch("/api/company-finance/managers/balances");
      if (r.ok) {
        const j = (await r.json()) as { items: BalRow[] };
        setManagers(j.items ?? []);
        if (user?.role === "manager") setManagerId(user.id ?? "");
        else if (j.items?.[0]) setManagerId(j.items[0].manager_id);
      }
    })();
  }, [canWallets, user?.role, user?.id]);

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

  const loadJson = async (path: string, title: string, reportKey: string) => {
    setLoadingKey(reportKey);
    setErr(null);
    setPreview({ title, rows: [], columns: [] });
    try {
      const res = await apiFetch(path);
      if (!res.ok) throw new Error(await readApiError(res));
      const j = (await res.json()) as Record<string, unknown>;
      const { rows, columns } = parseFinanceReportPayload(j);
      setPreview({ title, rows, columns });
      requestAnimationFrame(() => {
        previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (e) {
      setPreview(null);
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setLoadingKey(null);
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
    reportKey,
    title,
    desc,
    onPreview,
    csvPath,
    csvName,
    showCsv,
  }: {
    reportKey: string;
    title: string;
    desc: string;
    onPreview: () => void;
    csvPath?: string;
    csvName?: string;
    showCsv?: boolean;
  }) => {
    const busy = loadingKey === reportKey;
    return (
      <Card className="flex flex-col gap-2 border-[hsl(var(--border))]/80 p-4">
        <div className="font-semibold">{title}</div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{desc}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Button type="button" size="sm" variant="outline" onClick={onPreview} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
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
  };

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

      {preview ? (
        <div ref={previewRef} className="scroll-mt-4">
          <Card className="overflow-hidden p-4 print:border-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">{preview.title}</h2>
              {loadingKey ? (
                <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("fd.reports.loading")}
                </span>
              ) : (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {preview.rows.length} {t("fd.reports.rows")}
                </span>
              )}
            </div>
            {loadingKey ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--muted-foreground))]" />
              </div>
            ) : preview.rows.length > 0 && preview.columns.length > 0 ? (
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
                        className={cn(
                          "border-t border-[hsl(var(--border))]/60",
                          i % 2 === 1 && "bg-[hsl(var(--muted))]/20"
                        )}
                      >
                        {preview.columns.map((c) => (
                          <td key={c} className="max-w-[280px] truncate px-2 py-1.5 font-mono">
                            {formatFinanceCell(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                {t("fd.reports.empty")}
              </p>
            )}
          </Card>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 print:hidden">
        {canReports ? (
          <ReportAction
            reportKey="summary"
            title={t("fd.reports.card.summary")}
            desc={t("fd.reports.card.summaryDesc")}
            onPreview={() =>
              void loadJson("/api/company-finance/reports/summary", t("fd.reports.card.summary"), "summary")
            }
          />
        ) : null}
        {canReports ? (
          <ReportAction
            reportKey="revByMgr"
            title={t("fd.reports.card.revByMgr")}
            desc={t("fd.reports.card.revByMgrDesc")}
            onPreview={() =>
              void loadJson(
                "/api/company-finance/reports/revenue-by-manager",
                t("fd.reports.card.revByMgr"),
                "revByMgr"
              )
            }
          />
        ) : null}
        {canReports ? (
          <ReportAction
            reportKey="obligations"
            title={t("fd.reports.card.obligations")}
            desc={t("fd.reports.card.obligationsDesc")}
            onPreview={() =>
              void loadJson(
                "/api/company-finance/reports/manager-obligations",
                t("fd.reports.card.obligations"),
                "obligations"
              )
            }
          />
        ) : null}
        {canReports ? (
          <ReportAction
            reportKey="unpaid"
            title={t("fd.reports.card.unpaid")}
            desc={t("fd.reports.card.unpaidDesc")}
            onPreview={() =>
              void loadJson(
                "/api/company-finance/reports/unpaid-by-manager",
                t("fd.reports.card.unpaid"),
                "unpaid"
              )
            }
          />
        ) : null}
        {canReports ? (
          <ReportAction
            reportKey="prepaid"
            title={t("fd.reports.card.prepaid")}
            desc={t("fd.reports.card.prepaidDesc")}
            onPreview={() =>
              void loadJson(
                "/api/company-finance/reports/prepaid-sales-by-manager",
                t("fd.reports.card.prepaid"),
                "prepaid"
              )
            }
          />
        ) : null}
        {canWallets || user?.role === "manager" ? (
          <ReportAction
            reportKey="ledger"
            title={t("fd.reports.card.ledger")}
            desc={t("fd.reports.card.ledgerDesc")}
            onPreview={() =>
              void loadJson(`/api/company-finance/wallet/ledger${mgrQs}`, t("fd.reports.card.ledger"), "ledger")
            }
          />
        ) : null}
        {canStatement ? (
          <ReportAction
            reportKey="walletStmt"
            title={t("fd.reports.card.walletStmt")}
            desc={t("fd.reports.card.walletStmtDesc")}
            onPreview={() => {
              if (!managerId) {
                setErr(t("fd.reports.needManager"));
                return;
              }
              void loadJson(
                `/api/company-finance/reports/wallet-statement${q}`,
                t("fd.reports.card.walletStmt"),
                "walletStmt"
              );
            }}
            showCsv={Boolean(managerId)}
            csvPath={`/api/company-finance/reports/wallet-statement${q}`}
            csvName="wallet-statement.csv"
          />
        ) : null}
        {canStatement || canReports ? (
          <ReportAction
            reportKey="commissions"
            title={t("fd.reports.card.commissions")}
            desc={t("fd.reports.card.commissionsDesc")}
            onPreview={() =>
              void loadJson(
                `/api/company-finance/commissions${mgrQs}`,
                t("fd.reports.card.commissions"),
                "commissions"
              )
            }
          />
        ) : null}
        {canStatement || canReports ? (
          <ReportAction
            reportKey="settlements"
            title={t("fd.reports.card.settlements")}
            desc={t("fd.reports.card.settlementsDesc")}
            onPreview={() =>
              void loadJson(
                "/api/company-finance/settlements/payments",
                t("fd.reports.card.settlements"),
                "settlements"
              )
            }
          />
        ) : null}
        {canReports && hasIspPermission(user?.role, user?.permissions, "expenses:view") ? (
          <ReportAction
            reportKey="expenses"
            title={t("fd.reports.card.expenses")}
            desc={t("fd.reports.card.expensesDesc")}
            onPreview={() =>
              void loadJson("/api/company-finance/expenses", t("fd.reports.card.expenses"), "expenses")
            }
          />
        ) : null}
        {canReports && hasIspPermission(user?.role, user?.permissions, "assets:view") ? (
          <ReportAction
            reportKey="assets"
            title={t("fd.reports.card.assets")}
            desc={t("fd.reports.card.assetsDesc")}
            onPreview={() => void loadJson("/api/company-finance/assets", t("fd.reports.card.assets"), "assets")}
          />
        ) : null}
      </div>
    </div>
  );
}
