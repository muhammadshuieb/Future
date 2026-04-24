import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { canManageOperations } from "../lib/permissions";
import { cn } from "../lib/utils";

type NasRow = Record<string, unknown>;

export function NasPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = canManageOperations(user?.role);

  const [servers, setServers] = useState<NasRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Show/hide RADIUS secret on card (fetched once per id). */
  const [secretShown, setSecretShown] = useState<Record<string, boolean>>({});
  const [secretValues, setSecretValues] = useState<Record<string, string | undefined>>({});
  const [secretLoading, setSecretLoading] = useState<Record<string, boolean>>({});

  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [nasType, setNasType] = useState("mikrotik");
  const [mikrotikApiEnabled, setMikrotikApiEnabled] = useState(false);
  const [mikrotikApiUser, setMikrotikApiUser] = useState("");
  const [mikrotikApiPassword, setMikrotikApiPassword] = useState("");
  const [wireguardTunnelIp, setWireguardTunnelIp] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await apiFetch("/api/nas/");
      if (r.ok) {
        const j = (await r.json()) as { nas_servers: NasRow[] };
        setServers(j.nas_servers ?? []);
      } else {
        const raw = await readApiError(r);
        setLoadError(formatStaffApiError(r.status, raw, t));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  async function onDeleteNas(n: NasRow) {
    if (!window.confirm(t("nas.deleteConfirm"))) return;
    setLoadError(null);
    try {
      const r = await apiFetch(`/api/nas/${String(n.id)}`, { method: "DELETE" });
      if (r.ok) {
        setSecretShown((prev) => {
          const next = { ...prev };
          delete next[String(n.id)];
          return next;
        });
        setSecretValues((prev) => {
          const next = { ...prev };
          delete next[String(n.id)];
          return next;
        });
        await load();
      } else {
        const raw = await readApiError(r);
        setLoadError(formatStaffApiError(r.status, raw, t));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleRevealSecret(nasId: string) {
    if (secretShown[nasId]) {
      setSecretShown((prev) => ({ ...prev, [nasId]: false }));
      return;
    }
    if (secretValues[nasId] !== undefined) {
      setSecretShown((prev) => ({ ...prev, [nasId]: true }));
      return;
    }
    setSecretLoading((prev) => ({ ...prev, [nasId]: true }));
    try {
      const r = await apiFetch(`/api/nas/${nasId}/secret`);
      if (r.ok) {
        const j = (await r.json()) as { secret?: string };
        setSecretValues((prev) => ({ ...prev, [nasId]: j.secret ?? "" }));
        setSecretShown((prev) => ({ ...prev, [nasId]: true }));
      }
    } finally {
      setSecretLoading((prev) => ({ ...prev, [nasId]: false }));
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditId(null);
    setName("");
    setIp("");
    setSecret("");
    setPassword("");
    setNasType("mikrotik");
    setMikrotikApiEnabled(false);
    setMikrotikApiUser("");
    setMikrotikApiPassword("");
    setWireguardTunnelIp("");
    setFormError(null);
    setModal("create");
  }

  function openEdit(n: NasRow) {
    setEditId(String(n.id));
    setName(String(n.name ?? ""));
    setIp(String(n.ip ?? ""));
    setSecret("");
    setPassword("");
    setNasType(String(n.type ?? "mikrotik"));
    setMikrotikApiEnabled(Boolean(n.mikrotik_api_enabled));
    setMikrotikApiUser(String(n.mikrotik_api_user ?? ""));
    setMikrotikApiPassword("");
    setWireguardTunnelIp(String(n.wireguard_tunnel_ip ?? ""));
    setFormError(null);
    setModal("edit");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (modal === "create" && !secret.trim()) {
      setFormError(t("api.secret_required"));
      return;
    }
    setSaving(true);
    try {
      if (modal === "create") {
        const r = await apiFetch("/api/nas/", {
          method: "POST",
          body: JSON.stringify({
            name,
            ip,
            secret,
            type: nasType,
            password: password || undefined,
            mikrotik_api_enabled: mikrotikApiEnabled,
            mikrotik_api_user: mikrotikApiUser || undefined,
            mikrotik_api_password: mikrotikApiPassword || undefined,
            wireguard_tunnel_ip: wireguardTunnelIp || undefined,
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
        const body: Record<string, unknown> = { name, ip, type: nasType };
        if (secret.trim()) body.secret = secret;
        if (password.trim()) body.password = password;
        body.mikrotik_api_enabled = mikrotikApiEnabled;
        body.mikrotik_api_user = mikrotikApiUser || null;
        if (mikrotikApiPassword.trim()) body.mikrotik_api_password = mikrotikApiPassword;
        body.wireguard_tunnel_ip = wireguardTunnelIp || null;
        const r = await apiFetch(`/api/nas/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
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

  return (
    <div className="space-y-6">
      {loadError ? (
        <div className="whitespace-pre-wrap rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          {loadError}
        </div>
      ) : null}

      <Card variant="subtle" className="border-sky-500/25 bg-sky-500/5">
        <div className="text-sm font-semibold text-sky-700 dark:text-sky-300">{t("nas.radiusHelpTitle")}</div>
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed opacity-85">{t("nas.radiusHelpBody")}</p>
      </Card>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("nas.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("nas.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2", loading && "animate-spin")} />
          </Button>
          {canManage ? (
            <Button type="button" onClick={openCreate}>
              <Plus className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
              {t("nas.add")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {servers.map((n) => (
          <Card key={String(n.id)} className="relative">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-lg font-semibold">{String(n.name)}</div>
                <div className="mt-1 font-mono text-sm opacity-80">{String(n.ip)}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={cn(
                    "text-xs font-medium",
                    n.online_status === "online"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : n.online_status === "offline"
                        ? "text-red-500"
                        : "opacity-60"
                  )}
                >
                  {String(n.online_status ?? "unknown")}
                </span>
                {canManage ? (
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => openEdit(n)}
                      className="rounded-lg p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
                      aria-label={t("common.edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteNas(n)}
                      className="rounded-lg p-2 text-red-500 hover:bg-red-500/10"
                      aria-label={t("nas.delete")}
                      title={t("nas.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 border-t border-[hsl(var(--border))]/50 pt-3 text-xs opacity-70">
              <span>
                {t("nas.type")}: {String(n.type)}
              </span>
              <span>
                {t("nas.sessions")}: {String(n.session_count ?? 0)}
              </span>
              <span>
                {t("nas.mikrotikApiEnabled")}: {Boolean(n.mikrotik_api_enabled) ? t("common.yes") : t("common.no")}
              </span>
              {n.wireguard_tunnel_ip ? (
                <span>
                  {t("nas.wireguardTunnel")}: {String(n.wireguard_tunnel_ip)}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))]/40 pt-2">
              <span className="text-xs font-medium opacity-70">{t("nas.secret")}:</span>
              {canManage ? (
                <>
                  <code className="max-w-[min(100%,18rem)] truncate rounded-lg bg-[hsl(var(--muted))]/50 px-2 py-1 font-mono text-[11px]">
                    {secretShown[String(n.id)]
                      ? (secretValues[String(n.id)] ?? "—")
                      : t("users.passwordHidden")}
                  </code>
                  <button
                    type="button"
                    onClick={() => void toggleRevealSecret(String(n.id))}
                    disabled={Boolean(secretLoading[String(n.id)])}
                    className="rounded-lg p-1.5 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]/80 disabled:opacity-50"
                    title={secretShown[String(n.id)] ? t("common.hide") : t("nas.secretReveal")}
                    aria-label={t("nas.secretReveal")}
                  >
                    {secretShown[String(n.id)] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </>
              ) : (
                <span className="text-[11px] opacity-50">{t("users.passwordRestricted")}</span>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={modal !== null}
        onClose={() => {
          setFormError(null);
          setModal(null);
        }}
        title={modal === "edit" ? t("common.edit") : t("nas.add")}
        wide
      >
        <form onSubmit={onSubmit} className="space-y-4">
          {formError ? (
            <div className="whitespace-pre-wrap rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {formError}
            </div>
          ) : null}
          <TextField label={t("nas.name")} value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField label={t("nas.ip")} value={ip} onChange={(e) => setIp(e.target.value)} required />
          <TextField label={t("nas.type")} value={nasType} onChange={(e) => setNasType(e.target.value)} />
          <TextField
            label={t("nas.secret")}
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            required={modal === "create"}
            hint={modal === "edit" ? t("nas.secretHint") : undefined}
          />
          <TextField
            label={t("nas.password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t("nas.passwordHint")}
          />
          <TextField
            label={t("nas.wireguardTunnel")}
            value={wireguardTunnelIp}
            onChange={(e) => setWireguardTunnelIp(e.target.value)}
            hint={t("nas.wireguardTunnelHint")}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mikrotikApiEnabled}
              onChange={(e) => setMikrotikApiEnabled(e.target.checked)}
            />
            {t("nas.mikrotikApiEnabled")}
          </label>
          {mikrotikApiEnabled ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t("nas.mikrotikApiUser")}
                value={mikrotikApiUser}
                onChange={(e) => setMikrotikApiUser(e.target.value)}
              />
              <TextField
                label={t("nas.mikrotikApiPassword")}
                type="password"
                value={mikrotikApiPassword}
                onChange={(e) => setMikrotikApiPassword(e.target.value)}
                hint={modal === "edit" ? t("nas.secretHint") : undefined}
              />
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModal(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving || (modal === "create" && !secret.trim())}>
              {saving ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
