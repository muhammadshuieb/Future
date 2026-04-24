import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Banknote, Download, Eye, EyeOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { SelectField, TextField, TextAreaField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { canManageOperations } from "../lib/permissions";
import { cn } from "../lib/utils";

type SubscriberRow = {
  id: string;
  username: string;
  status: string | null;
  state?: string | null;
  package_id?: string | null;
  package_name?: string | null;
  nas_server_id?: string | null;
  nas_name?: string | null;
  nas_ip?: string | null;
  created_at?: string | null;
  start_date?: string | null;
  expiration_date?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  pool?: string | null;
  notes?: string | null;
  used_bytes?: string | number | bigint | null;
  quota_total_bytes?: string | number | bigint | null;
  creator_name?: string | null;
  creator_email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  phone?: string | null;
  address?: string | null;
  region_name?: string | null;
  is_online?: number | string | null;
};
type Pkg = { id: string; name: string; price?: number | string | null; currency?: string | null };
type Nas = { id: string; name: string; ip: string };
type RegionRow = { id: string; name: string; parent_id?: string | null };
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500] as const;
type SortKey =
  | "username"
  | "full_name"
  | "phone"
  | "status"
  | "package_name"
  | "nas_network"
  | "region_name"
  | "created_by"
  | "created_at"
  | "start_date"
  | "expiration_date";

