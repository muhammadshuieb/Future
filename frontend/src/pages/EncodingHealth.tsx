import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/LocaleContext";
import { apiFetch, readApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

type Summary = {
  ok: boolean;
  tables_ready: boolean;
  totals: {
    open: number;
    manual_review: number;
    repaired: number;
    ignored: number;
    superseded: number;
  };
  last_scan: Record<string, unknown> | null;
};

type IssueRow = {
  id: string;
  table_name: string;
  column_name: string;
  row_id: string;
  original_preview: string;
  proposed_preview: string | null;
  issue_type: string;
  confidence_score: number;
  status: string;
  repaired: number;
  repair_strategy: string | null;
};

export function EncodingHealthPage() {
  const { user } = useAuth();
  const { t, isRtl } = useI18n();
  const [tab, setTab] = useState<"health" | "diagnostics">("health");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [verification, setVerification] = useState<unknown>(null);
  const [diagnostics, setDiagnostics] = useState<unknown>(null);
  const [preview, setPreview] = useState<{
    id: string;
    current: string;
    repaired: string;
    table: string;
    column: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const perPage = 25;

  const loadSummary = useCallback(async () => {
    const res = await apiFetch("/api/encoding-health/summary");
    if (!res.ok) return;
    setSummary((await res.json()) as Summary);
  }, []);

  const loadIssues = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        status: statusFilter,
      });
      const res = await apiFetch(`/api/encoding-health/issues?${q}`);
      if (!res.ok) {
        setMessage(await readApiError(res));
        return;
      }
      const data = (await res.json()) as { items: IssueRow[]; meta: { total: number } };
      setIssues(data.items);
      setTotal(data.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  const loadVerification = useCallback(async () => {
    const res = await apiFetch("/api/encoding-health/verification");
    if (res.ok) setVerification(await res.json());
  }, []);

  const loadDiagnostics = useCallback(async () => {
    const res = await apiFetch("/api/encoding-health/diagnostics");
    if (res.ok) setDiagnostics(await res.json());
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  useEffect(() => {
    if (tab === "diagnostics") {
      void loadVerification();
      void loadDiagnostics();
    }
  }, [tab, loadVerification, loadDiagnostics]);

  async function runScan(dryRun: boolean) {
    setScanning(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/encoding-health/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun, max_issues: 5000, limit_per_table: 50_000 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage((body as { error?: string }).error ?? (await readApiError(res)));
        return;
      }
      const found = (body as { progress?: { issuesFound?: number } }).progress?.issuesFound ?? 0;
      setMessage(dryRun ? t("encoding.scanDryDone").replace("{count}", String(found)) : t("encoding.scanDone"));
      await loadSummary();
      await loadIssues();
    } finally {
      setScanning(false);
    }
  }

  async function previewIssue(id: string) {
    setMessage(null);
    const res = await apiFetch(`/api/encoding-health/issues/${id}/preview`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setMessage((body as { error?: string }).error ?? "preview failed");
      setPreview(null);
      return;
    }
    const p = body as { preview?: { current: string; repaired: string; table: string; column: string } };
    if (p.preview) setPreview({ id, ...p.preview });
  }

  async function repairIssue(id: string, commit: boolean) {
    setMessage(null);
    const res = await apiFetch(`/api/encoding-health/issues/${id}/repair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit }),
    });
    const body = await res.json();
    if (!res.ok) {
      setMessage((body as { error?: string }).error ?? "repair failed");
      return;
    }
    setMessage(commit ? t("encoding.repairCommitted") : t("encoding.repairPreviewReady"));
    if (commit) {
      setPreview(null);
      await loadSummary();
      await loadIssues();
    }
  }

  async function rollbackIssue(id: string) {
    const res = await apiFetch(`/api/encoding-health/issues/${id}/rollback`, { method: "POST" });
    if (!res.ok) {
      setMessage(await readApiError(res));
      return;
    }
    setMessage(t("encoding.rollbackDone"));
    await loadSummary();
    await loadIssues();
  }

  async function ignoreIssue(id: string) {
    await apiFetch(`/api/encoding-health/issues/${id}/ignore`, { method: "POST" });
    await loadSummary();
    await loadIssues();
  }

  const totals = summary?.totals;
  const scannedTablesHint = useMemo(() => {
    if (!summary?.last_scan) return "—";
    return String((summary.last_scan as { rows_scanned?: number }).rows_scanned ?? "—");
  }, [summary]);

  if (user?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" dir={isRtl ? "rtl" : "ltr"}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("encoding.title")}</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t("encoding.subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={tab === "health" ? "primary" : "outline"}
          className="px-3 py-1.5 text-xs rounded-lg"
          onClick={() => setTab("health")}
        >
          {t("encoding.tabHealth")}
        </Button>
        <Button
          type="button"
          variant={tab === "diagnostics" ? "primary" : "outline"}
          className="px-3 py-1.5 text-xs rounded-lg"
          onClick={() => setTab("diagnostics")}
        >
          {t("encoding.tabDiagnostics")}
        </Button>
        <button
          type="button"
          className="ms-auto inline-flex items-center rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm hover:bg-[hsl(var(--muted))]/40"
          onClick={() => {
            void (async () => {
              const res = await apiFetch("/api/encoding-health/export");
              if (!res.ok) return;
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "encoding-issues.json";
              a.click();
              URL.revokeObjectURL(url);
            })();
          }}
        >
          {t("encoding.export")}
        </button>
      </div>

      {message ? (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 text-sm">{message}</div>
      ) : null}

      {tab === "health" ? (
        <>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
            <Card className="p-4">
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{t("encoding.open")}</div>
              <div className="text-2xl font-semibold">{totals?.open ?? "—"}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{t("encoding.manual")}</div>
              <div className="text-2xl font-semibold">{totals?.manual_review ?? "—"}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{t("encoding.repaired")}</div>
              <div className="text-2xl font-semibold">{totals?.repaired ?? "—"}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{t("encoding.ignored")}</div>
              <div className="text-2xl font-semibold">{totals?.ignored ?? "—"}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{t("encoding.lastRows")}</div>
              <div className="text-2xl font-semibold">{scannedTablesHint}</div>
            </Card>
          </div>

          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={scanning} onClick={() => void runScan(true)}>
                {scanning ? t("common.loading") : t("encoding.scanDry")}
              </Button>
              <Button type="button" variant="soft" disabled={scanning} onClick={() => void runScan(false)}>
                {scanning ? t("common.loading") : t("encoding.scanWrite")}
              </Button>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">{t("encoding.scanHint")}</span>
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium">{t("encoding.filterStatus")}</label>
              <select
                className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1 text-sm"
                value={statusFilter}
                onChange={(e) => {
                  setPage(1);
                  setStatusFilter(e.target.value);
                }}
              >
                <option value="open">open</option>
                <option value="manual_review">manual_review</option>
                <option value="repaired">repaired</option>
                <option value="ignored">ignored</option>
                <option value="superseded">superseded</option>
                <option value="all">all</option>
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-start text-sm">
                <thead className="border-b border-[hsl(var(--border))] text-xs uppercase text-[hsl(var(--muted-foreground))]">
                  <tr>
                    <th className="py-2 pe-3">{t("encoding.colTable")}</th>
                    <th className="py-2 pe-3">{t("encoding.colColumn")}</th>
                    <th className="py-2 pe-3">{t("encoding.colPreview")}</th>
                    <th className="py-2 pe-3">{t("encoding.colConfidence")}</th>
                    <th className="py-2 pe-3">{t("encoding.colStatus")}</th>
                    <th className="py-2">{t("encoding.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[hsl(var(--muted-foreground))]">
                        {t("common.loading")}
                      </td>
                    </tr>
                  ) : issues.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[hsl(var(--muted-foreground))]">
                        {t("encoding.empty")}
                      </td>
                    </tr>
                  ) : (
                    issues.map((it) => (
                      <tr key={it.id} className="border-b border-[hsl(var(--border))]/60 align-top">
                        <td className="py-2 pe-3 font-mono text-xs">{it.table_name}</td>
                        <td className="py-2 pe-3 font-mono text-xs">{it.column_name}</td>
                        <td className="max-w-[280px] py-2 pe-3 break-words text-xs">{it.original_preview}</td>
                        <td className="py-2 pe-3">{Number(it.confidence_score).toFixed(3)}</td>
                        <td className="py-2 pe-3 text-xs">{it.status}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              className="px-3 py-1.5 text-xs rounded-lg"
                              onClick={() => void previewIssue(it.id)}
                            >
                              {t("encoding.preview")}
                            </Button>
                            {it.status !== "repaired" && it.status !== "ignored" && it.status !== "superseded" ? (
                              <>
                                <Button
                                  type="button"
                                  variant="soft"
                                  className="px-3 py-1.5 text-xs rounded-lg"
                                  onClick={() => void repairIssue(it.id, false)}
                                >
                                  {t("encoding.simulate")}
                                </Button>
                                <Button
                                  type="button"
                                  className="px-3 py-1.5 text-xs rounded-lg"
                                  onClick={() => void repairIssue(it.id, true)}
                                >
                                  {t("encoding.commit")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="px-3 py-1.5 text-xs rounded-lg"
                                  onClick={() => void ignoreIssue(it.id)}
                                >
                                  {t("encoding.ignore")}
                                </Button>
                              </>
                            ) : null}
                            {it.repaired === 1 ? (
                              <Button
                                type="button"
                                variant="danger"
                                className="px-3 py-1.5 text-xs rounded-lg"
                                onClick={() => void rollbackIssue(it.id)}
                              >
                                {t("encoding.rollback")}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between pt-2 text-xs text-[hsl(var(--muted-foreground))]">
              <span>{t("encoding.pageTotal").replace("{total}", String(total))}</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="px-3 py-1.5 text-xs rounded-lg"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t("encoding.prev")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="px-3 py-1.5 text-xs rounded-lg"
                  disabled={page * perPage >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("encoding.next")}
                </Button>
              </div>
            </div>
          </Card>

          {preview ? (
            <Card className="space-y-2 p-4">
              <div className="text-sm font-semibold">{t("encoding.previewTitle")}</div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">
                {preview.table}.{preview.column}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs font-medium text-red-500/90">{t("encoding.before")}</div>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/5 p-2 text-xs dark:bg-white/5">
                    {preview.current}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-medium text-emerald-500/90">{t("encoding.after")}</div>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/5 p-2 text-xs dark:bg-white/5">
                    {preview.repaired}
                  </pre>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void repairIssue(preview.id, true)}>
                  {t("encoding.commitThis")}
                </Button>
              </div>
            </Card>
          ) : null}
        </>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-2 text-lg font-semibold">{t("encoding.charsetReport")}</h2>
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/5 p-3 text-[11px] leading-relaxed dark:bg-white/5">
              {verification ? JSON.stringify(verification, null, 2) : t("common.loading")}
            </pre>
          </Card>
          <Card className="space-y-3 p-4">
            <h2 className="text-lg font-semibold">{t("encoding.uiSamples")}</h2>
            <div className="rounded-lg border border-[hsl(var(--border))] p-3 text-lg" dir="rtl" lang="ar">
              {(diagnostics as { arabic_rtl_sample?: string } | null)?.arabic_rtl_sample ?? "—"}
            </div>
            <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{t("encoding.whatsappBlock")}</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-black/5 p-2 text-sm dark:bg-white/5" dir="rtl">
              {(diagnostics as { whatsapp_preview?: string } | null)?.whatsapp_preview ?? ""}
            </pre>
            <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{t("encoding.printHintBlock")}</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-black/5 p-2 text-xs dark:bg-white/5">
              {JSON.stringify((diagnostics as { print_hint?: unknown } | null)?.print_hint ?? {}, null, 2)}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
}
