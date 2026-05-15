import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, Eye, EyeOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { ActionDialog } from "../components/ui/ActionDialog";
import { ColumnVisibilityMenu, useColumnVisibility } from "../components/ui/ColumnVisibilityMenu";
import { SelectField, TextField, TextAreaField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { canManageOperations, canRecordFinance } from "../lib/permissions";
import { SubscriberInvoicePaymentModal } from "../components/subscribers/SubscriberInvoicePaymentModal";
import { SubscriberFinancialReportModal } from "../components/subscribers/SubscriberFinancialReportModal";
import { SubscriberRowActions } from "../components/subscribers/SubscriberRowActions";
import { cn } from "../lib/utils";
import {
  dateOnlyExpired,
  isExplicitlyDisabled,
  resolveSubscriberUiKind,
  subscriberStatusPresentation,
} from "../lib/subscriber-status";

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
  active_sessions?: number | string | null;
  subscriber_ui_status?: string | null;
  active_session_id?: string | null;
  session_framed_ip?: string | null;
  session_nas_ip?: string | null;
  session_nas_name?: string | null;
  last_seen_at?: string | null;
  simultaneous_use?: string | number | null;
};
type Pkg = { id: string; name: string; price?: number | string | null; currency?: string | null };
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
  | "expiration_date"
  | "last_seen";

