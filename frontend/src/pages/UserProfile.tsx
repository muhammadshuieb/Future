import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, X, Trash2 } from "lucide-react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { SelectField, TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { canManageOperations } from "../lib/permissions";
import { cn } from "../lib/utils";

type Row = {
  id: string;
  username: string;
  status?: string | null;
  package_id?: string | null;
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

export function UserProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = canManageOperations(user?.role);
  const canPayInvoice = user?.role === "admin" || user?.role === "manager" || user?.role === "accountant";
  const canCreateInvoice = canPayInvoice;

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

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [rSub, rPkg, rNas] = await Promise.all([
        apiFetch("/api/subscribers/"),
        apiFetch("/api/packages/"),
        apiFetch("/api/nas/"),
      ]);
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
  }, [id]);

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

  if (loading || !row) {
    return (
      <p className="text-sm opacity-70" dir={isRtl ? "rtl" : "ltr"}>
        {t("common.loading")}
      </p>
    );
  }

  const active = row.status === "active";

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
    </div>
  );
}
