import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileText, Printer, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField, SelectField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { canManageOperations } from "../lib/permissions";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/utils";

type Pkg = { id: string; name: string };
type SeriesRow = {
  series: string;
  card_type: number;
  generated_on: string;
  valid_till: string;
  gross_card_value: string | number;
  quantity: number;
  service_name: string;
  download_limit_mb: number;
  upload_limit_mb: number;
  total_traffic_limit_mb: number;
  online_time_limit: number;
  available_time_from_activation: number;
  revoked: number;
};
type CardItem = {
  id: number;
  series: string;
  cardnum: string;
  password: string;
  value: string | number;
  expiration: string;
  date: string;
  cardtype: number;
  srvid: number;
  service_name: string;
};
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500] as const;
type SortKey = "series" | "card_type" | "generated_on" | "valid_till" | "gross_card_value" | "quantity" | "service_name";

export function CardBatchPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const can = canManageOperations(user?.role);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [items, setItems] = useState<SeriesRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [count, setCount] = useState(10);
  const [cardType, setCardType] = useState<"classic" | "refill">("classic");
  const [grossValue, setGrossValue] = useState(0);
  const [validTill, setValidTill] = useState("");
  const [prefix, setPrefix] = useState("PRE");
  const [pinLength, setPinLength] = useState(6);
  const [passLength, setPassLength] = useState(6);
  const [packageId, setPackageId] = useState("");
  const [downLimit, setDownLimit] = useState(0);
  const [upLimit, setUpLimit] = useState(0);
  const [totalLimit, setTotalLimit] = useState(0);
  const [onlineLimit, setOnlineLimit] = useState(0);
  const [availableTime, setAvailableTime] = useState(0);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busySeries, setBusySeries] = useState<string | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [sortKey, setSortKey] = useState<SortKey>("generated_on");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [a, b] = await Promise.all([
        apiFetch("/api/packages/?account_type=cards"),
        apiFetch(
          `/api/rm-cards/?page=${currentPage}&per_page=${pageSize}&sort_key=${sortKey}&sort_dir=${sortDir}`
        ),
      ]);
      if (a.ok) {
        const j = (await a.json()) as { items?: { id: string; name: string }[] };
        setPackages((j.items ?? []).map((x) => ({ id: x.id, name: x.name })));
      }
      if (b.ok) {
        const j = (await b.json()) as { items?: SeriesRow[]; meta?: { total?: number } };
        const nextItems = j.items ?? [];
        setItems(nextItems);
        setTotalItems(Number(j.meta?.total ?? nextItems.length ?? 0));
        setSelectedSeries((current) => current.filter((s) => nextItems.some((x) => x.series === s)));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, sortKey, sortDir]);

  useEffect(() => {
    void load();
  }, [load]);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  async function createInSystem() {
    if (!packageId) {
      setErr(t("cardBatch.selectPackage"));
      return;
    }
    if (!validTill) {
      setErr(t("prepaid.series.selectValidTill"));
      return;
    }
    setWorking(true);
    setErr(null);
    setMsg(null);
    try {
      const body = {
        quantity: Math.max(1, Math.min(500, Math.floor(count) || 1)),
        card_type: cardType,
        gross_card_value: Number(grossValue) || 0,
        valid_till: validTill,
        prefix,
        pin_length: Math.max(4, Math.min(16, Math.floor(pinLength) || 6)),
        password_length: Math.max(4, Math.min(8, Math.floor(passLength) || 6)),
        service_id: Number.parseInt(String(packageId), 10) || 0,
        download_limit_mb: Number(downLimit) || 0,
        upload_limit_mb: Number(upLimit) || 0,
        total_limit_mb: Number(totalLimit) || 0,
        online_time_limit: Number(onlineLimit) || 0,
        available_time_from_activation: Number(availableTime) || 0,
      };
      const r = await apiFetch("/api/rm-cards/batch", { method: "POST", body: JSON.stringify(body) });
      if (!r.ok) {
        const raw = await readApiError(r);
        setErr(formatStaffApiError(r.status, raw, t));
        return;
      }
      const j = (await r.json()) as { created?: number; series?: string };
      setMsg(t("prepaid.series.created").replace("{count}", String(j.created ?? 0)).replace("{series}", String(j.series ?? "-")));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  const csvRows = useMemo(() => {
    const header = [
      t("export.series.series"),
      t("export.series.cardType"),
      t("export.series.generatedOn"),
      t("export.series.validTill"),
      t("export.series.grossValue"),
      t("export.series.quantity"),
      t("export.series.service"),
      t("export.series.downloadLimit"),
      t("export.series.uploadLimit"),
      t("export.series.totalLimit"),
      t("export.series.onlineLimit"),
      t("export.series.activationWindow"),
    ].join(",");
    const lines = items.map((r) =>
      [
        r.series,
        r.card_type === 1 ? t("prepaid.cardsList.typeRefill") : t("prepaid.cardsList.typeClassic"),
        r.generated_on ?? "",
        r.valid_till ?? "",
        String(r.gross_card_value ?? 0),
        String(r.quantity ?? 0),
        String(r.service_name ?? ""),
        String(r.download_limit_mb ?? 0),
        String(r.upload_limit_mb ?? 0),
        String(r.total_traffic_limit_mb ?? 0),
        String(r.online_time_limit ?? 0),
        String(r.available_time_from_activation ?? 0),
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(",")
    );
    return [header, ...lines].join("\n");
  }, [items, t]);

  function toCsv() {
    return csvRows;
  }

  function downloadCsv() {
    const blob = new Blob([toCsv()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cards.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function printCards() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t("export.series.pdfTitle")}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
    </style></head><body>
    <h3>${t("export.series.heading")}</h3>
    <table><thead><tr><th>${t("export.series.series")}</th><th>${t("export.series.cardType")}</th><th>${t("export.series.validTill")}</th><th>${t("export.series.grossValue")}</th><th>${t("export.series.quantity")}</th><th>${t("export.series.service")}</th></tr></thead><tbody>
    ${items
      .map(
        (r) =>
          `<tr><td>${r.series}</td><td>${r.card_type === 1 ? t("prepaid.cardsList.typeRefill") : t("prepaid.cardsList.typeClassic")}</td><td>${r.valid_till ?? ""}</td><td>${r.gross_card_value ?? 0}</td><td>${r.quantity ?? 0}</td><td>${r.service_name ?? ""}</td></tr>`
      )
      .join("")}
    </tbody></table>
    <script>window.onload = function() { window.print(); }</script>
    </body></html>`);
    w.document.close();
  }

  async function fetchSeriesCards(series: string): Promise<CardItem[] | null> {
    try {
      const r = await apiFetch(`/api/rm-cards/${encodeURIComponent(series)}/cards`);
      if (!r.ok) {
        const raw = await readApiError(r);
        setErr(formatStaffApiError(r.status, raw, t));
        return null;
      }
      const j = (await r.json()) as { items?: CardItem[] };
      return j.items ?? [];
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  function exportSeriesCsv(series: string, cards: CardItem[]) {
    const header = [
      t("export.cards.id"),
      t("export.cards.series"),
      t("export.cards.card"),
      t("export.cards.password"),
      t("export.cards.value"),
      t("export.cards.validTill"),
      t("export.cards.generatedOn"),
      t("export.cards.type"),
      t("export.cards.service"),
    ].join(",");
    const lines = cards.map((c) =>
      [
        String(c.id),
        c.series,
        c.cardnum,
        c.password,
        String(c.value ?? 0),
        String(c.expiration ?? "").slice(0, 10),
        String(c.date ?? "").slice(0, 10),
        c.cardtype === 1 ? t("prepaid.cardsList.typeRefill") : t("prepaid.cardsList.typeClassic"),
        c.service_name ?? "",
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rm-cards-${series}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportSeriesPdf(series: string, cards: CardItem[]) {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t("export.series.oneSeriesTitle")} ${series}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
    </style></head><body>
    <h3>${t("export.series.oneSeriesTitle")}: ${series}</h3>
    <table><thead><tr><th>${t("export.cards.id")}</th><th>${t("export.cards.card")}</th><th>${t("export.cards.password")}</th><th>${t("export.cards.value")}</th><th>${t("export.cards.validTill")}</th><th>${t("export.cards.service")}</th></tr></thead><tbody>
    ${cards
      .map(
        (c) =>
          `<tr><td>${c.id}</td><td>${c.cardnum}</td><td>${c.password}</td><td>${c.value ?? 0}</td><td>${String(c.expiration ?? "").slice(0, 10)}</td><td>${c.service_name ?? ""}</td></tr>`
      )
      .join("")}
    </tbody></table>
    <script>window.onload = function() { window.print(); }</script>
    </body></html>`);
    w.document.close();
  }

  async function downloadSeriesCsv(series: string) {
    setBusySeries(series);
    setErr(null);
    const cards = await fetchSeriesCards(series);
    if (cards && cards.length > 0) {
      exportSeriesCsv(series, cards);
    }
    setBusySeries(null);
  }

  async function downloadSeriesPdf(series: string) {
    setBusySeries(series);
    setErr(null);
    const cards = await fetchSeriesCards(series);
    if (cards && cards.length > 0) {
      exportSeriesPdf(series, cards);
    }
    setBusySeries(null);
  }

  async function deleteSeries(series: string) {
    if (!confirm(t("prepaid.series.confirmDeleteOne").replace("{series}", series))) return;
    setBusySeries(series);
    setErr(null);
    setMsg(null);
    try {
      const r = await apiFetch(`/api/rm-cards/${encodeURIComponent(series)}`, { method: "DELETE" });
      if (!r.ok) {
        const raw = await readApiError(r);
        setErr(formatStaffApiError(r.status, raw, t));
        return;
      }
      setMsg(t("prepaid.series.deleted").replace("{series}", series));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusySeries(null);
    }
  }
  async function deleteSelectedSeries() {
    if (!selectedSeries.length) return;
    if (!confirm(t("prepaid.series.confirmDeleteSelected").replace("{count}", String(selectedSeries.length)))) return;
    setBusySeries("__bulk__");
    try {
      for (const series of selectedSeries) {
        const r = await apiFetch(`/api/rm-cards/${encodeURIComponent(series)}`, { method: "DELETE" });
        if (!r.ok) {
          const raw = await readApiError(r);
          setErr(formatStaffApiError(r.status, raw, t));
          break;
        }
      }
      setSelectedSeries([]);
      await load();
    } finally {
      setBusySeries(null);
    }
  }
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setCurrentPage(1);
  }
  function toggleOne(series: string) {
    setSelectedSeries((current) =>
      current.includes(series) ? current.filter((x) => x !== series) : [...current, series]
    );
  }
  function toggleAll() {
    const ids = items.map((x) => x.series);
    setSelectedSeries((current) => {
      const hasAll = ids.every((id) => current.includes(id));
      if (hasAll) return current.filter((id) => !ids.includes(id));
      return Array.from(new Set([...current, ...ids]));
    });
  }
  function seriesStatus(validTill: string): "active" | "expired" {
    return validTill && new Date(validTill).getTime() < Date.now() ? "expired" : "active";
  }

  if (!can) {
    return (
      <div className="p-6">
        <p className="text-sm opacity-70">{t("api.error_403")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-gradient-to-br from-violet-500/10 via-transparent to-cyan-500/10 p-5">
        <h1 className="text-2xl font-bold tracking-tight">{t("prepaid.series.title")}</h1>
        <p className="mt-1 text-sm opacity-70">{t("prepaid.series.subtitle")}</p>
      </div>

      {err ? (
        <p className="whitespace-pre-wrap rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          {err}
        </p>
      ) : null}
      {msg ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {msg}
        </p>
      ) : null}

      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2 font-semibold">
          <FileText className="h-4 w-4 text-violet-500" />
          {t("prepaid.series.createSettings")}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label={t("prepaid.series.cardType")} value={cardType} onChange={(e) => setCardType(e.target.value as "classic" | "refill")}>
            <option value="classic">{t("prepaid.cardsList.typeClassic")}</option>
            <option value="refill">{t("prepaid.cardsList.typeRefill")}</option>
          </SelectField>
          <TextField
            label={t("prepaid.series.quantity")}
            type="number"
            min={1}
            max={500}
            value={String(count)}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
          />
          <TextField label={t("prepaid.series.grossValue")} type="number" min={0} value={String(grossValue)} onChange={(e) => setGrossValue(Number(e.target.value) || 0)} />
          <TextField label={t("prepaid.cardsList.colValidTill")} type="date" value={validTill} onChange={(e) => setValidTill(e.target.value)} />
          <TextField
            label={t("prepaid.series.prefix")}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
          <TextField
            label={t("prepaid.series.pinLength")}
            type="number"
            min={4}
            max={16}
            value={String(pinLength)}
            onChange={(e) => setPinLength(Number(e.target.value) || 6)}
          />
          <TextField
            label={t("prepaid.series.passwordLength")}
            type="number"
            min={4}
            max={8}
            value={String(passLength)}
            onChange={(e) => setPassLength(Number(e.target.value) || 6)}
          />
          <SelectField
            label={t("prepaid.series.linkedService")}
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            required
          >
            <option value="">{t("common.none")}</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <TextField label={t("prepaid.series.downloadLimitMb")} type="number" min={0} value={String(downLimit)} onChange={(e) => setDownLimit(Number(e.target.value) || 0)} />
          <TextField label={t("prepaid.series.uploadLimitMb")} type="number" min={0} value={String(upLimit)} onChange={(e) => setUpLimit(Number(e.target.value) || 0)} />
          <TextField label={t("prepaid.series.totalLimitMb")} type="number" min={0} value={String(totalLimit)} onChange={(e) => setTotalLimit(Number(e.target.value) || 0)} />
          <TextField label={t("prepaid.series.onlineTimeLimit")} type="number" min={0} value={String(onlineLimit)} onChange={(e) => setOnlineLimit(Number(e.target.value) || 0)} />
          <TextField label={t("prepaid.series.activationWindow")} type="number" min={0} value={String(availableTime)} onChange={(e) => setAvailableTime(Number(e.target.value) || 0)} />
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-2.5">
          <Button type="button" className="rounded-lg" onClick={createInSystem} disabled={working}>
            {working ? t("common.loading") : t("prepaid.series.createBatch")}
          </Button>
          <Button type="button" variant="outline" className="rounded-lg" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2", loading && "animate-spin")} />
            {t("common.refresh")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-lg text-red-600"
            onClick={() => void deleteSelectedSeries()}
            disabled={busySeries !== null || selectedSeries.length === 0}
          >
            {t("users.deleteSelected")} ({selectedSeries.length})
          </Button>
          <select
            className="h-10 rounded-xl border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) || 25);
              setCurrentPage(1);
            }}
          >
            {PAGE_SIZE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" className="rounded-lg" onClick={downloadCsv} disabled={items.length === 0}>
            <Download className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
            {t("prepaid.cardsList.csv")}
          </Button>
          <Button type="button" variant="outline" className="rounded-lg" onClick={printCards} disabled={items.length === 0}>
            <Printer className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
            {t("prepaid.cardsList.pdf")}
          </Button>
          <span className="ms-auto rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">{t("prepaid.series.total")}: {totalItems}</span>
          <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
            {t("users.selected")}: {selectedSeries.length}
          </span>
        </div>
        <p className="text-xs opacity-60">{t("prepaid.series.hint")}</p>
      </Card>

      {items.length > 0 ? (
        <Card className="overflow-x-auto p-0">
          <div className="border-b border-[hsl(var(--border))] px-4 py-2 text-sm font-medium">
            <FileText className="me-1 inline h-4 w-4" />
            {t("prepaid.series.seriesList")} ({totalItems})
          </div>
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
                <th className="px-2 py-2">
                  <input type="checkbox" checked={items.length > 0 && items.every((x) => selectedSeries.includes(x.series))} onChange={toggleAll} />
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => toggleSort("series")}>{t("prepaid.cardsList.colSeries")}</button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => toggleSort("card_type")}>{t("prepaid.cardsList.colType")}</button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => toggleSort("generated_on")}>{t("prepaid.cardsList.colGenerated")}</button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => toggleSort("valid_till")}>{t("prepaid.cardsList.colValidTill")}</button>
                </th>
                <th className="px-2 py-2">{t("users.status")}</th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => toggleSort("gross_card_value")}>{t("prepaid.series.grossValue")}</button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => toggleSort("quantity")}>{t("prepaid.series.quantityShort")}</button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" onClick={() => toggleSort("service_name")}>{t("prepaid.cardsList.colService")}</button>
                </th>
                <th className="px-2 py-2">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.series} className="border-t border-[hsl(var(--border))]/50 transition hover:bg-[hsl(var(--muted))]/30">
                  <td className="px-2 py-1">
                    <input type="checkbox" checked={selectedSeries.includes(r.series)} onChange={() => toggleOne(r.series)} />
                  </td>
                  <td className="px-2 py-1 font-mono">{r.series}</td>
                  <td className="px-2 py-1">{r.card_type === 1 ? t("prepaid.cardsList.typeRefill") : t("prepaid.cardsList.typeClassic")}</td>
                  <td className="px-2 py-1">{String(r.generated_on ?? "").slice(0, 10)}</td>
                  <td className="px-2 py-1">{String(r.valid_till ?? "").slice(0, 10)}</td>
                  <td className="px-2 py-1">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                        seriesStatus(String(r.valid_till ?? "")) === "active"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                      )}
                    >
                      {seriesStatus(String(r.valid_till ?? "")) === "active" ? t("prepaid.status.active") : t("prepaid.status.expired")}
                    </span>
                  </td>
                  <td className="px-2 py-1">{r.gross_card_value}</td>
                  <td className="px-2 py-1">{r.quantity}</td>
                  <td className="px-2 py-1">{r.service_name}</td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1">
                      <Button type="button" variant="outline" className="rounded-lg px-2 py-1 text-xs" onClick={() => void downloadSeriesCsv(r.series)} disabled={busySeries === r.series}>
                        <Download className={cn("h-3.5 w-3.5", isRtl ? "ms-1" : "me-1")} />
                        {t("prepaid.series.excel")}
                      </Button>
                      <Button type="button" variant="outline" className="rounded-lg px-2 py-1 text-xs" onClick={() => void downloadSeriesPdf(r.series)} disabled={busySeries === r.series}>
                        <Printer className={cn("h-3.5 w-3.5", isRtl ? "ms-1" : "me-1")} />
                        {t("prepaid.series.pdf")}
                      </Button>
                      <Button type="button" variant="ghost" className="rounded-lg px-2 py-1 text-xs text-red-600" onClick={() => void deleteSeries(r.series)} disabled={busySeries === r.series}>
                        <Trash2 className={cn("h-3.5 w-3.5", isRtl ? "ms-1" : "me-1")} />
                        {t("common.delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" className="rounded-lg" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}>
          {t("users.prevPage")}
        </Button>
        <span className="rounded-lg border border-[hsl(var(--border))] px-3 py-1 text-sm opacity-80">
          {currentPage} / {totalPages}
        </span>
        <Button type="button" variant="outline" className="rounded-lg" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
          {t("users.nextPage")}
        </Button>
      </div>
    </div>
  );
}