function asSubscriberRow(value: Record<string, unknown>): SubscriberRow {
  return {
    id: String(value.id ?? ""),
    username: String(value.username ?? ""),
    status: value.status != null ? String(value.status) : null,
    state: value.state != null ? String(value.state) : null,
    package_id: value.package_id != null ? String(value.package_id) : null,
    package_name: value.package_name != null ? String(value.package_name) : null,
    nas_server_id: value.nas_server_id != null ? String(value.nas_server_id) : null,
    nas_name: value.nas_name != null ? String(value.nas_name) : null,
    nas_ip: value.nas_ip != null ? String(value.nas_ip) : null,
    created_at: value.created_at != null ? String(value.created_at) : null,
    start_date: value.start_date != null ? String(value.start_date) : null,
    expiration_date: value.expiration_date != null ? String(value.expiration_date) : null,
    ip_address: value.ip_address != null ? String(value.ip_address) : null,
    mac_address: value.mac_address != null ? String(value.mac_address) : null,
    pool: value.pool != null ? String(value.pool) : null,
    notes: value.notes != null ? String(value.notes) : null,
    creator_name: value.creator_name != null ? String(value.creator_name) : null,
    creator_email: value.creator_email != null ? String(value.creator_email) : null,
    first_name: value.first_name != null ? String(value.first_name) : null,
    last_name: value.last_name != null ? String(value.last_name) : null,
    nickname: value.nickname != null ? String(value.nickname) : null,
    phone: value.phone != null ? String(value.phone) : null,
    address: value.address != null ? String(value.address) : null,
    region_name: value.region_name != null ? String(value.region_name) : null,
    is_online:
      typeof value.is_online === "number"
        ? value.is_online
        : typeof value.is_online === "string"
          ? Number(value.is_online)
          : null,
    used_bytes:
      typeof value.used_bytes === "number" || typeof value.used_bytes === "string" || typeof value.used_bytes === "bigint"
        ? value.used_bytes
        : null,
    quota_total_bytes:
      typeof value.quota_total_bytes === "number" ||
      typeof value.quota_total_bytes === "string" ||
      typeof value.quota_total_bytes === "bigint"
        ? value.quota_total_bytes
        : null,
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

function toSafeBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.max(0, Math.trunc(value)));
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value.trim());
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function formatBytesCompact(value: bigint): string {
  if (value <= 0n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let x = Number(value);
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : x >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatRemainingQuota(row: SubscriberRow, unlimitedLabel: string): string {
  const quota = toSafeBigInt(row.quota_total_bytes);
  if (quota <= 0n) return unlimitedLabel;
  const used = toSafeBigInt(row.used_bytes);
  const remaining = used >= quota ? 0n : quota - used;
  return formatBytesCompact(remaining);
}

function formatNasLabel(row: SubscriberRow): string {
  if (row.nas_name && row.nas_ip) return `${row.nas_name} (${row.nas_ip})`;
  if (row.nas_name) return row.nas_name;
  if (row.nas_ip) return row.nas_ip;
  return "—";
}

function getRowState(row: SubscriberRow): "online" | "limited" | "expired" | "disabled" | "active" | "default" {
  if (Number(row.is_online ?? 0) > 0) return "online";
  const smart = String(row.state ?? "").trim().toUpperCase();
  if (smart === "LIMITED") return "limited";
  if (smart === "BLOCKED") return "disabled";
  if (smart === "EXPIRED") return "expired";
  if (smart === "ACTIVE") return "active";
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status === "online" || status === "connected") return "online";
  if (status === "disabled" || status === "inactive" || status === "suspended") return "disabled";
  const exp = row.expiration_date ? new Date(row.expiration_date) : null;
  if (exp && !Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) return "expired";
  if (status === "expired") return "expired";
  if (status === "active" || status === "enabled") return "active";
  return "default";
}

function getRowClass(row: SubscriberRow): string {
  const state = getRowState(row);
  if (state === "online")
    return "bg-emerald-500/15 ring-1 ring-emerald-500/30 hover:bg-emerald-500/20";
  if (state === "limited") return "bg-cyan-500/15 hover:bg-cyan-500/20";
  if (state === "expired") return "bg-amber-500/20 hover:bg-amber-500/25";
  if (state === "disabled") return "bg-red-500/20 hover:bg-red-500/25";
  if (state === "active") return "bg-emerald-500/20 hover:bg-emerald-500/25";
  return "hover:bg-[hsl(var(--muted))]/30";
}

export function UsersPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = canManageOperations(user?.role);
  const canRevealPassword = user?.role === "admin" || user?.role === "manager";
  const canPayPackage =
    user?.role === "admin" || user?.role === "manager" || user?.role === "accountant";

  const [items, setItems] = useState<SubscriberRow[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [nasList, setNasList] = useState<Nas[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [passwordLoadingId, setPasswordLoadingId] = useState<string | null>(null);
  const [payPackageLoadingId, setPayPackageLoadingId] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [packageId, setPackageId] = useState("");
  const [nasId, setNasId] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [macAddress, setMacAddress] = useState("");
  const [pool, setPool] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [regionId, setRegionId] = useState("");
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [searchText, setSearchText] = useState<string>(searchParams.get("q") ?? "");
  const [sortKey, setSortKey] = useState<SortKey>("username");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const appliedSearch = searchParams.get("q")?.trim() ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const q = new URLSearchParams({
        page: String(currentPage),
        per_page: String(pageSize),
        sort_key: sortKey,
        sort_dir: sortDir,
      });
      if (appliedSearch) q.set("q", appliedSearch);
      const [rSub, rPkg, rNas, rReg] = await Promise.all([
        apiFetch(`/api/subscribers/?${q.toString()}`),
        apiFetch("/api/packages/"),
        apiFetch("/api/nas/"),
        apiFetch("/api/regions/"),
      ]);
      const errParts: string[] = [];
      if (rSub.ok) {
        const j = (await rSub.json()) as {
          items: Record<string, unknown>[];
          meta?: { total?: number };
        };
        const nextItems = j.items.map(asSubscriberRow);
        setItems(nextItems);
        setTotalItems(Number(j.meta?.total ?? nextItems.length ?? 0));
        setSelectedIds((current) => current.filter((id) => nextItems.some((item) => item.id === id)));
      } else {
        const raw = await readApiError(rSub);
        errParts.push(`${t("nav.users")}: ${formatStaffApiError(rSub.status, raw, t)}`);
      }
      if (rPkg.ok) {
        const j = (await rPkg.json()) as { items: Pkg[] };
        setPackages(j.items);
      } else {
        const raw = await readApiError(rPkg);
        errParts.push(`${t("nav.packages")}: ${formatStaffApiError(rPkg.status, raw, t)}`);
      }
      if (rNas.ok) {
        const j = (await rNas.json()) as { nas_servers: Nas[] };
        setNasList(j.nas_servers ?? []);
      } else {
        const raw = await readApiError(rNas);
        errParts.push(`${t("nav.nas")}: ${formatStaffApiError(rNas.status, raw, t)}`);
      }
      if (rReg.ok) {
        const j = (await rReg.json()) as { items: RegionRow[] };
        setRegions(j.items ?? []);
      } else {
        setRegions([]);
      }
      if (errParts.length) setLoadError(errParts.join("\n"));
    } finally {
      setLoading(false);
    }
  }, [t, currentPage, pageSize, sortKey, sortDir, appliedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const visibleItems = items;
  const regionSelectOptions = useMemo(() => {
    const byParent = new Map<string | null, RegionRow[]>();
    for (const r of regions) {
      const p = r.parent_id ?? null;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(r);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    const out: { id: string; label: string }[] = [];
    function walk(parent: string | null, depth: number) {
      for (const r of byParent.get(parent) ?? []) {
        const pad = depth > 0 ? `${"— ".repeat(depth)}` : "";
        out.push({ id: r.id, label: `${pad}${r.name}` });
        walk(r.id, depth + 1);
      }
    }
    walk(null, 0);
    return out;
  }, [regions]);
  const selectedVisibleCount = visibleItems.filter((item) => selectedSet.has(item.id)).length;
  const allSelected = visibleItems.length > 0 && selectedVisibleCount === visibleItems.length;
  const selectedRows = useMemo(() => items.filter((item) => selectedSet.has(item.id)), [items, selectedSet]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleItems.length;
  }, [selectedVisibleCount, visibleItems.length]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [totalPages]);

  useEffect(() => {
    setSearchText(searchParams.get("q") ?? "");
  }, [searchParams]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!packageId) {
      setMsg({ type: "err", text: t("common.required") });
      return;
    }
    setSaving(true);
    try {
      const r = await apiFetch("/api/subscribers/", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          package_id: packageId,
          nas_server_id: nasId || null,
          nickname: nickname || undefined,
          first_name: firstName || undefined,
          last_name: lastName || undefined,
          phone: phone || undefined,
          address: address || undefined,
          ip_address: ipAddress || undefined,
          mac_address: macAddress || undefined,
          pool: pool || undefined,
          notes: notes || undefined,
          region_id: regionId || null,
        }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        setMsg({ type: "err", text: err.error ?? t("users.createFailed") });
        return;
      }
      setMsg({ type: "ok", text: t("users.created") });
      setModal(false);
      setUsername("");
      setPassword("");
      setPackageId("");
      setNasId("");
      setIpAddress("");
      setMacAddress("");
      setPool("");
      setFirstName("");
      setLastName("");
      setNickname("");
      setPhone("");
      setAddress("");
      setNotes("");
      setRegionId("");
      setSelectedIds([]);
      await load();
    } finally {
      setSaving(false);
    }
  }

  function openCreateModal() {
    setMsg(null);
    setUsername("");
    setPassword("");
    setPackageId("");
    setNasId("");
    setIpAddress("");
    setMacAddress("");
    setPool("");
    setFirstName("");
    setLastName("");
    setNickname("");
    setPhone("");
    setAddress("");
    setNotes("");
    setRegionId("");
    setModal(true);
  }

  async function recordPackagePayment(subscriberId: string) {
    if (!canPayPackage) return;
    if (!confirm(t("users.payPackageConfirm"))) return;
    setPayPackageLoadingId(subscriberId);
    setMsg(null);
    try {
      const r = await apiFetch(`/api/subscribers/${subscriberId}/record-package-payment`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const raw = await readApiError(r);
        setMsg({ type: "err", text: formatStaffApiError(r.status, raw, t) });
        return;
      }
      setMsg({ type: "ok", text: t("users.packagePaid") });
      await load();
    } finally {
      setPayPackageLoadingId(null);
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  function toggleAll() {
    const pageIds = visibleItems.map((item) => item.id);
    setSelectedIds((current) => {
      const currentSet = new Set(current);
      const hasAllPageIds = pageIds.every((id) => currentSet.has(id));
      if (hasAllPageIds) {
        return current.filter((id) => !pageIds.includes(id));
      }
      for (const id of pageIds) currentSet.add(id);
      return Array.from(currentSet);
    });
  }

  async function revealPassword(id: string) {
    if (!canRevealPassword || passwordLoadingId === id || revealedPasswords[id]) return;
    setPasswordLoadingId(id);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/subscribers/${id}/password`);
      if (!res.ok) {
        const raw = await readApiError(res);
        setMsg({ type: "err", text: formatStaffApiError(res.status, raw, t) });
        return;
      }
      const data = (await res.json()) as { password?: string };
      setRevealedPasswords((current) => ({ ...current, [id]: data.password ?? "" }));
    } finally {
      setPasswordLoadingId(null);
    }
  }

  function hidePassword(id: string) {
    setRevealedPasswords((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function exportSelected() {
    if (selectedRows.length === 0) return;
    const rows = selectedRows.map((row) => ({
      username: row.username,
      first_name: row.first_name ?? "",
      last_name: row.last_name ?? "",
      password: canRevealPassword ? revealedPasswords[row.id] ?? "" : "",
      status: row.status ?? "",
      creator_name: row.creator_name ?? "",
      package_name: row.package_name ?? "",
      nas: formatNasLabel(row) === "—" ? "" : formatNasLabel(row),
      nickname: row.nickname ?? "",
      phone: row.phone ?? "",
      address: row.address ?? "",
      region: row.region_name ?? "",
      created_at: row.created_at ?? "",
      start_date: row.start_date ?? "",
      expiration_date: row.expiration_date ?? "",
    }));
    const headers = Object.keys(rows[0]);
    const escape = (value: string) => `"${value.replaceAll("\"", "\"\"")}"`;
    const csv = [headers.join(","), ...rows.map((row) => headers.map((key) => escape(String(row[key as keyof typeof row] ?? ""))).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subscribers-selected.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteOne(id: string, username: string) {
    if (!canManage) return;
    if (!confirm(`${t("users.deleteOneConfirm")} ${username}?`)) return;
    const res = await apiFetch(`/api/subscribers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const raw = await readApiError(res);
      setMsg({ type: "err", text: formatStaffApiError(res.status, raw, t) });
      return;
    }
    setMsg({ type: "ok", text: t("users.deleted") });
    setRevealedPasswords((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSelectedIds((current) => current.filter((x) => x !== id));
    await load();
  }

  async function deleteSelected() {
    if (!canManage || selectedIds.length === 0) return;
    if (!confirm(t("users.deleteSelectedConfirm"))) return;
    const res = await apiFetch("/api/subscribers/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids: selectedIds }),
    });
    if (!res.ok) {
      const raw = await readApiError(res);
      setMsg({ type: "err", text: formatStaffApiError(res.status, raw, t) });
      return;
    }
    setMsg({ type: "ok", text: t("users.deletedSelected") });
    setRevealedPasswords({});
    setSelectedIds([]);
    await load();
  }

  function applySearch() {
    const q = searchText.trim();
    setCurrentPage(1);
    if (q) {
      setSearchParams({ q });
    } else {
      setSearchParams({});
    }
  }

  function toggleSort(key: SortKey) {
    setCurrentPage(1);
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }

  function header(label: string, key: SortKey, alignClass: string) {
    const active = sortKey === key;
    return (
      <th
        className={cn(
          "sticky top-0 z-20 bg-[hsl(var(--card))]/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/75",
          alignClass
        )}
      >
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("users.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("users.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading} title={t("common.refresh")}>
            <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2", loading && "animate-spin")} />
            {t("common.refresh")}
          </Button>
          {canManage ? (
            <Button type="button" onClick={openCreateModal}>
              <Plus className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
              {t("users.add")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="sticky-list-panel rounded-2xl">
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm opacity-80">
            <span>
              {t("users.selected")}: {selectedIds.length}
            </span>
            <span>
              {t("users.pageLabel")}: {currentPage}/{totalPages}
            </span>
            <div className="flex items-center gap-2">
              <span>{t("users.perPage")}:</span>
              <select
                className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm"
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
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                applySearch();
              }}
            >
              <input
                className="w-44 rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm"
                placeholder={t("users.searchPlaceholder")}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              <Button type="submit" variant="outline">
                {t("common.search")}
              </Button>
              {searchText ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSearchText("");
                    setCurrentPage(1);
                    setSearchParams({});
                  }}
                >
                  {t("users.searchClear")}
                </Button>
              ) : null}
            </form>
            <Button type="button" variant="outline" onClick={toggleAll} disabled={visibleItems.length === 0}>
              {allSelected ? t("users.clearSelection") : t("users.selectAll")}
            </Button>
            <Button type="button" variant="outline" onClick={exportSelected} disabled={selectedIds.length === 0}>
              <Download className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
              {t("users.exportSelected")}
            </Button>
            {canManage ? (
              <Button type="button" variant="outline" onClick={() => void deleteSelected()} disabled={selectedIds.length === 0}>
                <Trash2 className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
                {t("users.deleteSelected")}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}>
              {t("users.prevPage")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              {t("users.nextPage")}
            </Button>
          </div>
        </Card>
      </div>

      {msg ? (
        <p
          className={cn(
            "rounded-xl px-4 py-2 text-sm",
            msg.type === "err"
              ? "border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
              : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          )}
        >
          {msg.text}
        </p>
      ) : null}

      {loadError ? (
        <p className="whitespace-pre-wrap rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          {loadError}
        </p>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="sticky-list-table w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs font-medium uppercase tracking-wide opacity-70">
                <th className="sticky top-0 z-20 bg-[hsl(var(--card))]/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/75">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t("users.selectAll")}
                  />
                </th>
                {header(t("users.username"), "username", isRtl ? "text-right" : "text-left")}
                {header(t("users.fullName"), "full_name", isRtl ? "text-right" : "text-left")}
                {header(t("users.phone"), "phone", isRtl ? "text-right" : "text-left")}
                <th
                  className={cn(
                    "sticky top-0 z-20 bg-[hsl(var(--card))]/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/75",
                    isRtl ? "text-right" : "text-left"
                  )}
                >
                  {t("users.password")}
                </th>
                {header(t("users.status"), "status", isRtl ? "text-right" : "text-left")}
                {header(t("users.package"), "package_name", isRtl ? "text-right" : "text-left")}
                <th
                  className={cn(
                    "sticky top-0 z-20 bg-[hsl(var(--card))]/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/75",
                    isRtl ? "text-right" : "text-left"
                  )}
                >
                  {t("users.remainingQuota")}
                </th>
                {header(t("users.nasNetwork"), "nas_network", isRtl ? "text-right" : "text-left")}
                {header(t("users.region"), "region_name", isRtl ? "text-right" : "text-left")}
                {header(t("users.createdBy"), "created_by", isRtl ? "text-right" : "text-left")}
                {header(t("users.createdAt"), "created_at", isRtl ? "text-right" : "text-left")}
                {header(t("users.startDate"), "start_date", isRtl ? "text-right" : "text-left")}
                {header(t("users.expires"), "expiration_date", isRtl ? "text-right" : "text-left")}
                <th
                  className={cn(
                    "sticky top-0 z-20 bg-[hsl(var(--card))]/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/75",
                    isRtl ? "text-left" : "text-right"
                  )}
                >
                  {t("common.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((s) => (
                <tr key={String(s.id)} className={cn("border-b border-[hsl(var(--border))]/60 transition", getRowClass(s))}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(s.id)}
                      onChange={() => toggleOne(s.id)}
                      aria-label={s.username}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link className="font-medium text-[hsl(var(--primary))] hover:underline" to={`/users/${s.id}`}>
                        {String(s.username)}
                      </Link>
                      {Number(s.is_online ?? 0) > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                          {t("users.onlineNow")}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 opacity-90">
                    {[s.first_name, s.last_name].filter(Boolean).join(" ").trim() || String(s.nickname ?? "—")}
                  </td>
                  <td className="px-4 py-3 opacity-90">{String(s.phone ?? "—")}</td>
                  <td className="px-4 py-3">
                    {canRevealPassword ? (
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-[hsl(var(--muted))] px-2 py-1 text-xs">
                          {revealedPasswords[s.id] || t("users.passwordHidden")}
                        </code>
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={() => (revealedPasswords[s.id] ? hidePassword(s.id) : void revealPassword(s.id))}
                          disabled={passwordLoadingId === s.id}
                        >
                          {revealedPasswords[s.id] ? (
                            <EyeOff className={cn("h-4 w-4", isRtl ? "ms-1" : "me-1")} />
                          ) : (
                            <Eye className={cn("h-4 w-4", isRtl ? "ms-1" : "me-1")} />
                          )}
                          {passwordLoadingId === s.id
                            ? t("common.loading")
                            : revealedPasswords[s.id]
                              ? t("common.hide")
                              : t("common.show")}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs opacity-60">{t("users.passwordRestricted")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        (s.state ?? s.status) === "ACTIVE" || s.status === "active"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-zinc-500/15 opacity-80"
                      )}
                    >
                      {String(s.state ?? s.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 opacity-90">{String(s.package_name ?? "—")}</td>
                  <td className="px-4 py-3 font-mono text-xs opacity-90">
                    {formatRemainingQuota(s, t("packages.unlimited"))}
                  </td>
                  <td className="px-4 py-3 opacity-90">{formatNasLabel(s)}</td>
                  <td className="px-4 py-3 opacity-90">{String(s.region_name ?? "—")}</td>
                  <td className="px-4 py-3 opacity-90">{String(s.creator_name ?? s.creator_email ?? "—")}</td>
                  <td className="px-4 py-3 font-mono text-xs opacity-80">{formatDate(s.created_at)}</td>
                  <td className="px-4 py-3 font-mono text-xs opacity-80">{formatDate(s.start_date)}</td>
                  <td className="px-4 py-3 font-mono text-xs opacity-80">
                    {formatDate(s.expiration_date)}
                  </td>
                  <td className={cn("px-4 py-3", isRtl ? "text-left" : "text-right")}>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Link
                        className="font-medium text-[hsl(var(--primary))] hover:underline"
                        to={`/users/${s.id}`}
                      >
                        {t("users.profile")}
                      </Link>
                      {canPayPackage ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="px-2 py-1 text-xs"
                          onClick={() => void recordPackagePayment(s.id)}
                          disabled={payPackageLoadingId === s.id}
                        >
                          <Banknote className={cn("h-3.5 w-3.5", isRtl ? "ms-1" : "me-1")} />
                          {payPackageLoadingId === s.id ? t("common.loading") : t("users.payPackage")}
                        </Button>
                      ) : null}
                      {canManage ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2 py-1 text-red-600"
                          onClick={() => void deleteOne(s.id, s.username)}
                        >
                          <Trash2 className={cn("h-4 w-4", isRtl ? "ms-1" : "me-1")} />
                          {t("common.delete")}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleItems.length === 0 && !loading ? (
          <p className="p-8 text-center text-sm opacity-60">
            {appliedSearch ? t("users.searchNoResults") : t("users.empty")}
          </p>
        ) : null}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={t("users.add")} wide>
        <form onSubmit={onCreate} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t("users.username")} value={username} onChange={(e) => setUsername(e.target.value)} required />
            <TextField
              label={t("users.password")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={`${t("users.firstName")} (${t("common.optional")})`}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <TextField
              label={`${t("users.lastName")} (${t("common.optional")})`}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={`${t("users.nickname")} (${t("common.optional")})`}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
            <TextField
              label={`${t("users.phone")} (${t("common.optional")})`}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <TextField
            label={`${t("users.address")} (${t("common.optional")})`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <SelectField
            label={`${t("users.region")} (${t("common.optional")})`}
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
          >
            <option value="">—</option>
            {regionSelectOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("users.package")} value={packageId} onChange={(e) => setPackageId(e.target.value)} required>
            <option value="">{t("common.required")}</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <SelectField label={`${t("users.nas")} (${t("common.optional")})`} value={nasId} onChange={(e) => setNasId(e.target.value)}>
            <option value="">—</option>
            {nasList.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} ({n.ip})
              </option>
            ))}
          </SelectField>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={`${t("users.ip")} (${t("common.optional")})`}
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
            />
            <TextField
              label={`${t("users.mac")} (${t("common.optional")})`}
              value={macAddress}
              onChange={(e) => setMacAddress(e.target.value)}
            />
          </div>
          <TextField label={`${t("users.pool")} (${t("common.optional")})`} value={pool} onChange={(e) => setPool(e.target.value)} />
          <TextAreaField label={`${t("users.notes")} (${t("common.optional")})`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModal(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
