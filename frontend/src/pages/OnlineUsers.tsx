import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, WifiOff } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ColumnVisibilityMenu, useColumnVisibility } from "../components/ui/ColumnVisibilityMenu";
import { Modal } from "../components/ui/Modal";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/utils";

type OnlineSession = {
  radacctid: string;
  username: string;
  nasipaddress: string;
  framedipaddress: string;
  callingstationid: string;
  acctstarttime: string | null;
  duration_seconds: number;
  session_bytes: string;
};

type SortKey = "username" | "nas" | "ip" | "usage" | "duration" | "started";
type SortDir = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 500] as const;

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function formatBytes(value: string): string {
  const n = Number(value || "0");
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const x = n / Math.pow(1024, i);
  return `${x.toFixed(x >= 100 || i === 0 ? 0 : x >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatStart(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 19).replace("T", " ");
}

function sortValue(item: OnlineSession, key: SortKey): string | number {
  switch (key) {
    case "username":
      return item.username.toLowerCase();
    case "nas":
      return item.nasipaddress.toLowerCase();
    case "ip":
      return item.framedipaddress.toLowerCase();
    case "usage":
      return Number(item.session_bytes || "0") || 0;
    case "duration":
      return item.duration_seconds || 0;
    case "started":
      return item.acctstarttime ? new Date(item.acctstarttime).getTime() : 0;
    default:
      return "";
  }
}

type ConfirmState =
  | { mode: "single"; item: OnlineSession }
  | { mode: "bulk"; count: number; usernames: string[] };

export function OnlineUsersPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canDisconnect = user?.role === "admin" || user?.role === "manager";

  const [rawItems, setRawItems] = useState<OnlineSession[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [bulkWorking, setBulkWorking] = useState(false);

  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("started");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const onlineColumns = useMemo(
    () => [
      { key: "username", label: t("users.username") },
      { key: "nas", label: t("onlineUsers.nas") },
      { key: "ip", label: t("onlineUsers.ip") },
      { key: "usage", label: t("onlineUsers.usage") },
      { key: "duration", label: t("onlineUsers.duration") },
      { key: "started", label: t("onlineUsers.started") },
    ],
    [t]
  );
  const onlineColumnVisibility = useColumnVisibility("online-users", onlineColumns);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("/api/online-users?limit=1000");
      if (!r.ok) throw new Error(await readApiError(r));
      const data = (await r.json()) as { count: number; sessions: OnlineSession[] };
      setCount(Number(data.count ?? 0));
      setRawItems(Array.isArray(data.sessions) ? data.sessions : []);
      setSelectedIds((prev) => {
        const next = new Set<string>();
        const ids = new Set((data.sessions ?? []).map((s) => String(s.radacctid)));
        for (const id of prev) {
          if (ids.has(id)) next.add(id);
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filteredSorted = useMemo(() => {
    const q = appliedSearch.trim().toLowerCase();
    let list = rawItems;
    if (q) {
      list = list.filter(
        (s) =>
          s.username.toLowerCase().includes(q) ||
          s.nasipaddress.toLowerCase().includes(q) ||
          s.framedipaddress.toLowerCase().includes(q) ||
          s.callingstationid.toLowerCase().includes(q)
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" }) * dir;
    });
  }, [rawItems, appliedSearch, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageSlice = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSorted.slice(start, start + pageSize);
  }, [filteredSorted, currentPage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [appliedSearch, pageSize, sortKey, sortDir]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const selectedOnPage = pageSlice.filter((r) => selectedIds.has(r.radacctid));
  const allPageSelected = pageSlice.length > 0 && selectedOnPage.length === pageSlice.length;
  const somePageSelected = selectedOnPage.length > 0 && !allPageSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = somePageSelected;
    }
  }, [somePageSelected]);

  const totalUsage = useMemo(
    () => rawItems.reduce((acc, x) => acc + (Number(x.session_bytes || "0") || 0), 0),
    [rawItems]
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "started" || key === "duration" || key === "usage" ? "desc" : "asc");
    }
  }

  function sortHeader(label: string, key: SortKey, align: string) {
    const active = sortKey === key;
    return (
      <th className={cn("px-4 py-3", align)}>
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className="inline-flex items-center gap-1 hover:opacity-80"
        >
          {label}
          <span className="text-[10px] opacity-70">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePageAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const r of pageSlice) next.delete(r.radacctid);
      } else {
        for (const r of pageSlice) next.add(r.radacctid);
      }
      return next;
    });
  }

  function openConfirmSingle(item: OnlineSession) {
    if (!canDisconnect) return;
    setConfirm({ mode: "single", item });
  }

  function openConfirmBulk() {
    if (!canDisconnect || selectedIds.size === 0) return;
    const picked = rawItems.filter((r) => selectedIds.has(r.radacctid));
    setConfirm({
      mode: "bulk",
      count: picked.length,
      usernames: picked.map((p) => p.username),
    });
  }

  async function runDisconnectSingle(item: OnlineSession) {
    setDisconnectingId(item.radacctid);
    setError(null);
    try {
      const enc = encodeURIComponent(item.radacctid);
      const r = await apiFetch(`/api/online-users/${enc}/disconnect`, {
        method: "POST",
        body: "{}",
      });
      const text = await r.text();
      let j: { ok?: boolean; detail?: string; error?: string } = {};
      try {
        j = JSON.parse(text) as typeof j;
      } catch {
        /* ignore */
      }
      if (!r.ok) {
        throw new Error(j.detail || j.error || text || `HTTP ${r.status}`);
      }
      if (j.ok === false) {
        throw new Error(j.detail || "disconnect_failed");
      }
      setConfirm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDisconnectingId(null);
    }
  }

  async function runDisconnectBulk(ids: string[]) {
    setBulkWorking(true);
    setError(null);
    try {
      const r = await apiFetch("/api/online-users/bulk-disconnect", {
        method: "POST",
        body: JSON.stringify({ radacct_ids: ids }),
      });
      if (!r.ok) throw new Error(await readApiError(r));
      const data = (await r.json()) as {
        results: { radacctid: string; ok: boolean; error?: string }[];
      };
      const failed = data.results?.filter((x) => !x.ok) ?? [];
      if (failed.length > 0) {
        setError(
          failed.map((f) => `${f.radacctid}: ${f.error ?? "failed"}`).join("\n") ||
            t("onlineUsers.bulkPartialFail")
        );
      }
      setConfirm(null);
      setSelectedIds(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkWorking(false);
    }
  }

  function onConfirmPrimary() {
    if (!confirm) return;
    if (confirm.mode === "single") {
      void runDisconnectSingle(confirm.item);
    } else {
      const ids = rawItems.filter((r) => selectedIds.has(r.radacctid)).map((r) => r.radacctid);
      void runDisconnectBulk(ids);
    }
  }

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("onlineUsers.title")}</h1>
          <p className="text-sm opacity-70">{t("onlineUsers.subtitle")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin", isRtl ? "ms-2" : "me-2")} />
          {t("common.refresh")}
        </Button>
      </div>

      {error ? (
        <div className="whitespace-pre-wrap rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-1">
          <div className="text-xs uppercase opacity-60">{t("onlineUsers.connectedCount")}</div>
          <div className="text-3xl font-bold">{count}</div>
        </Card>
        <Card className="space-y-1">
          <div className="text-xs uppercase opacity-60">{t("onlineUsers.totalUsage")}</div>
          <div className="text-3xl font-bold">{formatBytes(String(totalUsage))}</div>
        </Card>
      </div>

      <Card className="sticky-list-panel flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedSearch(searchText);
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 opacity-50 start-3" />
            <input
              className="w-56 rounded-lg border border-[hsl(var(--border))] bg-transparent py-2 ps-9 pe-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 sm:w-72"
              placeholder={t("onlineUsers.searchPlaceholder")}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            {t("common.search")}
          </Button>
          {appliedSearch ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSearchText("");
                setAppliedSearch("");
              }}
            >
              {t("users.searchClear")}
            </Button>
          ) : null}
        </form>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 opacity-80">
            <span>{t("onlineUsers.perPage")}</span>
            <select
              className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) || 25)}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="opacity-70">
            {t("users.pageLabel")}: {currentPage}/{totalPages} · {t("onlineUsers.matching")}: {filteredSorted.length}
          </span>
          <ColumnVisibilityMenu
            title={t("table.columns")}
            columns={onlineColumns}
            visibleKeys={onlineColumnVisibility.visibleKeys}
            onToggle={onlineColumnVisibility.toggle}
            onShowAll={onlineColumnVisibility.showAll}
            onResetDefault={onlineColumnVisibility.resetDefault}
          />
        </div>
      </Card>

      {canDisconnect && selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-3">
          <span className="text-sm">
            {t("onlineUsers.selectedCount")}: {selectedIds.size}
          </span>
          <Button
            type="button"
            variant="outline"
            className="border-red-500/50 text-red-600 dark:text-red-400"
            onClick={openConfirmBulk}
            disabled={bulkWorking}
          >
            {bulkWorking ? t("common.loading") : t("onlineUsers.disconnectSelected")}
          </Button>
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="sticky-list-table w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
                {canDisconnect ? (
                  <th className="w-10 px-2 py-3">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={togglePageAll}
                      aria-label={t("users.selectAll")}
                    />
                  </th>
                ) : null}
                {onlineColumnVisibility.isVisible("username") ? sortHeader(t("users.username"), "username", isRtl ? "text-right" : "text-left") : null}
                {onlineColumnVisibility.isVisible("nas") ? sortHeader(t("onlineUsers.nas"), "nas", isRtl ? "text-right" : "text-left") : null}
                {onlineColumnVisibility.isVisible("ip") ? sortHeader(t("onlineUsers.ip"), "ip", isRtl ? "text-right" : "text-left") : null}
                {onlineColumnVisibility.isVisible("usage") ? sortHeader(t("onlineUsers.usage"), "usage", isRtl ? "text-right" : "text-left") : null}
                {onlineColumnVisibility.isVisible("duration") ? sortHeader(t("onlineUsers.duration"), "duration", isRtl ? "text-right" : "text-left") : null}
                {onlineColumnVisibility.isVisible("started") ? sortHeader(t("onlineUsers.started"), "started", isRtl ? "text-right" : "text-left") : null}
                <th className={cn("px-4 py-3", isRtl ? "text-left" : "text-right")}>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {pageSlice.map((item) => (
                <tr key={item.radacctid} className="border-b border-[hsl(var(--border))]/50">
                  {canDisconnect ? (
                    <td className="px-2 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.radacctid)}
                        onChange={() => toggleOne(item.radacctid)}
                        aria-label={item.username}
                      />
                    </td>
                  ) : null}
                  {onlineColumnVisibility.isVisible("username") ? <td className="px-4 py-3 font-medium">{item.username}</td> : null}
                  {onlineColumnVisibility.isVisible("nas") ? <td className="px-4 py-3">{item.nasipaddress || "—"}</td> : null}
                  {onlineColumnVisibility.isVisible("ip") ? <td className="px-4 py-3">{item.framedipaddress || "—"}</td> : null}
                  {onlineColumnVisibility.isVisible("usage") ? <td className="px-4 py-3">{formatBytes(item.session_bytes)}</td> : null}
                  {onlineColumnVisibility.isVisible("duration") ? <td className="px-4 py-3 font-mono">{formatDuration(item.duration_seconds)}</td> : null}
                  {onlineColumnVisibility.isVisible("started") ? <td className="px-4 py-3 font-mono text-xs opacity-90">{formatStart(item.acctstarttime)}</td> : null}
                  <td className={cn("px-4 py-3", isRtl ? "text-left" : "text-right")}>
                    {canDisconnect ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="border-red-500/50 text-red-600 dark:text-red-400"
                        onClick={() => openConfirmSingle(item)}
                        disabled={disconnectingId === item.radacctid || bulkWorking}
                      >
                        {disconnectingId === item.radacctid ? t("common.loading") : t("onlineUsers.disconnect")}
                      </Button>
                    ) : (
                      <span className="text-xs opacity-60">{t("api.error_403")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredSorted.length > pageSize ? (
          <div className="flex flex-wrap justify-center gap-2 border-t border-[hsl(var(--border))]/50 p-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              {t("users.prevPage")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              {t("users.nextPage")}
            </Button>
          </div>
        ) : null}
        {filteredSorted.length === 0 && !loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm opacity-70">
            <WifiOff className="h-4 w-4" />
            {rawItems.length === 0 ? t("onlineUsers.empty") : t("onlineUsers.noSearchResults")}
          </div>
        ) : null}
      </Card>

      <Modal
        open={confirm !== null}
        onClose={() => {
          if (!disconnectingId && !bulkWorking) setConfirm(null);
        }}
        title={t("onlineUsers.confirmTitle")}
        closeOnBackdrop={!disconnectingId && !bulkWorking}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed">
            {confirm?.mode === "single" ? (
              <>
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  {t("onlineUsers.disconnectConfirm")}{" "}
                  <span className="font-mono text-[hsl(var(--primary))]">{confirm.item.username}</span>؟
                </p>
                <p className="mt-2 text-xs opacity-80">{t("onlineUsers.confirmHint")}</p>
              </>
            ) : confirm?.mode === "bulk" ? (
              <>
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  {t("onlineUsers.disconnectSelectedConfirm").replace("{count}", String(confirm.count))}
                </p>
                {confirm.usernames.length <= 8 ? (
                  <p className="mt-2 font-mono text-xs opacity-90">{confirm.usernames.join("، ")}</p>
                ) : (
                  <p className="mt-2 text-xs opacity-80">
                    {confirm.usernames.slice(0, 8).join("، ")}… (+{confirm.usernames.length - 8})
                  </p>
                )}
                <p className="mt-2 text-xs opacity-80">{t("onlineUsers.confirmHint")}</p>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirm(null)}
              disabled={Boolean(disconnectingId) || bulkWorking}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500"
              onClick={onConfirmPrimary}
              disabled={Boolean(disconnectingId) || bulkWorking}
            >
              {disconnectingId || bulkWorking ? t("common.loading") : t("onlineUsers.confirmAction")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
