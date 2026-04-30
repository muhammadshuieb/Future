import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { SelectField, TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { canManageOperations } from "../lib/permissions";
import { cn } from "../lib/utils";

type Pkg = Record<string, unknown>;
const currencies = ["USD", "SYP", "TRY"] as const;

function quotaGbToBytesString(gbStr: string): string {
  const n = parseFloat(String(gbStr).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return "0";
  const bytes = Math.round(n * 1024 ** 3);
  return String(bytes);
}

function bytesToQuotaGbField(bytes: unknown): string {
  const raw = String(bytes ?? "0").trim();
  if (!raw || raw === "0") return "0";
  try {
    const b = BigInt(raw);
    if (b <= 0n) return "0";
    const gb = Number(b) / 1024 ** 3;
    if (!Number.isFinite(gb)) return "0";
    return gb >= 10 ? gb.toFixed(1) : gb.toFixed(2);
  } catch {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return "0";
    const gb = n / 1024 ** 3;
    return gb >= 10 ? gb.toFixed(1) : gb.toFixed(2);
  }
}

export function PackagesPage() {
  const { t, isRtl, locale } = useI18n();
  const { user } = useAuth();
  const canManage = canManageOperations(user?.role);

  const [items, setItems] = useState<Pkg[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [quotaGb, setQuotaGb] = useState("0");
  const [price, setPrice] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const [billingDays, setBillingDays] = useState("30");
  const [simUse, setSimUse] = useState("1");
  const [accountType, setAccountType] = useState<"subscriptions" | "cards">("subscriptions");
  const [framedPool, setFramedPool] = useState("");
  const [allowedNasIds, setAllowedNasIds] = useState<string[]>([]);
  const [allowedManagerNames, setAllowedManagerNames] = useState<string[]>([]);
  const [nasOptions, setNasOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [managerOptions, setManagerOptions] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await apiFetch("/api/packages/");
      if (r.ok) {
        const payload = (await r.json()) as {
          items: Pkg[];
          options?: { nases?: Array<{ id: string; name: string }>; managers?: Array<{ id: string; name: string }> };
        };
        setItems(payload.items);
        setNasOptions(payload.options?.nases ?? []);
        setManagerOptions(payload.options?.managers ?? []);
      } else {
        const raw = await readApiError(r);
        setLoadError(formatStaffApiError(r.status, raw, t));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditId(null);
    setName("");
    setRate("");
    setQuotaGb("0");
    setPrice("0");
    setCurrency("USD");
    setBillingDays("30");
    setSimUse("1");
    setAccountType("subscriptions");
    setFramedPool("");
    setAllowedNasIds([]);
    setAllowedManagerNames([]);
    setFormError(null);
    setModal("create");
  }

  function openEdit(p: Pkg) {
    setEditId(String(p.id));
    setName(String(p.name ?? ""));
    setRate(String(p.mikrotik_rate_limit ?? ""));
    setQuotaGb(bytesToQuotaGbField(p.quota_total_bytes));
    setPrice(String(p.price ?? "0"));
    setCurrency(String(p.currency ?? "USD"));
    setBillingDays(String(p.billing_period_days ?? "30"));
    setSimUse(String(p.simultaneous_use ?? "1"));
    setAccountType(String(p.account_type ?? "subscriptions") === "cards" ? "cards" : "subscriptions");
    setFramedPool(String(p.default_framed_pool ?? ""));
    setAllowedNasIds(
      Array.isArray(p.allowed_nas_ids) ? p.allowed_nas_ids.map((v) => String(v)) : []
    );
    setAllowedManagerNames(
      Array.isArray(p.available_manager_names) ? p.available_manager_names.map((v) => String(v)) : []
    );
    setFormError(null);
    setModal("edit");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      if (modal === "create") {
        const r = await apiFetch("/api/packages/", {
          method: "POST",
          body: JSON.stringify({
            name,
            mikrotik_rate_limit: rate || null,
            quota_total_bytes: quotaGbToBytesString(quotaGb),
            price: parseFloat(price) || 0,
            currency,
            billing_period_days: parseInt(billingDays, 10) || 30,
            simultaneous_use: parseInt(simUse, 10) || 1,
            account_type: accountType,
            default_framed_pool: framedPool || null,
            allowed_nas_ids: allowedNasIds,
            available_manager_names: allowedManagerNames,
          }),
        });
        if (r.ok) {
          setModal(null);
          await load();
        } else {
          const raw = await readApiError(r);
          setFormError(formatStaffApiError(r.status, raw, t));
        }
      } else if (modal === "edit" && editId) {
        const r = await apiFetch(`/api/packages/${editId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            mikrotik_rate_limit: rate || null,
            quota_total_bytes: quotaGbToBytesString(quotaGb),
            price: parseFloat(price) || 0,
            currency,
            billing_period_days: parseInt(billingDays, 10) || 30,
            simultaneous_use: parseInt(simUse, 10) || 1,
            account_type: accountType,
            default_framed_pool: framedPool || null,
            allowed_nas_ids: allowedNasIds,
            available_manager_names: allowedManagerNames,
          }),
        });
        if (r.ok) {
          setModal(null);
          await load();
        } else {
          const raw = await readApiError(r);
          setFormError(formatStaffApiError(r.status, raw, t));
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    const confirmed = window.confirm(t("packages.deleteConfirm"));
    if (!confirmed) return;
    setLoadError(null);
    setDeletingId(id);
    try {
      const r = await apiFetch(`/api/packages/${id}`, { method: "DELETE" });
      if (r.ok) {
        await load();
        return;
      }
      const raw = await readApiError(r);
      setLoadError(formatStaffApiError(r.status, raw, t));
    } finally {
      setDeletingId(null);
    }
  }

  function toggleNas(id: string) {
    setAllowedNasIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }
  function toggleManager(id: string) {
    setAllowedManagerNames((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }

  return (
    <div className="space-y-6">
      {loadError ? (
        <div className="whitespace-pre-wrap rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          {loadError}
        </div>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("packages.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("packages.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2", loading && "animate-spin")} />
          </Button>
          {canManage ? (
            <Button type="button" onClick={openCreate}>
              <Plus className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
              {t("packages.add")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <Card key={String(p.id)} className="relative overflow-hidden">
            <div className="absolute start-0 top-0 h-1 w-full bg-[hsl(var(--primary))]" />
            <div className="flex items-start justify-between gap-2">
              <div className="text-lg font-semibold leading-snug">{String(p.name)}</div>
              <div className="text-xs opacity-70">
                {String(p.account_type ?? "subscriptions") === "cards"
                  ? t("packages.type.cards")
                  : t("packages.type.subscriptions")}
              </div>
              {canManage ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="rounded-lg p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
                    aria-label={t("common.edit")}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(String(p.id))}
                    disabled={deletingId === String(p.id)}
                    className="rounded-lg p-2 text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={t("common.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
            <dl className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="opacity-60">{t("packages.rateLimit")}</dt>
                <dd className="text-end font-medium">{String(p.mikrotik_rate_limit ?? "—")}</dd>
              </div>
              <div className="flex justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="opacity-60">{t("packages.quotaGb")}</dt>
                <dd className="text-end font-mono">
                  {String(p.quota_total_bytes ?? "0") === "0"
                    ? t("packages.unlimited")
                    : `${bytesToQuotaGbField(p.quota_total_bytes)} GB`}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="opacity-60">{t("packages.price")}</dt>
                <dd className="text-end font-semibold">
                  {String(p.price)} {String(p.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="opacity-60">{t("packages.allowedNas")}</dt>
                <dd className="text-end font-medium">{Array.isArray(p.allowed_nas_ids) ? p.allowed_nas_ids.length : 0}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="opacity-60">{t("packages.availableManagers")}</dt>
                <dd className="text-end font-medium">
                  {Array.isArray(p.available_manager_names) ? p.available_manager_names.length : 0}
                </dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>

      <Modal
        open={modal !== null}
        onClose={() => {
          setFormError(null);
          setModal(null);
        }}
        title={modal === "edit" ? t("common.edit") : t("packages.add")}
        wide
      >
        <form onSubmit={onSubmit} className="space-y-4">
          {formError ? (
            <div className="whitespace-pre-wrap rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {formError}
            </div>
          ) : null}
          <TextField label={t("packages.name")} value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField label={t("packages.rateLimit")} value={rate} onChange={(e) => setRate(e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("packages.quotaGb")}
              value={quotaGb}
              onChange={(e) => setQuotaGb(e.target.value)}
              placeholder="0"
            />
            <TextField label={t("packages.pool")} value={framedPool} onChange={(e) => setFramedPool(e.target.value)} />
          </div>
          <p className="text-xs opacity-60">{t("packages.quotaGbHint")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t("packages.price")} value={price} onChange={(e) => setPrice(e.target.value)} />
            <SelectField label={t("packages.currency")} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((item) => (
                <option key={item} value={item}>
                  {t(`currency.${item.toLowerCase()}`)}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t("packages.billingDays")} value={billingDays} onChange={(e) => setBillingDays(e.target.value)} />
            <TextField label={t("packages.simUse")} value={simUse} onChange={(e) => setSimUse(e.target.value)} />
          </div>
          <SelectField label={t("packages.type")} value={accountType} onChange={(e) => setAccountType(e.target.value as "subscriptions" | "cards")}>
            <option value="subscriptions">{t("packages.type.subscriptions")}</option>
            <option value="cards">{t("packages.type.cards")}</option>
          </SelectField>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("packages.allowedNas")}</label>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-3">
                <label className="mb-2 flex cursor-pointer items-center justify-between rounded-lg bg-[hsl(var(--card))]/70 px-2 py-1 text-sm">
                  <span>{t("packages.selectAll")}</span>
                  <input
                    type="checkbox"
                    checked={nasOptions.length > 0 && allowedNasIds.length === nasOptions.length}
                    onChange={(e) =>
                      setAllowedNasIds(e.target.checked ? nasOptions.map((n) => n.id) : [])
                    }
                  />
                </label>
                <div className="max-h-40 space-y-1 overflow-auto">
                  {nasOptions.map((n) => (
                    <label
                      key={n.id}
                      className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-[hsl(var(--card))]/70"
                    >
                      <span className={cn("truncate", locale === "ar" ? "ms-2" : "me-2")}>{n.name}</span>
                      <input
                        type="checkbox"
                        checked={allowedNasIds.includes(n.id)}
                        onChange={() => toggleNas(n.id)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("packages.availableManagers")}</label>
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-3">
                <label className="mb-2 flex cursor-pointer items-center justify-between rounded-lg bg-[hsl(var(--card))]/70 px-2 py-1 text-sm">
                  <span>{t("packages.selectAll")}</span>
                  <input
                    type="checkbox"
                    checked={
                      managerOptions.length > 0 && allowedManagerNames.length === managerOptions.length
                    }
                    onChange={(e) =>
                      setAllowedManagerNames(
                        e.target.checked ? managerOptions.map((m) => m.id) : []
                      )
                    }
                  />
                </label>
                <div className="max-h-40 space-y-1 overflow-auto">
                  {managerOptions.map((m) => (
                    <label
                      key={m.id}
                      className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-[hsl(var(--card))]/70"
                    >
                      <span className={cn("truncate", locale === "ar" ? "ms-2" : "me-2")}>{m.name}</span>
                      <input
                        type="checkbox"
                        checked={allowedManagerNames.includes(m.id)}
                        onChange={() => toggleManager(m.id)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModal(null)}>
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