function asSubscriberRow(value: Record<string, unknown>): SubscriberRow {
  const activeSess = value.active_sessions;
  const isOnlineRaw = value.is_online ?? activeSess;
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
    subscriber_ui_status:
      value.subscriber_ui_status != null ? String(value.subscriber_ui_status) : null,
    active_session_id: value.active_session_id != null ? String(value.active_session_id) : null,
    session_framed_ip: value.session_framed_ip != null ? String(value.session_framed_ip) : null,
    session_nas_ip: value.session_nas_ip != null ? String(value.session_nas_ip) : null,
    session_nas_name: value.session_nas_name != null ? String(value.session_nas_name) : null,
    last_seen_at: value.last_seen_at != null ? String(value.last_seen_at) : null,
    active_sessions:
      typeof activeSess === "number"
        ? activeSess
        : typeof activeSess === "string"
          ? Number(activeSess)
          : null,
    is_online:
      typeof isOnlineRaw === "number"
        ? isOnlineRaw
        : typeof isOnlineRaw === "string"
          ? Number(isOnlineRaw)
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
    simultaneous_use:
      value.simultaneous_use != null && value.simultaneous_use !== ""
        ? typeof value.simultaneous_use === "number"
          ? value.simultaneous_use
          : String(value.simultaneous_use)
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

function formatLastSeen(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function formatSessionNetwork(row: SubscriberRow): string {
  const name = row.session_nas_name?.trim();
  const ip = row.session_nas_ip?.trim();
  if (name && ip) return `${name} (${ip})`;
  if (name) return name;
  if (ip) return ip;
  return "—";
}

export function UsersPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = canManageOperations(user?.role);
  const canFinance = canRecordFinance(user?.role);
  const canRevealPassword = user?.role === "admin" || user?.role === "manager";
  const [items, setItems] = useState<SubscriberRow[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [modalMsg, setModalMsg] = useState<{ type: "err"; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [passwordLoadingId, setPasswordLoadingId] = useState<string | null>(null);
  const [toggleStatusLoadingId, setToggleStatusLoadingId] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{ id: string; username: string } | null>(null);
  const [financialReportModal, setFinancialReportModal] = useState<{ id: string; username: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant: "warning" | "danger";
    onConfirm: (() => void) | null;
  }>({
    open: false,
    title: "",
    message: "",
    variant: "warning",
    onConfirm: null,
  });
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [packageId, setPackageId] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [macAddress, setMacAddress] = useState("");
  const [pool, setPool] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [regionId, setRegionId] = useState("");
  const [simultaneousUse, setSimultaneousUse] = useState("1");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [searchText, setSearchText] = useState<string>(searchParams.get("q") ?? "");
  const [sortKey, setSortKey] = useState<SortKey>("username");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired" | "disabled">("all");
  const appliedSearch = searchParams.get("q")?.trim() ?? "";
  const controlSelectClass =
    "users-filter-select rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1 text-sm text-[hsl(var(--foreground))]";
  const userColumns = useMemo(
    () => [
      { key: "username", label: t("users.username") },
      { key: "full_name", label: t("users.fullName") },
      { key: "phone", label: t("users.phone") },
      { key: "password", label: t("users.password"), defaultVisible: false },
      { key: "status", label: t("users.status") },
      { key: "package", label: t("users.package") },
      { key: "remaining_quota", label: t("users.remainingQuota") },
      { key: "nas_network", label: t("users.nasNetwork") },
      { key: "region", label: t("users.region"), defaultVisible: false },
      { key: "created_by", label: t("users.createdBy"), defaultVisible: false },
      { key: "created_at", label: t("users.createdAt"), defaultVisible: false },
      { key: "start_date", label: t("users.startDate"), defaultVisible: false },
      { key: "expiration_date", label: t("users.expires") },
      { key: "last_seen", label: t("users.lastSeen") },
    ],
    [t]
  );
  const userColumnVisibility = useColumnVisibility("users-v2", userColumns);

  const subscribersListQuery = useMemo(() => {
    const q = new URLSearchParams({
      page: String(currentPage),
      per_page: String(pageSize),
      sort_key: sortKey,
      sort_dir: sortDir,
    });
    if (appliedSearch) q.set("q", appliedSearch);
    q.set("status_filter", statusFilter);
    return q.toString();
  }, [currentPage, pageSize, sortKey, sortDir, appliedSearch, statusFilter]);

  /** Background refresh: subscribers only (no full-page loading; skips when tab hidden). */
  const refreshSubscribersList = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      const rSub = await apiFetch(`/api/subscribers/?${subscribersListQuery}`);
      if (rSub.ok) {
        const j = (await rSub.json()) as {
          items?: Record<string, unknown>[];
          meta?: { total?: number };
        };
        const rawItems = Array.isArray(j.items) ? j.items : [];
        const nextItems = rawItems.map(asSubscriberRow);
        setItems(nextItems);
        setTotalItems(Number(j.meta?.total ?? nextItems.length ?? 0));
        setSelectedIds((current) => current.filter((id) => nextItems.some((item) => item.id === id)));
      } else {
        const raw = await readApiError(rSub);
        setLoadError(`${t("nav.users")}: ${formatStaffApiError(rSub.status, raw, t)}`);
      }
    } catch {
      // ignore transient network errors during background poll
    }
  }, [subscribersListQuery, t]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rSub, rPkg, rReg] = await Promise.all([
        apiFetch(`/api/subscribers/?${subscribersListQuery}`),
        apiFetch("/api/packages/?account_type=subscriptions"),
        apiFetch("/api/regions/"),
      ]);
      const errParts: string[] = [];
      if (rSub.ok) {
        const j = (await rSub.json()) as {
          items?: Record<string, unknown>[];
          meta?: { total?: number };
        };
        const rawItems = Array.isArray(j.items) ? j.items : [];
        const nextItems = rawItems.map(asSubscriberRow);
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
      if (rReg.ok) {
        const j = (await rReg.json()) as { items: RegionRow[] };
        setRegions(j.items ?? []);
      } else {
        setRegions([]);
      }
      if (errParts.length) setLoadError(errParts.join("\n"));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLoadError(`${t("nav.users")}: ${message.trim() || t("common.error")}`);
    } finally {
      setLoading(false);
    }
  }, [t, subscribersListQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const pollMs = 60_000;
    const timer = window.setInterval(() => {
      void refreshSubscribersList();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [refreshSubscribersList]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshSubscribersList();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refreshSubscribersList]);

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
    setModalMsg(null);
    if (!packageId) {
      setModalMsg({ type: "err", text: t("common.required") });
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
          first_name: firstName || undefined,
          last_name: lastName || undefined,
          phone: phone || undefined,
          address: address || undefined,
          ip_address: ipAddress || undefined,
          mac_address: macAddress || undefined,
          pool: pool || undefined,
          notes: notes || undefined,
          region_id: regionId || null,
          simultaneous_use: Math.max(1, Math.min(32, parseInt(simultaneousUse, 10) || 1)),
        }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        setModalMsg({ type: "err", text: err.error ?? t("users.createFailed") });
        return;
      }
      setMsg({ type: "ok", text: t("users.created") });
      setModal(false);
      setUsername("");
      setPassword("");
      setPackageId("");
      setIpAddress("");
      setMacAddress("");
      setPool("");
      setFirstName("");
      setLastName("");
      setPhone("");
      setAddress("");
      setNotes("");
      setRegionId("");
      setSimultaneousUse("1");
      setSelectedIds([]);
      void load();
    } finally {
      setSaving(false);
    }
  }

  function openCreateModal() {
    setModalMsg(null);
    setUsername("");
    setPassword("");
    setPackageId("");
    setIpAddress("");
    setMacAddress("");
    setPool("");
    setFirstName("");
    setLastName("");
    setPhone("");
    setAddress("");
    setNotes("");
    setRegionId("");
    setSimultaneousUse("1");
    setModal(true);
  }

  function openConfirmDialog(
    title: string,
    message: string,
    onConfirm: () => void,
    variant: "warning" | "danger" = "warning"
  ) {
    setConfirmDialog({ open: true, title, message, onConfirm, variant });
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
        setMsg({
          type: "err",
          text: raw.toLowerCase().includes("password_unavailable")
            ? t("profile.passwordUnavailableHash")
            : formatStaffApiError(res.status, raw, t),
        });
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
    const headers = [
      t("users.username"),
      t("users.firstName"),
      t("users.lastName"),
      t("users.password"),
      t("users.status"),
      t("users.createdBy"),
      t("users.package"),
      t("users.nasNetwork"),
      t("users.nickname"),
      t("users.phone"),
      t("users.address"),
      t("users.region"),
      t("users.createdAt"),
      t("users.startDate"),
      t("users.expires"),
    ];
    const escape = (value: string) => `"${value.replaceAll("\"", "\"\"")}"`;
    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        [
          row.username,
          row.first_name,
          row.last_name,
          row.password,
          row.status,
          row.creator_name,
          row.package_name,
          row.nas,
          row.nickname,
          row.phone,
          row.address,
          row.region,
          row.created_at,
          row.start_date,
          row.expiration_date,
        ]
          .map((v) => escape(String(v ?? "")))
          .join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = t("users.export.filename");
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteOne(id: string, username: string) {
    if (!canManage) return;
    openConfirmDialog(
      t("common.delete"),
      `${t("users.deleteOneConfirm")} ${username}?`,
      () => {
        void confirmDeleteOne(id);
      },
      "danger"
    );
  }

  async function confirmDeleteOne(id: string) {
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
    openConfirmDialog(t("common.delete"), t("users.deleteSelectedConfirm"), () => {
      void confirmDeleteSelected();
    }, "danger");
  }

  async function confirmDeleteSelected() {
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

  async function toggleSubscriberStatus(row: SubscriberRow) {
    if (!canManage) return;
    const disabled = isExplicitlyDisabled(row);
    const confirmMsg = disabled ? t("users.enableConfirm") : t("users.disableConfirm");
    openConfirmDialog(t("common.actions"), confirmMsg, () => {
      void confirmToggleSubscriberStatus(row);
    }, "warning");
  }

  async function confirmToggleSubscriberStatus(row: SubscriberRow) {
    const disabled = isExplicitlyDisabled(row);
    setToggleStatusLoadingId(row.id);
    setMsg(null);
    try {
      const endpoint = disabled ? "enable" : "disable";
      const method = disabled ? "POST" : "PATCH";
      const res = await apiFetch(`/api/subscribers/${row.id}/${endpoint}`, { method });
      if (!res.ok) {
        const raw = await readApiError(res);
        setMsg({ type: "err", text: formatStaffApiError(res.status, raw, t) });
        return;
      }
      setItems((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                status: disabled ? "active" : "disabled",
                state: disabled ? "ACTIVE" : "BLOCKED",
                is_online: disabled ? item.is_online : 0,
                subscriber_ui_status: disabled
                  ? dateOnlyExpired(item.expiration_date) || String(item.status ?? "").toLowerCase() === "expired"
                    ? "expired"
                    : Number(item.is_online ?? 0) > 0
                      ? "online"
                      : "active"
                  : "disabled",
              }
            : item
        )
      );
      setMsg({ type: "ok", text: disabled ? t("users.enabled") : t("users.disabled") });
      void refreshSubscribersList();
    } finally {
      setToggleStatusLoadingId(null);
    }
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
    setSortDir(
      key === "created_at" || key === "start_date" || key === "expiration_date" || key === "last_seen" ? "desc" : "asc"
    );
  }

  function header(label: string, key: SortKey, alignClass: string) {
    const active = sortKey === key;
    return (
      <th
        className={cn(
          "sticky top-0 z-20 bg-[hsl(var(--card))]/90 px-2 py-2 text-xs backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/80",
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
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
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
                className={controlSelectClass}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) || 50);
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
              <select
                className={controlSelectClass}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as "all" | "active" | "expired" | "disabled");
                  setCurrentPage(1);
                }}
              >
                <option value="all">{t("users.statusFilter.all")}</option>
                <option value="active">{t("users.statusFilter.active")}</option>
                <option value="expired">{t("users.statusFilter.expired")}</option>
                <option value="disabled">{t("users.statusFilter.disabled")}</option>
              </select>
            </form>
            <Button type="button" variant="outline" onClick={toggleAll} disabled={visibleItems.length === 0}>
              {allSelected ? t("users.clearSelection") : t("users.selectAll")}
            </Button>
            <Button type="button" variant="outline" onClick={exportSelected} disabled={selectedIds.length === 0}>
              <Download className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
              {t("users.exportSelected")}
            </Button>
            <ColumnVisibilityMenu
              title={t("table.columns")}
              columns={userColumns}
              visibleKeys={userColumnVisibility.visibleKeys}
              onToggle={userColumnVisibility.toggle}
              onShowAll={userColumnVisibility.showAll}
              onResetDefault={userColumnVisibility.resetDefault}
            />
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

      <div className="glass overflow-hidden rounded-2xl p-0">
        <div className="max-h-[min(78vh,1200px)] max-w-full overflow-auto">
          <table className="sticky-list-table users-table w-full text-[0.8125rem] leading-snug">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-[11px] font-semibold uppercase tracking-wide opacity-75">
                <th
                  className={cn(
                    "sticky top-0 z-20 w-8 bg-[hsl(var(--card))]/90 px-2 py-2 text-xs backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/80",
                    isRtl ? "text-right" : "text-left"
                  )}
                >
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t("users.selectAll")}
                  />
                </th>
                {userColumnVisibility.isVisible("username")
                  ? header(t("users.username"), "username", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("full_name")
                  ? header(t("users.fullName"), "full_name", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("phone")
                  ? header(t("users.phone"), "phone", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("password") ? (
                  <th
                    className={cn(
                      "sticky top-0 z-20 bg-[hsl(var(--card))]/90 px-2 py-2 text-xs backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/80",
                      isRtl ? "text-right" : "text-left"
                    )}
                  >
                    {t("users.password")}
                  </th>
                ) : null}
                {userColumnVisibility.isVisible("status")
                  ? header(t("users.status"), "status", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("package")
                  ? header(t("users.package"), "package_name", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("remaining_quota") ? (
                  <th
                    className={cn(
                      "sticky top-0 z-20 bg-[hsl(var(--card))]/90 px-2 py-2 text-xs backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/80",
                      isRtl ? "text-right" : "text-left"
                    )}
                  >
                    {t("users.remainingQuota")}
                  </th>
                ) : null}
                {userColumnVisibility.isVisible("nas_network")
                  ? header(t("users.nasNetwork"), "nas_network", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("region")
                  ? header(t("users.region"), "region_name", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("created_by")
                  ? header(t("users.createdBy"), "created_by", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("created_at")
                  ? header(t("users.createdAt"), "created_at", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("start_date")
                  ? header(t("users.startDate"), "start_date", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("expiration_date")
                  ? header(t("users.expires"), "expiration_date", isRtl ? "text-right" : "text-left")
                  : null}
                {userColumnVisibility.isVisible("last_seen")
                  ? header(t("users.lastSeen"), "last_seen", isRtl ? "text-right" : "text-left")
                  : null}
                <th
                  className={cn(
                    "sticky top-0 z-20 bg-[hsl(var(--card))]/90 px-2 py-2 text-xs backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--card))]/80",
                    isRtl ? "text-left" : "text-right"
                  )}
                >
                  {t("common.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((s) => {
                const uiKind = resolveSubscriberUiKind(s);
                const pres = subscriberStatusPresentation(uiKind, t);
                const td = "px-2 py-2 align-middle";
                return (
                  <tr
                    key={String(s.id)}
                    className={cn("border-b border-[hsl(var(--border))]/50 transition-colors", pres.rowClass)}
                  >
                    <td className={cn(td, "w-8")}>
                      <input
                        type="checkbox"
                        checked={selectedSet.has(s.id)}
                        onChange={() => toggleOne(s.id)}
                        aria-label={s.username}
                      />
                    </td>
                    {userColumnVisibility.isVisible("username") ? (
                      <td className={td}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", pres.dotClass)}
                            title={pres.label}
                            aria-hidden
                          />
                          <Link
                            className="min-w-0 truncate font-medium text-[hsl(var(--primary))] hover:underline"
                            to={`/users/${s.id}`}
                          >
                            {String(s.username)}
                          </Link>
                        </div>
                      </td>
                    ) : null}
                    {userColumnVisibility.isVisible("full_name") ? (
                      <td className={cn(td, "max-w-[10rem] truncate opacity-90")}>
                        {[s.first_name, s.last_name].filter(Boolean).join(" ").trim() || String(s.nickname ?? "—")}
                      </td>
                    ) : null}
                    {userColumnVisibility.isVisible("phone") ? (
                      <td className={cn(td, "max-w-[7rem] truncate opacity-90")}>{String(s.phone ?? "—")}</td>
                    ) : null}
                    {userColumnVisibility.isVisible("password") ? (
                      <td className={td}>
                        {canRevealPassword ? (
                          <div className="flex max-w-[11rem] items-center gap-1">
                            <code className="truncate rounded bg-[hsl(var(--muted))] px-1 py-0.5 font-mono text-[10px]">
                              {revealedPasswords[s.id] || t("users.passwordHidden")}
                            </code>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-7 shrink-0 px-1.5 py-0 text-[10px]"
                              onClick={() => (revealedPasswords[s.id] ? hidePassword(s.id) : void revealPassword(s.id))}
                              disabled={passwordLoadingId === s.id}
                            >
                              {passwordLoadingId === s.id ? "…" : revealedPasswords[s.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[10px] opacity-60">{t("users.passwordRestricted")}</span>
                        )}
                      </td>
                    ) : null}
                    {userColumnVisibility.isVisible("status") ? (
                      <td className={td}>
                        <span
                          className={cn(
                            "inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight",
                            pres.badgeClass
                          )}
                        >
                          {pres.label}
                        </span>
                      </td>
                    ) : null}
                    {userColumnVisibility.isVisible("package") ? (
                      <td className={cn(td, "max-w-[9rem] truncate opacity-90")}>{String(s.package_name ?? "—")}</td>
                    ) : null}
                    {userColumnVisibility.isVisible("remaining_quota") ? (
                      <td className={cn(td, "font-mono text-[10px] opacity-90")}>
                        {formatRemainingQuota(s, t("packages.unlimited"))}
                      </td>
                    ) : null}
                    {userColumnVisibility.isVisible("nas_network") ? (
                      <td className={cn(td, "max-w-[10rem]")}>
                        <div className="truncate opacity-90">{formatNasLabel(s)}</div>
                        {uiKind === "online" ? (
                          <div className="truncate font-mono text-[10px] leading-tight text-blue-700/90 dark:text-blue-300/90">
                            {s.session_framed_ip
                              ? `${t("users.ip")}: ${s.session_framed_ip}`
                              : formatSessionNetwork(s) !== "—"
                                ? formatSessionNetwork(s)
                                : "—"}
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                    {userColumnVisibility.isVisible("region") ? (
                      <td className={cn(td, "max-w-[8rem] truncate opacity-90")}>{String(s.region_name ?? "—")}</td>
                    ) : null}
                    {userColumnVisibility.isVisible("created_by") ? (
                      <td className={cn(td, "max-w-[8rem] truncate opacity-90")}>
                        {String(s.creator_name ?? s.creator_email ?? "—")}
                      </td>
                    ) : null}
                    {userColumnVisibility.isVisible("created_at") ? (
                      <td className={cn(td, "whitespace-nowrap font-mono text-[10px] opacity-80")}>
                        {formatDate(s.created_at)}
                      </td>
                    ) : null}
                    {userColumnVisibility.isVisible("start_date") ? (
                      <td className={cn(td, "whitespace-nowrap font-mono text-[10px] opacity-80")}>
                        {formatDate(s.start_date)}
                      </td>
                    ) : null}
                    {userColumnVisibility.isVisible("expiration_date") ? (
                      <td className={cn(td, "whitespace-nowrap font-mono text-[10px] opacity-80")}>
                        {formatDate(s.expiration_date)}
                      </td>
                    ) : null}
                    {userColumnVisibility.isVisible("last_seen") ? (
                      <td className={cn(td, "whitespace-nowrap font-mono text-[10px] opacity-80")}>
                        {formatLastSeen(s.last_seen_at)}
                      </td>
                    ) : null}
                    <td className={cn(td, isRtl ? "text-left" : "text-right")}>
                      <SubscriberRowActions
                        subscriberId={s.id}
                        username={s.username}
                        isRtl={isRtl}
                        canManage={canManage}
                        canFinance={canFinance}
                        accountDisabled={isExplicitlyDisabled(s)}
                        toggleLoading={toggleStatusLoadingId === s.id}
                        reportLoading={false}
                        labels={{
                          menu: t("users.actions.menu"),
                          viewProfile: t("users.actions.viewProfile"),
                          edit: t("users.actions.edit"),
                          payment: t("users.paymentInvoice"),
                          financialReport: t("users.financialReport"),
                          enable: t("users.enable"),
                          disable: t("users.disable"),
                          delete: t("common.delete"),
                        }}
                        onPayment={() => setPaymentModal({ id: s.id, username: s.username })}
                        onFinancialReport={() => {
                          if (!canFinance) return;
                          setFinancialReportModal({ id: s.id, username: s.username });
                        }}
                        onToggleStatus={() => void toggleSubscriberStatus(s)}
                        onDelete={() => void deleteOne(s.id, s.username)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleItems.length === 0 && !loading ? (
          <p className="p-8 text-center text-sm opacity-60">
            {appliedSearch ? t("users.searchNoResults") : t("users.empty")}
          </p>
        ) : null}
      </div>

      <Modal
        open={modal}
        onClose={() => {
          setModalMsg(null);
          setModal(false);
        }}
        title={t("users.add")}
        wide
      >
        <form onSubmit={onCreate} className="space-y-4">
          {modalMsg ? (
            <div className="whitespace-pre-wrap rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {modalMsg.text}
            </div>
          ) : null}
          <p className="text-xs leading-relaxed opacity-75">{t("users.createExpiryHint")}</p>
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
          <TextField
            label={`${t("users.phone")} (${t("common.optional")})`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
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
          <TextField
            label={t("packages.simUse")}
            type="number"
            min={1}
            max={32}
            value={simultaneousUse}
            onChange={(e) => setSimultaneousUse(e.target.value)}
          />
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
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setModalMsg(null);
                setModal(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>
      <ActionDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onClose={() => setConfirmDialog({ open: false, title: "", message: "", variant: "warning", onConfirm: null })}
        onConfirm={() => {
          const action = confirmDialog.onConfirm;
          setConfirmDialog({ open: false, title: "", message: "", variant: "warning", onConfirm: null });
          action?.();
        }}
      />
      {paymentModal ? (
        <SubscriberInvoicePaymentModal
          open
          subscriberId={paymentModal.id}
          username={paymentModal.username}
          packages={packages}
          onClose={() => setPaymentModal(null)}
          onFinished={(result) => {
            if (result.allocation) {
              setMsg({ type: "ok", text: t("users.paymentAllocationDone") });
            } else if (result.deferred) {
              setMsg({ type: "ok", text: t("users.paymentDeferred") });
            } else if (result.partial) {
              setMsg({ type: "ok", text: t("users.paymentPartial") });
            } else {
              setMsg({ type: "ok", text: t("users.packagePaid") });
            }
            void load();
          }}
        />
      ) : null}
      <SubscriberFinancialReportModal
        open={financialReportModal != null}
        subscriberId={financialReportModal?.id ?? null}
        username={financialReportModal?.username ?? ""}
        onClose={() => setFinancialReportModal(null)}
      />
    </div>
  );
}
