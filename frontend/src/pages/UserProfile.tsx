import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  Ban,
  BarChart3,
  Calendar,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  Hash,
  Info,
  KeyRound,
  Layers,
  Loader2,
  MessageCircleOff,
  Package,
  Power,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  User,
  UserCircle,
  X,
} from "lucide-react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ActionDialog } from "../components/ui/ActionDialog";
import { Modal } from "../components/ui/Modal";
import { SelectField, TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { canManageOperations, canViewSpeedProfiles } from "../lib/permissions";
import { cn } from "../lib/utils";
import { resolveSubscriberUiKind, subscriberStatusPresentation } from "../lib/subscriber-status";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type RegionOpt = { id: string; name: string; parent_id?: string | null };

type Row = {
  id: string;
  username: string;
  status?: string | null;
  package_id?: string | null;
  region_id?: string | null;
  package_name?: string | null;
  nas_server_id?: string | null;
  pool?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  phone?: string | null;
  address?: string | null;
  creator_name?: string | null;
  expiration_date?: string | null;
  created_at?: string | null;
  used_bytes?: string | number | null;
  quota_total_bytes?: string | number | null;
  simultaneous_use?: string | number | null;
  /** 1 = لا إرسال واتساب تلقائي لهذا المشترك */
  whatsapp_opt_out?: number | string | boolean | null;
};
type Pkg = { id: string; name: string; price?: number | string | null; currency?: string | null };
type Nas = { id: string; name: string; ip: string };
type TrafficPoint = {
  period: string;
  sessions_count: number;
  online_seconds: number;
  download_bytes: string;
  upload_bytes: string;
  total_bytes: string;
};

type TrafficSession = {
  radacctid: string;
  start_time: string | null;
  stop_time: string | null;
  online_seconds: number;
  download_bytes: string;
  upload_bytes: string;
  total_bytes: string;
  framed_ip: string | null;
  caller_id: string | null;
  nas_ip: string | null;
  is_active: boolean;
};

type TrafficReport = {
  username: string;
  data_issue?: string | null;
  filter?: {
    from: string | null;
    to: string | null;
  };
  totals: {
    daily_online_seconds: number;
    daily_download_bytes: string;
    daily_upload_bytes: string;
    daily_total_bytes: string;
    monthly_online_seconds: number;
    monthly_download_bytes: string;
    monthly_upload_bytes: string;
    monthly_total_bytes: string;
  };
  daily: TrafficPoint[];
  monthly: TrafficPoint[];
  yearly: TrafficPoint[];
  sessions: TrafficSession[];
};

function ProfileSectionTitle({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string | null;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary))]/12 text-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary))]/20">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs leading-relaxed opacity-65">{hint}</p> : null}
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="group flex gap-3 rounded-xl border border-[hsl(var(--border))]/80 bg-[hsl(var(--card))]/40 p-3.5 transition-colors hover:border-[hsl(var(--primary))]/30 hover:bg-[hsl(var(--muted))]/25">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-45 transition-opacity group-hover:opacity-80" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider opacity-55">{label}</div>
        <div className="mt-1 break-all font-mono text-xs font-medium leading-snug">{value}</div>
      </div>
    </div>
  );
}

