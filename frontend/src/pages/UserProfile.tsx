import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileText, X, Trash2 } from "lucide-react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { SelectField, TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { canManageOperations } from "../lib/permissions";
import { cn } from "../lib/utils";
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
};
type Pkg = { id: string; name: string; price?: number | string | null; currency?: string | null };
type Nas = { id: string; name: string; ip: string };
type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  amount: number | string | null;
  currency: string | null;
  status: string | null;
  issue_date: string | null;
};

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

export function UserProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = canManageOperations(user?.role);
  const canPayInvoice = user?.role === "admin" || user?.role === "manager" || user?.role === "accountant";
  const canCreateInvoice = canPayInvoice;
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
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceCurrency, setInvoiceCurrency] = useState<"USD" | "SYP">("USD");
  const [traffic, setTraffic] = useState<TrafficReport | null>(null);
  const [trafficFrom, setTrafficFrom] = useState("");
  const [trafficTo, setTrafficTo] = useState("");
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "traffic">("details");

  const [packageId, setPackageId] = useState("");
  const [nasId, setNasId] = useState("");
  const [pool, setPool] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [macAddress, setMacAddress] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [regionId, setRegionId] = useState("");

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
      try {
        const trRes = await apiFetch(`/api/subscribers/${id}/traffic-report${suffix}`);
        if (trRes.ok) {
          const tr = (await trRes.json()) as TrafficReport;
          setTraffic(tr);
        } else {
          setTraffic(null);
        }
      } finally {
        setTrafficLoading(false);
      }
    },
    [id, trafficFrom, trafficTo]
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [rSub, rPkg, rNas, rReg] = await Promise.all([
        apiFetch("/api/subscribers/"),
        apiFetch("/api/packages/"),
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
          setNickname(String(found.nickname ?? ""));
          setPhone(String(found.phone ?? ""));
          setAddress(String(found.address ?? ""));
          setRegionId(found.region_id ? String(found.region_id) : "");
          const pkg = pkgItems.find((x) => x.id === String(found.package_id ?? ""));
          if (pkg) {
            const p = Number(pkg.price ?? 0);
            setInvoiceAmount(Number.isFinite(p) && p > 0 ? String(p) : "");
            setInvoiceCurrency(String(pkg.currency ?? "USD").toUpperCase() === "SYP" ? "SYP" : "USD");
          } else {
            setInvoiceAmount("");
            setInvoiceCurrency("USD");
          }
        }
      }
      const invRes = await apiFetch(`/api/invoices/?subscriber_id=${id}`);
      if (invRes.ok) {
        const invJson = (await invRes.json()) as { items: InvoiceRow[] };
        setInvoices(invJson.items ?? []);
      } else {
        setInvoices([]);
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
          nickname: nickname || null,
          phone: phone || null,
          address: address || null,
          region_id: regionId || null,
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
    if (!confirm(t("profile.disable") + "?")) return;
    const r = await apiFetch(`/api/subscribers/${id}/disable`, { method: "POST" });
    if (r.ok) await load();
  }

  async function onEnable() {
    if (!id || !canManage) return;
    const r = await apiFetch(`/api/subscribers/${id}/enable`, { method: "POST" });
    if (r.ok) await load();
  }

  async function onDelete() {
    if (!id || !canManage) return;
    if (!confirm(t("profile.deleteConfirm"))) return;
    const r = await apiFetch(`/api/subscribers/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const raw = await readApiError(r);
      setMsg(formatStaffApiError(r.status, raw, t));
      return;
    }
    navigate("/users");
  }

  async function onPayInvoice(invoiceId: string) {
    if (!canPayInvoice) return;
    setPayingInvoiceId(invoiceId);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/invoices/${invoiceId}/mark-paid`, {
        method: "POST",
        body: JSON.stringify({ payment_method: "manual" }),
      });
      if (!res.ok) {
        const raw = await readApiError(res);
        setMsg(formatStaffApiError(res.status, raw, t));
        return;
      }
      setMsg(t("profile.invoicePaid"));
      await load();
    } finally {
      setPayingInvoiceId(null);
    }
  }

  async function onCreateInvoice() {
    if (!id || !canCreateInvoice) return;
    const amount = Number(invoiceAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg(t("profile.invoiceAmountInvalid"));
      return;
    }
    setCreatingInvoice(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/invoices/generate-monthly", {
        method: "POST",
        body: JSON.stringify({
          subscriber_id: id,
          amount,
          currency: invoiceCurrency,
        }),
      });
      if (!res.ok) {
        const raw = await readApiError(res);
        setMsg(formatStaffApiError(res.status, raw, t));
        return;
      }
      setMsg(t("profile.invoiceCreated"));
      setCreateInvoiceOpen(false);
      await load();
    } finally {
      setCreatingInvoice(false);
    }
  }

  function onClose() {
    navigate("/users");
  }

  useEffect(() => {
    if (activeTab === "traffic" && !traffic && !trafficLoading) {
      void loadTraffic({ from: trafficFrom, to: trafficTo });
    }
  }, [activeTab, traffic, trafficLoading, loadTraffic, trafficFrom, trafficTo]);

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
    <div className="mx-auto max-w-3xl space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
        <Link
          to="/users"
          className={cn(
            "inline-flex items-center gap-2 text-sm font-medium text-[hsl(var(--primary))] hover:underline",
            isRtl && "flex-row-reverse"
          )}
        >
          <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
          {t("profile.back")}
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">
          {t("profile.title")}: {String(row.username)}
        </h1>
        <p className="mt-1 text-sm opacity-70">
          {t("users.package")}: {String(row.package_name ?? "—")} · {t("users.status")}: {String(row.status)}
        </p>
      </div>

      {msg ? (
        <p className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 px-4 py-2 text-sm">{msg}</p>
      ) : null}

      <Card className="p-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={activeTab === "details" ? "default" : "outline"}
            onClick={() => setActiveTab("details")}
          >
            {t("users.profile")}
          </Button>
          <Button
            type="button"
            variant={activeTab === "traffic" ? "default" : "outline"}
            onClick={() => setActiveTab("traffic")}
          >
            {t("profile.trafficTitle")}
          </Button>
        </div>
      </Card>

      {activeTab === "details" ? (
        <>
          <Card>
            <form onSubmit={onSave} className="space-y-4">
              <SelectField label={t("users.package")} value={packageId} onChange={(e) => setPackageId(e.target.value)} disabled={!canManage}>
                <option value="">—</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
              <SelectField label={t("users.nas")} value={nasId} onChange={(e) => setNasId(e.target.value)} disabled={!canManage}>
                <option value="">—</option>
                {nasList.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.ip})
                  </option>
                ))}
              </SelectField>
              <TextField label={t("users.pool")} value={pool} onChange={(e) => setPool(e.target.value)} disabled={!canManage} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={t("users.ip")} value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} disabled={!canManage} />
                <TextField label={t("users.mac")} value={macAddress} onChange={(e) => setMacAddress(e.target.value)} disabled={!canManage} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={t("users.firstName")} value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={!canManage} />
                <TextField label={t("users.lastName")} value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={!canManage} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={t("users.nickname")} value={nickname} onChange={(e) => setNickname(e.target.value)} disabled={!canManage} />
                <TextField label={t("users.phone")} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!canManage} />
              </div>
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
              {canManage ? (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? t("common.loading") : t("common.save")}
                  </Button>
                  <Button type="button" variant="outline" onClick={onClose}>
                    {t("common.cancel")}
                  </Button>
                  {active ? (
                    <Button type="button" variant="outline" className="border-red-500/50 text-red-600" onClick={() => void onDisable()}>
                      {t("profile.disable")}
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => void onEnable()}>
                      {t("profile.enable")}
                    </Button>
                  )}
                  <Button type="button" variant="outline" className="border-red-500/50 text-red-600" onClick={() => void onDelete()}>
                    <Trash2 className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
                    {t("common.delete")}
                  </Button>
                </div>
              ) : null}
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold opacity-80">{t("nav.settings")}</h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs opacity-60">ID</dt>
                <dd className="font-mono text-xs break-all">{String(row.id)}</dd>
              </div>
              <div>
                <dt className="text-xs opacity-60">{t("users.createdBy")}</dt>
                <dd className="text-xs">{String(row.creator_name ?? "—")}</dd>
              </div>
              <div>
                <dt className="text-xs opacity-60">{t("users.expires")}</dt>
                <dd className="font-mono text-xs">{String(row.expiration_date ?? "").slice(0, 19).replace("T", " ")}</dd>
              </div>
              <div>
                <dt className="text-xs opacity-60">{t("users.createdAt")}</dt>
                <dd className="font-mono text-xs">{String(row.created_at ?? "").slice(0, 19).replace("T", " ")}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold opacity-80">{t("profile.invoices")}</h2>
              {canCreateInvoice ? (
                <Button type="button" variant="outline" onClick={() => setCreateInvoiceOpen((x) => !x)}>
                  {t("profile.createInvoice")}
                </Button>
              ) : null}
            </div>
            {canCreateInvoice && createInvoiceOpen ? (
              <div className="mb-3 grid gap-2 rounded-lg border border-[hsl(var(--border))] p-3 sm:grid-cols-3">
                <TextField
                  type="number"
                  min="0"
                  step="0.01"
                  label={t("profile.invoiceAmount")}
                  value={invoiceAmount}
                  onChange={(e) => setInvoiceAmount(e.target.value)}
                />
                <SelectField
                  label={t("packages.currency")}
                  value={invoiceCurrency}
                  onChange={(e) => setInvoiceCurrency(e.target.value === "SYP" ? "SYP" : "USD")}
                >
                  <option value="USD">USD</option>
                  <option value="SYP">SYP</option>
                </SelectField>
                <div className="flex items-end">
                  <Button type="button" onClick={() => void onCreateInvoice()} disabled={creatingInvoice}>
                    {creatingInvoice ? t("common.loading") : t("profile.createInvoice")}
                  </Button>
                </div>
              </div>
            ) : null}
            {invoices.length === 0 ? (
              <p className="text-sm opacity-70">{t("profile.noInvoices")}</p>
            ) : (
              <div className="space-y-2">
                {invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm"
                  >
                    <div className="space-y-0.5">
                      <div className="font-medium">{String(invoice.invoice_no ?? invoice.id)}</div>
                      <div className="opacity-70">
                        {String(invoice.amount ?? "-")} {String(invoice.currency ?? "")} · {String(invoice.status ?? "-")}
                      </div>
                    </div>
                    {canPayInvoice && invoice.status !== "paid" ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void onPayInvoice(invoice.id)}
                        disabled={payingInvoiceId === invoice.id}
                      >
                        {payingInvoiceId === invoice.id ? t("common.loading") : t("profile.payInvoice")}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}

      {activeTab === "traffic" ? (
        <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold opacity-80">{t("profile.trafficTitle")}</h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={exportCsv} disabled={!traffic}>
              <Download className={cn("h-4 w-4", isRtl ? "ms-1" : "me-1")} />
              {t("profile.exportCsv")}
            </Button>
            <Button type="button" variant="outline" onClick={exportPdf} disabled={!traffic}>
              <FileText className={cn("h-4 w-4", isRtl ? "ms-1" : "me-1")} />
              {t("profile.exportPdf")}
            </Button>
            <Button type="button" variant="outline" onClick={() => void loadTraffic()}>
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
            <Button type="button" onClick={() => void loadTraffic()}>
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
              {t("profile.clearFilter")}
            </Button>
          </div>
        </div>
        {!traffic ? (
          <p className="text-sm opacity-70">{t("profile.trafficEmpty")}</p>
        ) : (
          <>
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
    </div>
  );
}
