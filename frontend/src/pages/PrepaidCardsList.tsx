import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CalendarClock, ChartNoAxesCombined, Download, Power, RefreshCw, ShieldCheck, ShieldX, Trash2 } from "lucide-react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useI18n } from "../context/LocaleContext";
import { Modal } from "../components/ui/Modal";
import { SelectField, TextField } from "../components/ui/TextField";
import { cn } from "../lib/utils";

type CardRow = {
  id: number;
  cardnum: string;
  password: string;
  series: string;
  value: number | string;
  total_limit_mb?: number | string;
  expiration: string;
  date: string;
  cardtype: number;
  revoked: number;
  active: number;
  status?: "active" | "expired";
  srvid?: number;
  service_name: string;
};
type CardStats = {
  total_limit_mb?: number;
  usage_bytes?: string;
  daily_total_bytes?: string;
  monthly_total_bytes?: string;
  sessions?: Array<{
    radacctid: string;
    start_time: string | null;
    stop_time: string | null;
    online_seconds: number;
    total_bytes: string;
    nas_ip: string | null;
    is_active: boolean;
  }>;
};
type Pkg = { id: string; name: string };
type SortKey = "id" | "cardnum" | "series" | "service_name" | "value" | "total_limit_mb" | "generated_on" | "valid_till" | "status";
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500] as const;