export function UserProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = canManageOperations(user?.role);
  const [regions, setRegions] = useState<RegionOpt[]>([]);

  const regionSelectOptions = useMemo(() => {
    const byParent = new Map<string | null, RegionOpt[]>();
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

  const [row, setRow] = useState<Row | null>(null);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [nasList, setNasList] = useState<Nas[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [traffic, setTraffic] = useState<TrafficReport | null>(null);
  const [trafficFrom, setTrafficFrom] = useState("");
  const [trafficTo, setTrafficTo] = useState("");
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficLoadError, setTrafficLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "traffic">("details");
  const trafficAutoLoadedRef = useRef(false);

  const [revealedPw, setRevealedPw] = useState<string | null>(null);
  const [passwordRevealLoading, setPasswordRevealLoading] = useState(false);
  const [showPasswordEditor, setShowPasswordEditor] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [packageId, setPackageId] = useState("");
  const [nasId, setNasId] = useState("");
  const [pool, setPool] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [macAddress, setMacAddress] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [regionId, setRegionId] = useState("");
  const [simultaneousUse, setSimultaneousUse] = useState("1");
  const [whatsappOptOut, setWhatsappOptOut] = useState(false);
  const [expirationDate, setExpirationDate] = useState("");
  const [expirationUnlimited, setExpirationUnlimited] = useState(false);

  const showSpeedPanel = canViewSpeedProfiles(user?.role, user?.permissions);
  const canSpeedOverride =
    user?.role === "admin" || Boolean(user?.permissions?.apply_speed_override);
  const [speedEff, setSpeedEff] = useState<{
    profileId: string | null;
    mikrotikValue: string | null;
    source: string;
    scheduleId: string | null;
  } | null>(null);
  const [speedLogs, setSpeedLogs] = useState<Array<Record<string, unknown>>>([]);
  const [speedProfilesPick, setSpeedProfilesPick] = useState<Array<{ id: string; name: string }>>([]);
  const [speedLoading, setSpeedLoading] = useState(false);
  const [speedBoostOpen, setSpeedBoostOpen] = useState(false);
  const [speedBoostProfileId, setSpeedBoostProfileId] = useState("");
  const [speedBoostEnds, setSpeedBoostEnds] = useState("");
  const [speedBusy, setSpeedBusy] = useState(false);

  const loadSpeedInfo = useCallback(async () => {
    if (!id || !showSpeedPanel) return;
    setSpeedLoading(true);
    try {
      const [effRes, logsRes, profRes] = await Promise.all([
        apiFetch(`/api/speed-profiles/subscribers/${id}/effective`),
        apiFetch(`/api/speed-profiles/logs?limit=30&subscriber_id=${encodeURIComponent(id)}`),
        apiFetch("/api/speed-profiles"),
      ]);
      if (effRes.ok) {
        const j = (await effRes.json()) as {
          effective: {
            profileId: string | null;
            mikrotikValue: string | null;
            source: string;
            scheduleId: string | null;
          };
        };
        setSpeedEff(j.effective ?? null);
      } else setSpeedEff(null);
      if (logsRes.ok) {
        const j = (await logsRes.json()) as { items: Array<Record<string, unknown>> };
        setSpeedLogs(j.items ?? []);
      } else setSpeedLogs([]);
      if (profRes.ok) {
        const j = (await profRes.json()) as { items: Array<{ id: string; name: string }> };
        setSpeedProfilesPick(j.items ?? []);
      } else setSpeedProfilesPick([]);
    } finally {
      setSpeedLoading(false);
    }
  }, [id, showSpeedPanel]);

  useEffect(() => {
    void loadSpeedInfo();
  }, [loadSpeedInfo]);

  const loadTraffic = useCallback(
    async (opts?: { from?: string; to?: string }) => {
      if (!id) return;
      const from = opts?.from ?? trafficFrom;
      const to = opts?.to ?? trafficTo;
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const suffix = q.toString() ? `?${q.toString()}` : "";
      setTrafficLoading(true);
      setTrafficLoadError(null);
      try {
        const trRes = await apiFetch(`/api/subscribers/${id}/traffic-report${suffix}`);
        if (trRes.ok) {
          const tr = (await trRes.json()) as TrafficReport;
          setTraffic(tr);
        } else {
          setTraffic(null);
          const raw = await readApiError(trRes);
          setTrafficLoadError(formatStaffApiError(trRes.status, raw, t));
        }
      } catch (e) {
        setTraffic(null);
        const message = e instanceof Error ? e.message : String(e);
        setTrafficLoadError(message.trim() || t("profile.trafficLoadFailed"));
      } finally {
        setTrafficLoading(false);
      }
    },
    [id, trafficFrom, trafficTo, t]
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setRevealedPw(null);
    try {
      const [rSub, rPkg, rNas, rReg] = await Promise.all([
        apiFetch("/api/subscribers/"),
        apiFetch("/api/packages/?account_type=subscriptions"),
        apiFetch("/api/nas/"),
        apiFetch("/api/regions/"),
      ]);
      if (rReg.ok) {
        const jr = (await rReg.json()) as { items: RegionOpt[] };
        setRegions(jr.items ?? []);
      } else {
        setRegions([]);
      }
      const pkgItems = rPkg.ok ? ((await rPkg.json()) as { items: Pkg[] }).items : [];
      setPackages(pkgItems);
      if (rNas.ok) {
        const j = (await rNas.json()) as { nas_servers: Nas[] };
        setNasList(j.nas_servers ?? []);
      }
      if (rSub.ok) {
        const { items } = (await rSub.json()) as { items: Row[] };
        const found = items.find((x) => x.id === id) ?? null;
        setRow(found);
        if (found) {
          setPackageId(String(found.package_id ?? ""));
          setNasId(found.nas_server_id ? String(found.nas_server_id) : "");
          setPool(String(found.pool ?? ""));
          setIpAddress(String(found.ip_address ?? ""));
          setMacAddress(String(found.mac_address ?? ""));
          setFirstName(String(found.first_name ?? ""));
          setLastName(String(found.last_name ?? ""));
          setPhone(String(found.phone ?? ""));
          setAddress(String(found.address ?? ""));
          setRegionId(found.region_id ? String(found.region_id) : "");
          const su = found.simultaneous_use;
          if (su != null && String(su).trim() !== "") {
            const n = parseInt(String(su), 10);
            setSimultaneousUse(Number.isFinite(n) && n >= 1 ? String(n) : "1");
          } else {
            setSimultaneousUse("1");
          }
          const woo = found.whatsapp_opt_out;
          setWhatsappOptOut(woo === true || woo === 1 || woo === "1");
          if (found.expiration_date) {
            setExpirationDate(String(found.expiration_date).slice(0, 10));
            setExpirationUnlimited(false);
          } else {
            setExpirationDate("");
            setExpirationUnlimited(true);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, [id, loadTraffic]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await apiFetch(`/api/subscribers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          package_id: packageId || undefined,
          nas_server_id: nasId || null,
          pool: pool || null,
          ip_address: ipAddress || null,
          mac_address: macAddress || null,
          first_name: firstName || null,
          last_name: lastName || null,
          phone: phone || null,
          address: address || null,
          region_id: regionId || null,
          simultaneous_use: Math.max(1, Math.min(32, parseInt(simultaneousUse, 10) || 1)),
          whatsapp_opt_out: whatsappOptOut,
          expiration_date: expirationUnlimited ? null : expirationDate.trim() || undefined,
        }),
      });
      if (r.ok) {
        setMsg(t("profile.saved"));
        await load();
      } else {
        const raw = await readApiError(r);
        setMsg(formatStaffApiError(r.status, raw, t));
      }
    } finally {
      setSaving(false);
    }
  }

  async function onDisable() {
    if (!id || !canManage) return;
    setDisableConfirmOpen(true);
  }

  async function confirmDisable() {
    setDisableConfirmOpen(false);
    if (!id || !canManage) return;
    setMsg(null);
    const r = await apiFetch(`/api/subscribers/${id}/disable`, { method: "POST" });
    if (r.ok) await load();
    else setMsg(formatStaffApiError(r.status, await readApiError(r), t));
  }

  async function onEnable() {
    if (!id || !canManage) return;
    setMsg(null);
    const r = await apiFetch(`/api/subscribers/${id}/enable`, { method: "POST" });
    if (r.ok) await load();
    else setMsg(formatStaffApiError(r.status, await readApiError(r), t));
  }

  async function removeSpeedOverride() {
    if (!id || !canSpeedOverride) return;
    setSpeedBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch(`/api/speed-profiles/subscribers/${id}/override`, { method: "DELETE" });
      if (r.ok) {
        await loadSpeedInfo();
        setMsg(t("speed.overrideRemoved"));
      } else {
        setMsg(formatStaffApiError(r.status, await readApiError(r), t));
      }
    } finally {
      setSpeedBusy(false);
    }
  }

  async function submitSpeedBoost() {
    if (!id || !canSpeedOverride || !speedBoostProfileId) return;
    setSpeedBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        speed_profile_id: speedBoostProfileId,
        reason: "temporary_boost",
      };
      if (speedBoostEnds.trim()) {
        body.ends_at = new Date(speedBoostEnds).toISOString();
      }
      const r = await apiFetch(`/api/speed-profiles/subscribers/${id}/override`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (r.ok) {
        setSpeedBoostOpen(false);
        setSpeedBoostProfileId("");
        setSpeedBoostEnds("");
        await loadSpeedInfo();
        setMsg(t("speed.boostApplied"));
      } else {
        setMsg(formatStaffApiError(r.status, await readApiError(r), t));
      }
    } finally {
      setSpeedBusy(false);
    }
  }

  async function toggleRevealPassword() {
    if (!id || !canManage) return;
    if (revealedPw != null) {
      setRevealedPw(null);
      return;
    }
    setPasswordRevealLoading(true);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/subscribers/${id}/password`);
      if (!res.ok) {
        const error = await readApiError(res);
        setMsg(
          error.toLowerCase().includes("password_unavailable")
            ? t("profile.passwordUnavailableHash")
            : formatStaffApiError(res.status, error, t)
        );
        return;
      }
      const data = (await res.json()) as { password?: string };
      setRevealedPw(data.password ?? "");
    } finally {
      setPasswordRevealLoading(false);
    }
  }

  async function savePasswordChange() {
    if (!id || !canManage) return;
    if (newPwd.length < 1) {
      setMsg(t("profile.passwordEmpty"));
      return;
    }
    if (newPwd !== confirmPwd) {
      setMsg(t("profile.passwordMismatch"));
      return;
    }
    setPasswordBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/subscribers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ password: newPwd }),
      });
      if (!res.ok) {
        setMsg(formatStaffApiError(res.status, await readApiError(res), t));
        return;
      }
      setMsg(t("profile.passwordUpdated"));
      setNewPwd("");
      setConfirmPwd("");
      setRevealedPw(null);
      await load();
    } finally {
      setPasswordBusy(false);
    }
  }

  async function onDelete() {
    if (!id || !canManage) return;
    setDeleteConfirmOpen(true);
  }

  async function confirmDelete() {
    setDeleteConfirmOpen(false);
    if (!id || !canManage) return;
    const r = await apiFetch(`/api/subscribers/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const raw = await readApiError(r);
      setMsg(formatStaffApiError(r.status, raw, t));
      return;
    }
    navigate("/users");
  }

  function onClose() {
    navigate("/users");
  }

  useEffect(() => {
    setTraffic(null);
    setTrafficLoadError(null);
    trafficAutoLoadedRef.current = false;
  }, [id]);

  useEffect(() => {
    if (activeTab !== "traffic") {
      trafficAutoLoadedRef.current = false;
      return;
    }
    if (!id || trafficAutoLoadedRef.current) return;
    trafficAutoLoadedRef.current = true;
    void loadTraffic();
  }, [activeTab, id, loadTraffic]);

  const usageChartData = useMemo(() => {
    if (!traffic) return [];
    return traffic.daily
      .slice()
      .reverse()
      .map((d) => ({
        period: d.period,
        totalGb: Number(d.total_bytes) / 1024 ** 3,
      }));
  }, [traffic]);

  const monthlyChartData = useMemo(() => {
    if (!traffic) return [];
    return traffic.monthly
      .slice()
      .reverse()
      .map((d) => ({
        period: d.period,
        totalGb: Number(d.total_bytes) / 1024 ** 3,
      }));
  }, [traffic]);

  if (loading || !row) {
    return (
      <p className="text-sm opacity-70" dir={isRtl ? "rtl" : "ltr"}>
        {t("common.loading")}
      </p>
    );
  }

  const active = row.status === "active";
  const uiKind = resolveSubscriberUiKind({
    status: row.status,
    expiration_date: row.expiration_date,
    is_online: (row as Row & { is_online?: number }).is_online,
    subscriber_ui_status: (row as Row & { subscriber_ui_status?: string }).subscriber_ui_status,
  });
  const statusPres = subscriberStatusPresentation(uiKind, t);

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
  const quotaTotal = Number(row.quota_total_bytes ?? 0);
  const usedBytes = Number(row.used_bytes ?? 0);
  const remainingBytes = quotaTotal > 0 ? Math.max(0, quotaTotal - Math.max(0, usedBytes)) : 0;

  function fmtDuration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds || 0));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}d ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }

  function fmtDateTime(value: string | null): string {
    if (!value) return "—";
    return value.slice(0, 19).replace("T", " ");
  }

  function exportCsv() {
    if (!traffic) return;
    const lines: string[] = [];
    lines.push(`Username,${traffic.username}`);
    lines.push(
      `Date Range,${traffic.filter?.from ?? "all"} -> ${traffic.filter?.to ?? "all"}`
    );
    lines.push("");
    lines.push("Summary,Online Time,Download,Upload,Total");
    lines.push(
      `Daily Totals,${fmtDuration(traffic.totals.daily_online_seconds)},${fmtBytes(
        traffic.totals.daily_download_bytes
      )},${fmtBytes(traffic.totals.daily_upload_bytes)},${fmtBytes(traffic.totals.daily_total_bytes)}`
    );
    lines.push(
      `Monthly Totals,${fmtDuration(traffic.totals.monthly_online_seconds)},${fmtBytes(
        traffic.totals.monthly_download_bytes
      )},${fmtBytes(traffic.totals.monthly_upload_bytes)},${fmtBytes(traffic.totals.monthly_total_bytes)}`
    );
    lines.push("");
    lines.push("Daily Report");
    lines.push("Period,Sessions,Online Time,Download,Upload,Total");
    for (const d of traffic.daily) {
      lines.push(
        `${d.period},${d.sessions_count},${fmtDuration(d.online_seconds)},${fmtBytes(d.download_bytes)},${fmtBytes(
          d.upload_bytes
        )},${fmtBytes(d.total_bytes)}`
      );
    }
    lines.push("");
    lines.push("Monthly Report");
    lines.push("Period,Sessions,Online Time,Download,Upload,Total");
    for (const m of traffic.monthly) {
      lines.push(
        `${m.period},${m.sessions_count},${fmtDuration(m.online_seconds)},${fmtBytes(m.download_bytes)},${fmtBytes(
          m.upload_bytes
        )},${fmtBytes(m.total_bytes)}`
      );
    }
    lines.push("");
    lines.push("Session Details");
    lines.push("Start,Stop,Online Time,Download,Upload,Total,IP,NAS,Caller ID,Active");
    for (const s of traffic.sessions) {
      lines.push(
        `${fmtDateTime(s.start_time)},${s.is_active ? "ACTIVE" : fmtDateTime(s.stop_time)},${fmtDuration(
          s.online_seconds
        )},${fmtBytes(s.download_bytes)},${fmtBytes(s.upload_bytes)},${fmtBytes(s.total_bytes)},${s.framed_ip ?? ""},${
          s.nas_ip ?? ""
        },${s.caller_id ?? ""},${s.is_active ? "yes" : "no"}`
      );
    }
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${traffic.username}-traffic-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    if (!traffic) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const html = `
      <html><head><title>Traffic Report - ${traffic.username}</title>
      <style>
      body{font-family:Arial,sans-serif;padding:18px;color:#111}
      h1,h2{margin:0 0 8px} .meta{margin-bottom:10px;color:#555}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border:1px solid #ddd;padding:6px;font-size:12px;text-align:left}
      th{background:#f1f5f9}
      </style></head><body>
      <h1>Traffic Report</h1>
      <div class="meta">Subscriber: ${traffic.username} | Range: ${traffic.filter?.from ?? "all"} -> ${
        traffic.filter?.to ?? "all"
      }</div>
      <h2>Totals</h2>
      <table><thead><tr><th>Type</th><th>Online Time</th><th>Download</th><th>Upload</th><th>Total</th></tr></thead><tbody>
      <tr><td>Daily</td><td>${fmtDuration(traffic.totals.daily_online_seconds)}</td><td>${fmtBytes(
      traffic.totals.daily_download_bytes
    )}</td><td>${fmtBytes(traffic.totals.daily_upload_bytes)}</td><td>${fmtBytes(
      traffic.totals.daily_total_bytes
    )}</td></tr>
      <tr><td>Monthly</td><td>${fmtDuration(traffic.totals.monthly_online_seconds)}</td><td>${fmtBytes(
      traffic.totals.monthly_download_bytes
    )}</td><td>${fmtBytes(traffic.totals.monthly_upload_bytes)}</td><td>${fmtBytes(
      traffic.totals.monthly_total_bytes
    )}</td></tr>
      </tbody></table>
      <h2>Session Details</h2>
      <table><thead><tr><th>Start</th><th>Stop</th><th>Online</th><th>Download</th><th>Upload</th><th>Total</th></tr></thead><tbody>
      ${traffic.sessions
        .map(
          (s) =>
            `<tr><td>${fmtDateTime(s.start_time)}</td><td>${s.is_active ? "ACTIVE" : fmtDateTime(
              s.stop_time
            )}</td><td>${fmtDuration(s.online_seconds)}</td><td>${fmtBytes(s.download_bytes)}</td><td>${fmtBytes(
              s.upload_bytes
            )}</td><td>${fmtBytes(s.total_bytes)}</td></tr>`
        )
        .join("")}
      </tbody></table>
      </body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={cn("flex flex-wrap items-center gap-2", isRtl && "flex-row-reverse")}>
          <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" onClick={onClose} aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </Button>
          <Link
            to="/users"
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm font-medium text-[hsl(var(--primary))] transition-colors hover:border-[hsl(var(--primary))]/25 hover:bg-[hsl(var(--primary))]/5",
              isRtl && "flex-row-reverse"
            )}
          >
            <ArrowLeft className={cn("h-4 w-4 shrink-0", isRtl && "rotate-180")} />
            {t("profile.back")}
          </Link>
        </div>
      </div>

      <Card variant="subtle" className="overflow-hidden p-0 ring-1 ring-[hsl(var(--border))]/60">
        <div className="relative bg-gradient-to-br from-[hsl(var(--primary))]/18 via-[hsl(var(--muted))]/30 to-emerald-500/10 px-5 py-6 sm:px-7 sm:py-7">
          <div className="pointer-events-none absolute -end-16 -top-16 h-48 w-48 rounded-full bg-[hsl(var(--primary))]/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-4 sm:gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--card))] text-xl font-bold tracking-tight text-[hsl(var(--primary))] shadow-lg shadow-black/5 ring-1 ring-[hsl(var(--border))]">
              <User className="h-8 w-8 opacity-90" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wider opacity-55">{t("profile.title")}</p>
              <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight sm:text-3xl">{String(row.username)}</h1>
              <div className={cn("mt-3 flex flex-wrap items-center gap-2", isRtl && "flex-row-reverse")}>
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[hsl(var(--border))]/80 bg-[hsl(var(--card))]/70 px-3 py-1 text-xs font-medium shadow-sm backdrop-blur-sm">
                  <Package className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{String(row.package_name ?? "—")}</span>
                </span>
                <span
                  className={cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                    statusPres.badgeClass
                  )}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", statusPres.dotClass)} />
                  <span className="truncate">{statusPres.label}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {msg ? (
        <div
          role="status"
          className="flex gap-3 rounded-2xl border border-[hsl(var(--border))] border-s-4 border-s-[hsl(var(--primary))] bg-[hsl(var(--muted))]/40 px-4 py-3 text-sm shadow-sm"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--primary))]/12 text-[hsl(var(--primary))]">
            <Info className="h-4 w-4" />
          </div>
          <p className="min-w-0 flex-1 pt-1 leading-relaxed">{msg}</p>
        </div>
      ) : null}

      <div
        className="flex gap-1 rounded-2xl border border-[hsl(var(--border))]/80 bg-[hsl(var(--muted))]/25 p-1 shadow-inner"
        role="tablist"
        aria-label={t("profile.title")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "details"}
          onClick={() => setActiveTab("details")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
            activeTab === "details"
              ? "bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm ring-1 ring-[hsl(var(--border))]/60"
              : "opacity-70 hover:opacity-100"
          )}
        >
          <User className="h-4 w-4 shrink-0" />
          {t("users.profile")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "traffic"}
          onClick={() => setActiveTab("traffic")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
            activeTab === "traffic"
              ? "bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm ring-1 ring-[hsl(var(--border))]/60"
              : "opacity-70 hover:opacity-100"
          )}
        >
          <BarChart3 className="h-4 w-4 shrink-0" />
          {t("profile.trafficTitle")}
        </button>
      </div>

      {activeTab === "details" ? (
        <>
          {canManage ? (
            <Card variant="subtle" className="space-y-5">
              <ProfileSectionTitle icon={KeyRound} title={t("profile.radiusPassword")} hint={t("profile.radiusPasswordHint")} />
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem] flex-1">
                  <div className="mb-1.5 flex items-center gap-2 text-xs font-medium opacity-75">
                    <Shield className="h-3.5 w-3.5 opacity-60" />
                    {t("users.password")}
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/35 px-3 py-2.5 font-mono text-sm shadow-inner break-all">
                    {passwordRevealLoading ? (
                      <span className="inline-flex items-center gap-2 opacity-70">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("common.loading")}
                      </span>
                    ) : revealedPw != null ? (
                      revealedPw
                    ) : (
                      t("users.passwordHidden")
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void toggleRevealPassword()}
                  disabled={passwordRevealLoading}
                  className="shrink-0"
                >
                  {revealedPw != null ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {revealedPw != null ? t("common.hide") : t("common.show")}
                </Button>
              </div>
              <div className="border-t border-[hsl(var(--border))]/80 pt-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <KeyRound className="h-4 w-4 opacity-60" />
                    {t("profile.changePassword")}
                  </div>
                  <Button
                    type="button"
                    variant={showPasswordEditor ? "outline" : "soft"}
                    onClick={() => {
                      setShowPasswordEditor((prev) => !prev);
                      if (showPasswordEditor) {
                        setNewPwd("");
                        setConfirmPwd("");
                      }
                    }}
                  >
                    {showPasswordEditor ? t("common.cancel") : t("profile.changePassword")}
                  </Button>
                </div>
                {showPasswordEditor ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField
                        type="password"
                        autoComplete="new-password"
                        label={t("profile.newPassword")}
                        value={newPwd}
                        onChange={(e) => setNewPwd(e.target.value)}
                      />
                      <TextField
                        type="password"
                        autoComplete="new-password"
                        label={t("profile.confirmPassword")}
                        value={confirmPwd}
                        onChange={(e) => setConfirmPwd(e.target.value)}
                      />
                    </div>
                    <div className="mt-4">
                      <Button type="button" variant="primary" onClick={() => void savePasswordChange()} disabled={passwordBusy}>
                        {passwordBusy ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("common.loading")}
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4" />
                            {t("profile.updatePassword")}
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            </Card>
          ) : (
            <div className="flex items-start gap-3 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-4 py-3 text-xs opacity-80">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 opacity-50" />
              {t("users.passwordRestricted")}
            </div>
          )}

          {showSpeedPanel ? (
            <Card className="space-y-4">
              <ProfileSectionTitle
                icon={Gauge}
                title={t("speed.subscriberSectionTitle")}
                hint={t("speed.subscriberSectionHint")}
              />
              {speedLoading ? (
                <p className="text-sm opacity-70">{t("common.loading")}</p>
              ) : (
                <div className="space-y-3 text-sm">
                  {speedEff ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <span className="opacity-70">{t("speed.effectiveMikrotik")}</span>
                        <code className="max-w-full break-all rounded bg-[hsl(var(--muted))] px-2 py-0.5 text-xs">
                          {speedEff.mikrotikValue ?? "—"}
                        </code>
                      </div>
                      <div>
                        <span className="opacity-70">{t("speed.effectiveSource")}</span>{" "}
                        <span className="font-medium">{speedEff.source}</span>
                      </div>
                    </>
                  ) : (
                    <p className="opacity-70">{t("speed.noEffective")}</p>
                  )}
                  {speedLogs.length > 0 ? (
                    <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-[hsl(var(--border))]/80 p-2 text-xs">
                      <div className="mb-1 font-semibold opacity-80">{t("speed.changeHistory")}</div>
                      <ul className="space-y-1">
                        {speedLogs.slice(0, 8).map((log) => (
                          <li key={String(log.id)} className="opacity-90">
                            {String(log.applied_at ?? "").replace("T", " ").slice(0, 19)} —{" "}
                            {String(log.new_mikrotik_value ?? log.source ?? "")}
                            {log.coa_ok === 0 ? (
                              <span className="text-amber-600"> ({t("speed.coaFailed")})</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {canSpeedOverride ? (
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button type="button" variant="outline" onClick={() => setSpeedBoostOpen(true)}>
                        {t("speed.temporaryBoost")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={speedBusy}
                        onClick={() => void removeSpeedOverride()}
                      >
                        {t("speed.removeOverride")}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => void loadSpeedInfo()}>
                        {t("common.refresh")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}

          <Card className="space-y-8">
            <form onSubmit={onSave} className="space-y-8">
              <div>
                <ProfileSectionTitle icon={Layers} title={t("profile.sectionSubscription")} />
                <div className="space-y-4">
                  <SelectField label={t("users.package")} value={packageId} onChange={(e) => setPackageId(e.target.value)} disabled={!canManage}>
                    <option value="">—</option>
                    {packages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </SelectField>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      type="date"
                      label={t("profile.subscriptionExpires")}
                      value={expirationDate}
                      onChange={(e) => setExpirationDate(e.target.value)}
                      disabled={!canManage || expirationUnlimited}
                    />
                    <label className="flex cursor-pointer items-center gap-2 self-end rounded-xl border border-[hsl(var(--border))] px-3 py-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={expirationUnlimited}
                        onChange={(e) => setExpirationUnlimited(e.target.checked)}
                        disabled={!canManage}
                      />
                      {t("profile.subscriptionUnlimited")}
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label={t("packages.simUse")}
                      type="number"
                      min={1}
                      max={32}
                      value={simultaneousUse}
                      onChange={(e) => setSimultaneousUse(e.target.value)}
                      disabled={!canManage}
                    />
                    <SelectField label={t("users.nas")} value={nasId} onChange={(e) => setNasId(e.target.value)} disabled={!canManage}>
                      <option value="">—</option>
                      {nasList.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name} ({n.ip})
                        </option>
                      ))}
                    </SelectField>
                  </div>
                  <TextField label={t("users.pool")} value={pool} onChange={(e) => setPool(e.target.value)} disabled={!canManage} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label={t("users.ip")} value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} disabled={!canManage} />
                    <TextField label={t("users.mac")} value={macAddress} onChange={(e) => setMacAddress(e.target.value)} disabled={!canManage} />
                  </div>
                </div>
              </div>

              <div className="border-t border-[hsl(var(--border))]/80 pt-8">
                <ProfileSectionTitle icon={UserCircle} title={t("profile.sectionContact")} />
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label={t("users.firstName")} value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={!canManage} />
                    <TextField label={t("users.lastName")} value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={!canManage} />
                  </div>
                  <TextField label={t("users.phone")} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!canManage} />
                  {canManage ? (
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/25 px-4 py-3.5 text-sm transition-colors hover:border-[hsl(var(--primary))]/25">
                      <MessageCircleOff className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--primary))]/80" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 font-medium">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded border-[hsl(var(--border))]"
                            checked={whatsappOptOut}
                            onChange={(e) => setWhatsappOptOut(e.target.checked)}
                          />
                          {t("profile.whatsappOptOut")}
                        </span>
                        <span className="mt-1.5 block text-xs leading-relaxed opacity-70">{t("profile.whatsappOptOutHint")}</span>
                      </span>
                    </label>
                  ) : null}
                  <TextField label={t("users.address")} value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canManage} />
                  <SelectField
                    label={`${t("users.region")} (${t("common.optional")})`}
                    value={regionId}
                    onChange={(e) => setRegionId(e.target.value)}
                    disabled={!canManage}
                  >
                    <option value="">—</option>
                    {regionSelectOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </SelectField>
                </div>
              </div>

              {canManage ? (
                <div className="flex flex-wrap gap-2 border-t border-[hsl(var(--border))]/80 pt-6">
                  <Button type="submit" variant="primary" disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("common.loading")}
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        {t("common.save")}
                      </>
                    )}
                  </Button>
                  <Button type="button" variant="outline" onClick={onClose}>
                    <X className="h-4 w-4 opacity-70" />
                    {t("common.cancel")}
                  </Button>
                  {active ? (
                    <Button type="button" variant="danger" className="border border-transparent" onClick={() => void onDisable()}>
                      <Ban className="h-4 w-4" />
                      {t("profile.disable")}
                    </Button>
                  ) : (
                    <Button type="button" variant="success" onClick={() => void onEnable()}>
                      <Power className="h-4 w-4" />
                      {t("profile.enable")}
                    </Button>
                  )}
                  <Button type="button" variant="outline" className="border-red-500/40 text-red-600 hover:bg-red-500/10" onClick={() => void onDelete()}>
                    <Trash2 className="h-4 w-4" />
                    {t("common.delete")}
                  </Button>
                </div>
              ) : null}
            </form>
          </Card>

          <Card variant="subtle" className="space-y-5">
            <ProfileSectionTitle icon={Gauge} title={t("profile.sectionMeta")} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatTile icon={Hash} label={t("profile.internalId")} value={String(row.id)} />
              <StatTile icon={User} label={t("users.createdBy")} value={String(row.creator_name ?? "—")} />
              <StatTile
                icon={Calendar}
                label={t("users.expires")}
                value={String(row.expiration_date ?? "").slice(0, 19).replace("T", " ") || "—"}
              />
              <StatTile
                icon={Gauge}
                label={t("profile.quotaTotal")}
                value={quotaTotal > 0 ? fmtBytes(quotaTotal) : t("packages.unlimited")}
              />
              <StatTile
                icon={Activity}
                label={t("users.remainingQuota")}
                value={quotaTotal > 0 ? fmtBytes(remainingBytes) : t("packages.unlimited")}
              />
              <StatTile
                icon={Clock}
                label={t("users.createdAt")}
                value={String(row.created_at ?? "").slice(0, 19).replace("T", " ") || "—"}
              />
            </div>
          </Card>

        </>
      ) : null}

      {activeTab === "traffic" ? (
        <Card className="space-y-6">
          <div className="flex flex-col gap-4 border-b border-[hsl(var(--border))]/60 pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--primary))]/12 text-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary))]/20">
                <BarChart3 className="h-6 w-6" strokeWidth={1.75} />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{t("profile.trafficTitle")}</h2>
                <p className="mt-1 max-w-md text-xs leading-relaxed opacity-65">{t("profile.trafficIntro")}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={exportCsv} disabled={!traffic}>
                <Download className="h-4 w-4" />
                {t("profile.exportCsv")}
              </Button>
              <Button type="button" variant="outline" onClick={exportPdf} disabled={!traffic}>
                <FileText className="h-4 w-4" />
                {t("profile.exportPdf")}
              </Button>
              <Button type="button" variant="soft" onClick={() => void loadTraffic()} disabled={trafficLoading}>
                <RefreshCw className={cn("h-4 w-4", trafficLoading && "animate-spin")} />
                {trafficLoading ? t("common.loading") : t("common.refresh")}
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
            <TextField
              type="date"
              label={t("profile.dateFrom")}
              value={trafficFrom}
              onChange={(e) => setTrafficFrom(e.target.value)}
            />
            <TextField
              type="date"
              label={t("profile.dateTo")}
              value={trafficTo}
              onChange={(e) => setTrafficTo(e.target.value)}
            />
            <div className="flex items-end">
              <Button type="button" variant="primary" onClick={() => void loadTraffic()}>
                <BarChart3 className="h-4 w-4 opacity-90" />
                {t("profile.applyFilter")}
              </Button>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTrafficFrom("");
                  setTrafficTo("");
                  void loadTraffic({ from: "", to: "" });
                }}
              >
                <X className="h-4 w-4 opacity-70" />
                {t("profile.clearFilter")}
              </Button>
            </div>
          </div>
          {!traffic ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-6 py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--muted))]/50 text-[hsl(var(--primary))]/50">
                {trafficLoading ? (
                  <Loader2 className="h-7 w-7 animate-spin" />
                ) : (
                  <Activity className="h-7 w-7" />
                )}
              </div>
              {trafficLoading ? (
                <p className="max-w-sm text-sm opacity-75">{t("common.loading")}</p>
              ) : trafficLoadError ? (
                <p className="max-w-md whitespace-pre-wrap text-sm text-red-600 dark:text-red-400">{trafficLoadError}</p>
              ) : (
                <p className="max-w-sm text-sm opacity-75">{t("profile.trafficEmpty")}</p>
              )}
            </div>
          ) : (
          <>
            {traffic.data_issue === "radacct_username_missing" ? (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  {isRtl
                    ? "بيانات الجلسات موجودة في radacct، لكن اسم المستخدم داخل الجلسات فارغ بعد الاستعادة، لذلك لا يمكن ربط التقرير بهذا المشترك. يلزم إعادة استعادة radacct من نسخة تحتوي أعمدة username و acctstarttime والاستهلاك."
                    : "Session rows exist in radacct, but their username is blank after restore, so this report cannot be linked to this subscriber. Restore radacct again from a backup that includes username, acctstarttime, and traffic columns."}
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-3">
                <div className="mb-2 text-xs font-semibold opacity-70">{t("profile.dailyUsageChart")}</div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={usageChartData}>
                      <defs>
                        <linearGradient id="trafficDaily" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => `${v.toFixed(2)} GB`} />
                      <Area
                        type="monotone"
                        dataKey="totalGb"
                        stroke="hsl(var(--primary))"
                        fill="url(#trafficDaily)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className="p-3">
                <div className="mb-2 text-xs font-semibold opacity-70">{t("profile.monthlyUsageChart")}</div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyChartData}>
                      <defs>
                        <linearGradient id="trafficMonthly" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => `${v.toFixed(2)} GB`} />
                      <Area
                        type="monotone"
                        dataKey="totalGb"
                        stroke="#10b981"
                        fill="url(#trafficMonthly)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[hsl(var(--border))] p-3">
                <div className="text-xs opacity-60">{t("profile.dailyTotals")}</div>
                <div className="mt-2 text-sm">
                  <div>{t("profile.totalOnline")}: <span className="font-mono">{fmtDuration(traffic.totals.daily_online_seconds)}</span></div>
                  <div>{t("profile.download")}: <span className="font-mono">{fmtBytes(traffic.totals.daily_download_bytes)}</span></div>
                  <div>{t("profile.upload")}: <span className="font-mono">{fmtBytes(traffic.totals.daily_upload_bytes)}</span></div>
                  <div>{t("profile.totalUsage")}: <span className="font-mono">{fmtBytes(traffic.totals.daily_total_bytes)}</span></div>
                </div>
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] p-3">
                <div className="text-xs opacity-60">{t("profile.monthlyTotals")}</div>
                <div className="mt-2 text-sm">
                  <div>{t("profile.totalOnline")}: <span className="font-mono">{fmtDuration(traffic.totals.monthly_online_seconds)}</span></div>
                  <div>{t("profile.download")}: <span className="font-mono">{fmtBytes(traffic.totals.monthly_download_bytes)}</span></div>
                  <div>{t("profile.upload")}: <span className="font-mono">{fmtBytes(traffic.totals.monthly_upload_bytes)}</span></div>
                  <div>{t("profile.totalUsage")}: <span className="font-mono">{fmtBytes(traffic.totals.monthly_total_bytes)}</span></div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))]">
                <div className="border-b border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold opacity-70">
                  {t("profile.dailyReport")}
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[hsl(var(--muted))]/50">
                      <tr>
                        <th className="px-2 py-2 text-start">{t("profile.period")}</th>
                        <th className="px-2 py-2 text-start">{t("profile.totalOnline")}</th>
                        <th className="px-2 py-2 text-start">{t("profile.totalUsage")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traffic.daily.map((d) => (
                        <tr key={d.period} className="border-t border-[hsl(var(--border))]/50">
                          <td className="px-2 py-2 font-mono">{d.period}</td>
                          <td className="px-2 py-2 font-mono">{fmtDuration(d.online_seconds)}</td>
                          <td className="px-2 py-2 font-mono">{fmtBytes(d.total_bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))]">
                <div className="border-b border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold opacity-70">
                  {t("profile.monthlyReport")}
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[hsl(var(--muted))]/50">
                      <tr>
                        <th className="px-2 py-2 text-start">{t("profile.period")}</th>
                        <th className="px-2 py-2 text-start">{t("profile.totalOnline")}</th>
                        <th className="px-2 py-2 text-start">{t("profile.totalUsage")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traffic.monthly.map((m) => (
                        <tr key={m.period} className="border-t border-[hsl(var(--border))]/50">
                          <td className="px-2 py-2 font-mono">{m.period}</td>
                          <td className="px-2 py-2 font-mono">{fmtDuration(m.online_seconds)}</td>
                          <td className="px-2 py-2 font-mono">{fmtBytes(m.total_bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))]">
              <div className="border-b border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold opacity-70">
                {t("profile.sessionsDetails")}
              </div>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[hsl(var(--muted))]/50">
                    <tr>
                      <th className="px-2 py-2 text-start">#</th>
                      <th className="px-2 py-2 text-start">{t("profile.sessionStart")}</th>
                      <th className="px-2 py-2 text-start">{t("profile.sessionStop")}</th>
                      <th className="px-2 py-2 text-start">{t("profile.totalOnline")}</th>
                      <th className="px-2 py-2 text-start">{t("profile.download")}</th>
                      <th className="px-2 py-2 text-start">{t("profile.upload")}</th>
                      <th className="px-2 py-2 text-start">{t("profile.totalUsage")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traffic.sessions.map((s, idx) => (
                      <tr key={s.radacctid} className="border-t border-[hsl(var(--border))]/50">
                        <td className="px-2 py-2 font-mono">{idx + 1}</td>
                        <td className="px-2 py-2 font-mono">{fmtDateTime(s.start_time)}</td>
                        <td className="px-2 py-2 font-mono">{s.is_active ? t("profile.activeSession") : fmtDateTime(s.stop_time)}</td>
                        <td className="px-2 py-2 font-mono">{fmtDuration(s.online_seconds)}</td>
                        <td className="px-2 py-2 font-mono">{fmtBytes(s.download_bytes)}</td>
                        <td className="px-2 py-2 font-mono">{fmtBytes(s.upload_bytes)}</td>
                        <td className="px-2 py-2 font-mono">{fmtBytes(s.total_bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
        </Card>
      ) : null}
      <Modal
        open={speedBoostOpen}
        onClose={() => !speedBusy && setSpeedBoostOpen(false)}
        title={t("speed.temporaryBoost")}
      >
        <div className="space-y-4 text-sm">
          <SelectField
            label={t("speed.pickProfile")}
            value={speedBoostProfileId}
            onChange={(e) => setSpeedBoostProfileId(e.target.value)}
          >
            <option value="">—</option>
            {speedProfilesPick.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t("speed.endsAtLocal")}
            type="datetime-local"
            value={speedBoostEnds}
            onChange={(e) => setSpeedBoostEnds(e.target.value)}
          />
          <p className="text-xs opacity-70">{t("speed.boostHint")}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={speedBusy} onClick={() => setSpeedBoostOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={speedBusy || !speedBoostProfileId} onClick={() => void submitSpeedBoost()}>
              {speedBusy ? t("common.loading") : t("common.confirm")}
            </Button>
          </div>
        </div>
      </Modal>
      <ActionDialog
        open={disableConfirmOpen}
        title={t("common.actions")}
        message={`${t("profile.disable")}?`}
        variant="warning"
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onClose={() => setDisableConfirmOpen(false)}
        onConfirm={() => {
          void confirmDisable();
        }}
      />
      <ActionDialog
        open={deleteConfirmOpen}
        title={t("common.delete")}
        message={t("profile.deleteConfirm")}
        variant="danger"
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          void confirmDelete();
        }}
      />
    </div>
  );
}