export function PrepaidCardsListPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired">("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("generated_on");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState<number>(25);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [toggleStatusLoadingId, setToggleStatusLoadingId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<CardRow | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editExpiration, setEditExpiration] = useState("");
  const [editSrvid, setEditSrvid] = useState("");
  const [editActive, setEditActive] = useState("1");
  const [editRevoked, setEditRevoked] = useState("0");
  const [cardStats, setCardStats] = useState<CardStats | null>(null);
  const [cardDetailsLoading, setCardDetailsLoading] = useState(false);
  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), per_page: String(pageSize) });
    if (q.trim()) p.set("q", q.trim());
    p.set("status", statusFilter);
    if (serviceFilter !== "all") p.set("service_id", serviceFilter);
    p.set("sort_key", sortKey);
    p.set("sort_dir", sortDir);
    return p.toString();
  }, [page, pageSize, q, statusFilter, serviceFilter, sortKey, sortDir]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [rCards, rPkg] = await Promise.all([
        apiFetch(`/api/rm-cards/cards?${query}`),
        apiFetch("/api/packages/?account_type=cards"),
      ]);
      if (!rCards.ok) {
        const raw = await readApiError(rCards);
        setErr(formatStaffApiError(rCards.status, raw, t));
        return;
      }
      const j = (await rCards.json()) as { items?: CardRow[]; meta?: { total?: number } };
      const nextItems = j.items ?? [];
      setItems(nextItems);
      setTotal(Number(j.meta?.total ?? 0));
      if (!selectAllMatching) {
        setSelectedIds((current) => current.filter((id) => nextItems.some((x) => x.id === id)));
      } else {
        setExcludedIds((current) => current.filter((id) => nextItems.some((x) => x.id === id)));
      }
      if (rPkg.ok) {
        const p = (await rPkg.json()) as { items?: Pkg[] };
        setPackages((p.items ?? []).map((x) => ({ id: String(x.id), name: String(x.name) })));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query, selectAllMatching, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setSelectedIds([]);
    setSelectAllMatching(false);
    setExcludedIds([]);
  }, [q, statusFilter, serviceFilter, sortKey, sortDir, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const baseFilterPayload = useMemo(
    () => ({
      q: q.trim() || undefined,
      status: statusFilter,
      service_id: serviceFilter === "all" ? undefined : Number(serviceFilter),
    }),
    [q, serviceFilter, statusFilter]
  );
  const selectedCount = selectAllMatching ? Math.max(0, total - excludedIds.length) : selectedIds.length;
  const isChecked = (id: number) => (selectAllMatching ? !excludedIds.includes(id) : selectedIds.includes(id));
  function toggleOne(id: number) {
    if (selectAllMatching) {
      setExcludedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
      return;
    }
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  function toggleAll() {
    const ids = items.map((x) => x.id);
    if (selectAllMatching) {
      const hasAll = ids.every((id) => !excludedIds.includes(id));
      if (hasAll) {
        setExcludedIds((current) => Array.from(new Set([...current, ...ids])));
      } else {
        setExcludedIds((current) => current.filter((id) => !ids.includes(id)));
      }
      return;
    }
    setSelectedIds((current) => {
      const hasAll = ids.every((id) => current.includes(id));
      if (hasAll) return current.filter((id) => !ids.includes(id));
      return Array.from(new Set([...current, ...ids]));
    });
  }
  function clearSelection() {
    setSelectedIds([]);
    setSelectAllMatching(false);
    setExcludedIds([]);
  }
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }
  function header(label: string, key: SortKey) {
    const active = sortKey === key;
    return (
      <th className="px-2 py-2">
        <button type="button" className="inline-flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort(key)}>
          {label}
          <span className="text-[10px] opacity-70">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  }

  function openEdit(row: CardRow) {
    setEditing(row);
    setEditValue(String(row.value ?? 0));
    setEditPassword(String(row.password ?? ""));
    setEditExpiration(String(row.expiration ?? "").slice(0, 10));
    setEditSrvid(String(row.srvid ?? ""));
    setEditActive(String(Number(row.active ?? 1)));
    setEditRevoked(String(Number(row.revoked ?? 0)));
    setEditOpen(true);
    void loadCardDetails(row.id);
  }
  function withTimeout<T>(p: Promise<T>, timeoutMs = 6000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
      p.then((v) => {
        window.clearTimeout(timer);
        resolve(v);
      }).catch((e) => {
        window.clearTimeout(timer);
        reject(e);
      });
    });
  }
  function fmtBytes(value: string | number | null | undefined): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let x = n;
    let i = 0;
    while (x >= 1024 && i < units.length - 1) {
      x /= 1024;
      i++;
    }
    return `${x.toFixed(i === 0 ? 0 : x >= 10 ? 1 : 2)} ${units[i]}`;
  }
  function fmtDateTime(value: string | null | undefined): string {
    if (!value) return "—";
    return String(value).slice(0, 19).replace("T", " ");
  }
  async function loadCardDetails(cardId: number) {
    setCardDetailsLoading(true);
    setCardStats(null);
    try {
      const res = await withTimeout(apiFetch(`/api/rm-cards/cards/${cardId}/stats`));
      if (!res.ok) {
        setCardStats({ sessions: [] });
        return;
      }
      const stats = (await res.json()) as CardStats;
      setCardStats(stats);
    } catch {
      setCardStats({ sessions: [] });
    } finally {
      setCardDetailsLoading(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch(`/api/rm-cards/cards/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          password: editPassword.trim(),
          value: Number(editValue) || 0,
          expiration: editExpiration,
          srvid: Number(editSrvid) || 0,
          active: Number(editActive) ? 1 : 0,
          revoked: Number(editRevoked) ? 1 : 0,
        }),
      });
      if (!r.ok) {
        const raw = await readApiError(r);
        setErr(formatStaffApiError(r.status, raw, t));
        return;
      }
      setEditOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(id: number) {
    if (!confirm(t("prepaid.cardsList.confirmDeleteOne"))) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch(`/api/rm-cards/cards/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const raw = await readApiError(r);
        setErr(formatStaffApiError(r.status, raw, t));
        return;
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteExpired() {
    if (!confirm(t("prepaid.cardsList.confirmDeleteExpired"))) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch("/api/rm-cards/cards-expired", { method: "DELETE" });
      if (!r.ok) {
        const raw = await readApiError(r);
        setErr(formatStaffApiError(r.status, raw, t));
        return;
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function deleteSelected() {
    if (!selectedCount) return;
    if (!confirm(t("prepaid.cardsList.confirmDeleteSelected").replace("{count}", String(selectedCount)))) return;
    setBusy(true);
    setErr(null);
    try {
      const body = selectAllMatching
        ? { all_matching: true, ...baseFilterPayload, exclude_ids: excludedIds }
        : { ids: selectedIds };
      const r = await apiFetch("/api/rm-cards/cards/bulk-delete", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const raw = await readApiError(r);
        setErr(formatStaffApiError(r.status, raw, t));
        return;
      }
      clearSelection();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function isDisabled(row: CardRow): boolean {
    return Number(row.active ?? 1) === 0 || Number(row.revoked ?? 0) === 1;
  }
  async function toggleCardStatus(row: CardRow) {
    const disabled = isDisabled(row);
    const prompt = disabled ? t("prepaid.cardsList.confirmEnable") : t("prepaid.cardsList.confirmDisable");
    if (!confirm(prompt)) return;
    setToggleStatusLoadingId(row.id);
    setErr(null);
    try {
      const endpoint = disabled ? "enable" : "disable";
      const r = await apiFetch(`/api/rm-cards/cards/${row.id}/${endpoint}`, { method: "POST" });
      if (!r.ok) {
        const raw = await readApiError(r);
        setErr(formatStaffApiError(r.status, raw, t));
        return;
      }
      setItems((current) =>
        current.map((x) =>
          x.id === row.id
            ? {
                ...x,
                active: disabled ? 1 : 0,
                revoked: disabled ? 0 : 1,
                status: disabled ? "active" : "expired",
              }
            : x
        )
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setToggleStatusLoadingId(null);
    }
  }
  async function fetchSelectedRows(): Promise<CardRow[] | null> {
    if (!selectedCount) return [];
    if (!selectAllMatching) {
      const ids = new Set(selectedIds);
      return items.filter((x) => ids.has(x.id));
    }
    const allRows: CardRow[] = [];
    let currentPage = 1;
    const maxPerPage = 500;
    const excluded = new Set(excludedIds);
    while (true) {
      const p = new URLSearchParams({
        page: String(currentPage),
        per_page: String(maxPerPage),
        sort_key: sortKey,
        sort_dir: sortDir,
        status: statusFilter,
      });
      if (q.trim()) p.set("q", q.trim());
      if (serviceFilter !== "all") p.set("service_id", serviceFilter);
      const r = await apiFetch(`/api/rm-cards/cards?${p.toString()}`);
      if (!r.ok) {
        const raw = await readApiError(r);
        setErr(formatStaffApiError(r.status, raw, t));
        return null;
      }
      const j = (await r.json()) as { items?: CardRow[]; meta?: { total?: number } };
      const part = (j.items ?? []).filter((x) => !excluded.has(x.id));
      allRows.push(...part);
      if ((j.items ?? []).length < maxPerPage) break;
      currentPage += 1;
    }
    return allRows;
  }
  function exportSelectionCsv(rows: CardRow[]) {
    const header = [
      t("export.cards.id"),
      t("export.cards.card"),
      t("export.cards.password"),
      t("export.cards.series"),
      t("export.cards.service"),
      t("export.cards.value"),
      t("export.cards.type"),
      t("export.cards.generatedOn"),
      t("export.cards.validTill"),
      t("export.cards.status"),
    ].join(",");
    const lines = rows.map((r) =>
      [
        String(r.id),
        r.cardnum,
        r.password,
        r.series,
        r.service_name ?? "",
        String(r.value ?? 0),
        r.cardtype === 1 ? t("prepaid.cardsList.typeRefill") : t("prepaid.cardsList.typeClassic"),
        String(r.date ?? "").slice(0, 10),
        String(r.expiration ?? "").slice(0, 10),
        r.status === "expired" ? t("prepaid.status.expired") : t("prepaid.status.active"),
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "prepaid-cards-selected.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function exportSelectionPdf(rows: CardRow[]) {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t("export.cards.selectedTitle")}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
    </style></head><body>
    <h3>${t("export.cards.selectedHeading")} (${rows.length})</h3>
    <table><thead><tr><th>${t("export.cards.id")}</th><th>${t("export.cards.card")}</th><th>${t("export.cards.password")}</th><th>${t("export.cards.series")}</th><th>${t("export.cards.service")}</th><th>${t("export.cards.value")}</th><th>${t("export.cards.status")}</th></tr></thead><tbody>
    ${rows
      .map(
        (r) =>
          `<tr><td>${r.id}</td><td>${r.cardnum}</td><td>${r.password}</td><td>${r.series}</td><td>${r.service_name ?? ""}</td><td>${r.value ?? 0}</td><td>${(r.status ?? "active") === "active" ? t("prepaid.status.active") : t("prepaid.status.expired")}</td></tr>`
      )
      .join("")}
    </tbody></table>
    <script>window.onload = function() { window.print(); }</script>
    </body></html>`);
    w.document.close();
  }
  async function exportSelectedCsv() {
    setBusy(true);
    const rows = await fetchSelectedRows();
    if (rows && rows.length) exportSelectionCsv(rows);
    setBusy(false);
  }
  async function exportSelectedPdf() {
    setBusy(true);
    const rows = await fetchSelectedRows();
    if (rows && rows.length) exportSelectionPdf(rows);
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-gradient-to-br from-violet-500/10 via-transparent to-cyan-500/10 p-5">
        <h1 className="text-2xl font-bold tracking-tight">{t("prepaid.cardsList.title")}</h1>
        <p className="mt-1 text-sm opacity-70">{t("prepaid.cardsList.subtitle")}</p>
      </div>
      {err ? (
        <p className="whitespace-pre-wrap rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          {err}
        </p>
      ) : null}
      <Card className="space-y-4 p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="h-10 w-72 rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 text-sm shadow-sm"
              placeholder={t("prepaid.cardsList.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => setPage(1)}>
              {t("common.search")}
            </Button>
            <SelectField
              label=""
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as "all" | "active" | "expired");
                setPage(1);
              }}
            >
              <option value="all">{t("prepaid.status.all")}</option>
              <option value="active">{t("prepaid.status.active")}</option>
              <option value="expired">{t("prepaid.status.expired")}</option>
            </SelectField>
            <SelectField
              label=""
              value={serviceFilter}
              onChange={(e) => {
                setServiceFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">{t("prepaid.cardsList.allPackages")}</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs opacity-70">{t("users.perPage")}:</span>
            <select
              className="h-10 rounded-xl border border-[hsl(var(--border))] bg-transparent px-2 text-sm"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value) || 25);
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-2.5">
          <Button type="button" variant="outline" className="rounded-lg" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </Button>
          <Button type="button" variant="outline" className="rounded-lg" onClick={() => void exportSelectedCsv()} disabled={busy || selectedCount === 0}>
            <Download className="me-2 h-4 w-4" />
            {t("prepaid.cardsList.csv")}
          </Button>
          <Button type="button" variant="outline" className="rounded-lg" onClick={() => void exportSelectedPdf()} disabled={busy || selectedCount === 0}>
            <Download className="me-2 h-4 w-4" />
            {t("prepaid.cardsList.pdf")}
          </Button>
          <Button type="button" variant="outline" className="rounded-lg text-red-600" onClick={() => void deleteSelected()} disabled={busy || selectedCount === 0}>
            <Trash2 className="me-2 h-4 w-4" />
            {t("users.deleteSelected")}
          </Button>
          <Button type="button" variant="outline" className="rounded-lg text-red-600" onClick={() => void deleteExpired()} disabled={busy}>
            <Trash2 className="me-2 h-4 w-4" />
            {t("prepaid.cardsList.deleteExpired")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={cn("rounded-lg", selectAllMatching ? "border-violet-500 text-violet-700 dark:text-violet-300" : "")}
            onClick={() => {
              setSelectAllMatching((prev) => !prev);
              setSelectedIds([]);
              setExcludedIds([]);
            }}
            disabled={total === 0}
          >
            {selectAllMatching ? t("prepaid.cardsList.clearAllResults") : t("prepaid.cardsList.selectAllResults")}
          </Button>
          <Button type="button" variant="outline" className="rounded-lg" onClick={clearSelection} disabled={!selectedCount}>
            {t("users.clearSelection")}
          </Button>
          <span className="ms-auto rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">{t("prepaid.cardsList.total")}: {total}</span>
          <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
            {t("users.selected")}: {selectedCount}
          </span>
        </div>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[1120px] text-sm">
          <thead>
            <tr className="bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
              <th className="px-2 py-2">
                <input type="checkbox" checked={items.length > 0 && items.every((x) => isChecked(x.id))} onChange={toggleAll} />
              </th>
              {header("#", "id")}
              {header(t("prepaid.cardsList.colCard"), "cardnum")}
              <th className="px-2 py-2">{t("users.password")}</th>
              {header(t("prepaid.cardsList.colSeries"), "series")}
              {header(t("prepaid.cardsList.colService"), "service_name")}
              {header(t("prepaid.cardsList.colValue"), "value")}
              {header(t("prepaid.cardsList.colTotalLimitMb"), "total_limit_mb")}
              <th className="px-2 py-2">{t("prepaid.cardsList.colType")}</th>
              {header(t("prepaid.cardsList.colGenerated"), "generated_on")}
              {header(t("prepaid.cardsList.colValidTill"), "valid_till")}
              {header(t("users.status"), "status")}
              <th className="px-2 py-2">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-[hsl(var(--border))]/50 transition hover:bg-[hsl(var(--muted))]/30"
                onClick={() => openEdit(r)}
              >
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    checked={isChecked(r.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleOne(r.id);
                    }}
                  />
                </td>
                <td className="px-2 py-1 font-mono text-xs">{r.id}</td>
                <td className="px-2 py-1 font-mono text-xs">{r.cardnum}</td>
                <td className="px-2 py-1 font-mono text-xs">{r.password}</td>
                <td className="px-2 py-1 font-mono">{r.series}</td>
                <td className="px-2 py-1">{r.service_name}</td>
                <td className="px-2 py-1">{r.value}</td>
                <td className="px-2 py-1">{Number(r.total_limit_mb ?? 0)}</td>
                <td className="px-2 py-1">{r.cardtype === 1 ? t("prepaid.cardsList.typeRefill") : t("prepaid.cardsList.typeClassic")}</td>
                <td className="px-2 py-1">{String(r.date ?? "").slice(0, 10)}</td>
                <td className="px-2 py-1">{String(r.expiration ?? "").slice(0, 10)}</td>
                <td className="px-2 py-1">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                      isDisabled(r)
                        ? "bg-red-500/20 text-red-700 dark:text-red-300"
                        : (r.status ?? "active") === "active"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                    )}
                  >
                    {isDisabled(r) ? t("prepaid.status.disabled") : (r.status ?? "active") === "active" ? t("prepaid.status.active") : t("prepaid.status.expired")}
                  </span>
                </td>
                <td className="px-2 py-1">
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "me-1 rounded-lg px-2 py-1 text-xs",
                      isDisabled(r)
                        ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                        : "border-amber-500/40 text-amber-700 dark:text-amber-300"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleCardStatus(r);
                    }}
                    disabled={busy || toggleStatusLoadingId === r.id}
                  >
                    <Power className="me-1 h-3.5 w-3.5" />
                    {toggleStatusLoadingId === r.id ? "..." : isDisabled(r) ? t("users.enable") : t("users.disable")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-lg px-2 py-1 text-xs text-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteOne(r.id);
                    }}
                    disabled={busy}
                  >
                    <Trash2 className="me-1 h-3.5 w-3.5" />
                    {t("common.delete")}
                  </Button>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td className="px-3 py-6 text-center opacity-60" colSpan={13}>
                  {t("prepaid.cardsList.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" className="rounded-lg" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          {t("users.prevPage")}
        </Button>
        <span className="rounded-lg border border-[hsl(var(--border))] px-3 py-1 text-sm opacity-80">
          {page} / {totalPages}
        </span>
        <Button type="button" variant="outline" className="rounded-lg" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
          {t("users.nextPage")}
        </Button>
      </div>
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t("prepaid.cardsList.editTitle")}>
        {editing ? (
          <div className="space-y-3">
            {(() => {
              const totalLimitMb = Number(cardStats?.total_limit_mb ?? editing.total_limit_mb ?? 0);
              const totalLimitBytes = totalLimitMb > 0 ? totalLimitMb * 1024 * 1024 : 0;
              const usedBytes = Number(cardStats?.usage_bytes ?? 0);
              const remainingBytes = totalLimitBytes > 0 ? Math.max(0, totalLimitBytes - Math.max(0, usedBytes)) : 0;
              const progress = totalLimitBytes > 0 ? Math.min(100, Math.max(0, (usedBytes / totalLimitBytes) * 100)) : 0;
              const disabled = isDisabled(editing);
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {t("prepaid.cardsList.cardStatus")}
                    </div>
                    <div className={cn("text-sm font-semibold", disabled ? "text-red-600" : "text-emerald-600")}>
                      {disabled ? t("prepaid.status.disabled") : t("prepaid.status.active")}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
                      <ChartNoAxesCombined className="h-3.5 w-3.5" />
                      {t("users.remainingQuota")}
                    </div>
                    <div className="text-sm font-semibold">{totalLimitMb > 0 ? fmtBytes(remainingBytes) : t("packages.unlimited")}</div>
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
                      <Activity className="h-3.5 w-3.5" />
                      {t("profile.totalUsage")}
                    </div>
                    <div className="text-sm font-semibold">{fmtBytes(usedBytes)}</div>
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {t("users.expires")}
                    </div>
                    <div className="text-sm font-semibold">{editExpiration || "—"}</div>
                  </div>
                  <div className="sm:col-span-2 rounded-xl border border-[hsl(var(--border))] p-3">
                    <div className="mb-2 flex items-center justify-between text-xs opacity-70">
                      <span>{t("prepaid.cardsList.usageProgress")}</span>
                      <span>{totalLimitMb > 0 ? `${progress.toFixed(1)}%` : t("packages.unlimited")}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          progress >= 90 ? "bg-red-500" : progress >= 70 ? "bg-amber-500" : "bg-emerald-500"
                        )}
                        style={{ width: `${totalLimitMb > 0 ? progress : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })()}
            <TextField label={t("prepaid.cardsList.colCard")} value={editing.cardnum} disabled />
            <TextField label={t("users.password")} value={editPassword} onChange={(e) => setEditPassword(e.target.value)} />
            <TextField label={t("prepaid.cardsList.colValue")} type="number" min={0} value={editValue} onChange={(e) => setEditValue(e.target.value)} />
            <TextField label={t("prepaid.cardsList.colTotalLimitMb")} value={String(editing.total_limit_mb ?? 0)} disabled />
            <TextField label={t("prepaid.cardsList.colValidTill")} type="date" value={editExpiration} onChange={(e) => setEditExpiration(e.target.value)} />
            <TextField label={t("prepaid.cardsList.serviceId")} type="number" min={0} value={editSrvid} onChange={(e) => setEditSrvid(e.target.value)} />
            <label className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm">
              <input type="checkbox" checked={editActive === "1"} onChange={(e) => setEditActive(e.target.checked ? "1" : "0")} />
              <span className="inline-flex items-center gap-1">
                {editActive === "1" ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> : <ShieldX className="h-3.5 w-3.5 text-red-600" />}
                {t("prepaid.status.active")}
              </span>
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm">
              <input type="checkbox" checked={editRevoked === "1"} onChange={(e) => setEditRevoked(e.target.checked ? "1" : "0")} />
              <span>{t("prepaid.cardsList.revoked")}</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" onClick={() => void saveEdit()} disabled={busy}>
                {busy ? t("common.loading") : t("common.save")}
              </Button>
            </div>
            <div className="rounded-xl border border-[hsl(var(--border))] p-3">
              <div className="mb-2 text-xs font-semibold opacity-70">{t("profile.trafficTitle")}</div>
              {cardDetailsLoading ? (
                <div className="text-xs opacity-70">{t("common.loading")}</div>
              ) : (
                <div className="space-y-2 text-xs">
                  {!(cardStats?.sessions?.length ?? 0) ? (
                    <div className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-center opacity-70">{t("prepaid.cardsList.noStats")}</div>
                  ) : null}
                  <div>{t("profile.totalUsage")}: <span className="font-mono">{fmtBytes(cardStats?.usage_bytes)}</span></div>
                  <div>{t("profile.dailyTotals")}: <span className="font-mono">{fmtBytes(cardStats?.daily_total_bytes)}</span></div>
                  <div>{t("profile.monthlyTotals")}: <span className="font-mono">{fmtBytes(cardStats?.monthly_total_bytes)}</span></div>
                  <div>
                    {t("users.remainingQuota")}:{" "}
                    <span className="font-mono">
                      {Number(cardStats?.total_limit_mb ?? editing.total_limit_mb ?? 0) > 0
                        ? fmtBytes(Math.max(0, Number(cardStats?.total_limit_mb ?? editing.total_limit_mb ?? 0) * 1024 * 1024 - Number(cardStats?.usage_bytes ?? 0)))
                        : t("packages.unlimited")}
                    </span>
                  </div>
                  <div className="mt-2 max-h-44 overflow-auto rounded border border-[hsl(var(--border))]/60">
                    <table className="w-full text-[11px]">
                      <thead className="bg-[hsl(var(--muted))]/40">
                        <tr>
                          <th className="px-2 py-1 text-start">{t("profile.sessionStart")}</th>
                          <th className="px-2 py-1 text-start">{t("profile.sessionStop")}</th>
                          <th className="px-2 py-1 text-start">{t("profile.totalOnline")}</th>
                          <th className="px-2 py-1 text-start">{t("profile.totalUsage")}</th>
                          <th className="px-2 py-1 text-start">{t("users.nas")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(cardStats?.sessions ?? []).slice(0, 20).map((s) => (
                          <tr key={s.radacctid} className="border-t border-[hsl(var(--border))]/40">
                            <td className="px-2 py-1 font-mono">{String(s.start_time ?? "").slice(0, 19).replace("T", " ") || "—"}</td>
                            <td className="px-2 py-1 font-mono">{s.is_active ? t("profile.activeSession") : fmtDateTime(s.stop_time)}</td>
                            <td className="px-2 py-1 font-mono">{s.online_seconds ?? 0}</td>
                            <td className="px-2 py-1 font-mono">{fmtBytes(s.total_bytes ?? "0")}</td>
                            <td className="px-2 py-1 font-mono">{s.nas_ip ?? "—"}</td>
                          </tr>
                        ))}
                        {!(cardStats?.sessions ?? []).length ? (
                          <tr>
                            <td className="px-2 py-2 text-center opacity-60" colSpan={5}>{t("prepaid.cardsList.noSessions")}</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
