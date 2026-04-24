import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Link, Network, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { useI18n } from "../context/LocaleContext";
import { cn } from "../lib/utils";

type PptpConfig = {
  pptp_vpn_enabled: boolean;
  pptp_server_host: string;
  pptp_server_port: number;
  pptp_server_username: string;
  pptp_server_password: string;
  pptp_server_password_set?: boolean;
  pptp_local_network_cidr: string;
  pptp_client_pool_cidr: string;
};

type PptpSecret = {
  id: string;
  username: string;
  password: string;
  static_ip: string;
  is_active: boolean;
  note: string;
};

type PptpConnection = {
  id: string;
  interface_name?: string;
  client_ip?: string;
  server_ip?: string;
  vpn_ip?: string;
  username?: string;
  connected_since?: string;
  last_seen_at?: string;
};

export function PptpPage() {
  const { t, isRtl } = useI18n();
  const defaultServerHost =
    typeof window !== "undefined" && window.location.hostname !== "localhost"
      ? window.location.hostname
      : "";
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingSecret, setSavingSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [config, setConfig] = useState<PptpConfig>({
    pptp_vpn_enabled: true,
    pptp_server_host: defaultServerHost,
    pptp_server_port: 1723,
    pptp_server_username: "",
    pptp_server_password: "",
    pptp_server_password_set: false,
    pptp_local_network_cidr: "10.0.0.0/24",
    pptp_client_pool_cidr: "10.10.10.0/24",
  });

  const [secrets, setSecrets] = useState<PptpSecret[]>([]);
  const [connections, setConnections] = useState<PptpConnection[]>([]);
  const [newSecret, setNewSecret] = useState({
    username: "",
    password: "",
    static_ip: "",
    note: "",
    is_active: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, secretsRes, conRes] = await Promise.all([
        apiFetch("/api/pptp/config"),
        apiFetch("/api/pptp/secrets"),
        apiFetch("/api/pptp/active-connections"),
      ]);
      if (!cfgRes.ok) {
        const raw = await readApiError(cfgRes);
        setError(formatStaffApiError(cfgRes.status, raw, t));
        return;
      }
      if (!secretsRes.ok) {
        const raw = await readApiError(secretsRes);
        setError(formatStaffApiError(secretsRes.status, raw, t));
        return;
      }
      if (!conRes.ok) {
        const raw = await readApiError(conRes);
        setError(formatStaffApiError(conRes.status, raw, t));
        return;
      }

      const cfg = (await cfgRes.json()) as { config: Partial<PptpConfig> };
      const sec = (await secretsRes.json()) as { secrets: PptpSecret[] };
      const con = (await conRes.json()) as { connections: PptpConnection[] };

      setConfig((prev) => ({
        ...prev,
        ...cfg.config,
        // Server mode: host defaults to current system host if backend value is empty.
        pptp_server_host: String(cfg.config.pptp_server_host ?? "").trim() || defaultServerHost,
        pptp_server_username: "",
        pptp_server_password: "",
      }));
      setSecrets(sec.secrets ?? []);
      setConnections(con.connections ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedSecrets = useMemo(
    () => [...secrets].sort((a, b) => a.username.localeCompare(b.username)),
    [secrets]
  );

  async function saveConfig() {
    setSavingConfig(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch("/api/pptp/config", {
        method: "PUT",
        body: JSON.stringify({
          ...config,
          // Server mode does not require a global login account.
          pptp_server_username: "",
          pptp_server_password: "",
        }),
      });
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      const next = (await res.json()) as { config: Partial<PptpConfig> };
      setConfig((prev) => ({
        ...prev,
        ...next.config,
        pptp_server_host: String(next.config.pptp_server_host ?? "").trim() || defaultServerHost,
        pptp_server_username: "",
        pptp_server_password: "",
      }));
      setMessage(t("settings.saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingConfig(false);
    }
  }

  async function createSecret() {
    if (!newSecret.username.trim() || !newSecret.password.trim()) return;
    setSavingSecret(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch("/api/pptp/secrets", {
        method: "POST",
        body: JSON.stringify(newSecret),
      });
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      setNewSecret({ username: "", password: "", static_ip: "", note: "", is_active: true });
      setMessage(t("common.success"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSecret(false);
    }
  }

  async function deleteSecret(id: string) {
    if (!window.confirm(t("users.deleteOneConfirm"))) return;
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/pptp/secrets/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      setMessage(t("common.success"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("nav.pptp")}</h1>
          <p className="text-sm opacity-70">{t("settings.pptpHint")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2", loading && "animate-spin")} />
          {t("common.refresh")}
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {message}
        </div>
      ) : null}

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Network className="h-4 w-4 text-sky-500" />
          {t("settings.pptpTitle")}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.pptp_vpn_enabled}
            onChange={(e) => setConfig((p) => ({ ...p, pptp_vpn_enabled: e.target.checked }))}
          />
          {t("settings.pptpEnabled")}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("settings.pptpHost")}
            value={config.pptp_server_host}
            onChange={(e) => setConfig((p) => ({ ...p, pptp_server_host: e.target.value }))}
            hint={t("settings.pptpHostHint")}
          />
          <TextField
            label={t("settings.pptpPort")}
            type="number"
            min={1}
            max={65535}
            value={String(config.pptp_server_port)}
            onChange={(e) =>
              setConfig((p) => ({
                ...p,
                pptp_server_port: Math.max(1, Math.min(65535, Number(e.target.value) || 1723)),
              }))
            }
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("settings.pptpLocalNetwork")}
            value={config.pptp_local_network_cidr}
            onChange={(e) => setConfig((p) => ({ ...p, pptp_local_network_cidr: e.target.value }))}
          />
          <TextField
            label={t("settings.pptpClientPool")}
            value={config.pptp_client_pool_cidr}
            onChange={(e) => setConfig((p) => ({ ...p, pptp_client_pool_cidr: e.target.value }))}
          />
        </div>
        <div>
          <Button type="button" onClick={() => void saveConfig()} disabled={savingConfig || loading}>
            <Save className="h-4 w-4" />
            {savingConfig ? t("common.loading") : t("common.save")}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <KeyRound className="h-4 w-4 text-violet-500" />
          {t("pptp.secretsTitle")}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <TextField
            label={t("users.username")}
            value={newSecret.username}
            onChange={(e) => setNewSecret((p) => ({ ...p, username: e.target.value }))}
          />
          <TextField
            label={t("settings.pptpPassword")}
            type="password"
            value={newSecret.password}
            onChange={(e) => setNewSecret((p) => ({ ...p, password: e.target.value }))}
          />
          <TextField
            label={t("users.ip")}
            value={newSecret.static_ip}
            onChange={(e) => setNewSecret((p) => ({ ...p, static_ip: e.target.value }))}
          />
          <TextField
            label={t("users.notes")}
            value={newSecret.note}
            onChange={(e) => setNewSecret((p) => ({ ...p, note: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={newSecret.is_active}
              onChange={(e) => setNewSecret((p) => ({ ...p, is_active: e.target.checked }))}
            />
            {t("users.status")}
          </label>
        </div>
        <Button
          type="button"
          onClick={() => void createSecret()}
          disabled={savingSecret || !newSecret.username.trim() || !newSecret.password.trim()}
        >
          <Plus className="h-4 w-4" />
          {savingSecret ? t("common.loading") : t("common.add")}
        </Button>
        <div className="overflow-x-auto rounded-2xl border border-[hsl(var(--border))]/60">
          <table className="min-w-full text-sm">
            <thead className="bg-[hsl(var(--muted))]/40">
              <tr className="text-start">
                <th className="px-3 py-2 text-start">{t("users.username")}</th>
                <th className="px-3 py-2 text-start">{t("settings.pptpPassword")}</th>
                <th className="px-3 py-2 text-start">{t("users.ip")}</th>
                <th className="px-3 py-2 text-start">{t("users.notes")}</th>
                <th className="px-3 py-2 text-start">{t("users.status")}</th>
                <th className="px-3 py-2 text-start">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedSecrets.length ? (
                sortedSecrets.map((s) => (
                  <tr key={s.id} className="border-t border-[hsl(var(--border))]/50">
                    <td className="px-3 py-2">{s.username}</td>
                    <td className="px-3 py-2 font-mono">{s.password || "—"}</td>
                    <td className="px-3 py-2 font-mono">{s.static_ip || "—"}</td>
                    <td className="px-3 py-2">{s.note || "—"}</td>
                    <td className="px-3 py-2">
                      {s.is_active ? (
                        <span className="text-emerald-600 dark:text-emerald-400">{t("common.yes")}</span>
                      ) : (
                        <span className="opacity-70">{t("common.no")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="rounded-lg p-2 text-red-500 hover:bg-red-500/10"
                        onClick={() => void deleteSecret(s.id)}
                        aria-label={t("common.delete")}
                        title={t("common.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-4 text-center opacity-70" colSpan={6}>
                    {t("pptp.noSecrets")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Link className="h-4 w-4 text-emerald-500" />
          {t("pptp.connectionsTitle")}
        </div>
        <div className="overflow-x-auto rounded-2xl border border-[hsl(var(--border))]/60">
          <table className="min-w-full text-sm">
            <thead className="bg-[hsl(var(--muted))]/40">
              <tr>
                <th className="px-3 py-2 text-start">{t("pptp.iface")}</th>
                <th className="px-3 py-2 text-start">{t("pptp.clientIp")}</th>
                <th className="px-3 py-2 text-start">{t("pptp.serverIp")}</th>
                <th className="px-3 py-2 text-start">{t("pptp.vpnIp")}</th>
                <th className="px-3 py-2 text-start">{t("users.username")}</th>
                <th className="px-3 py-2 text-start">{t("onlineUsers.started")}</th>
              </tr>
            </thead>
            <tbody>
              {connections.length ? (
                connections.map((c) => (
                  <tr key={c.id} className="border-t border-[hsl(var(--border))]/50">
                    <td className="px-3 py-2 font-mono">{c.interface_name || "—"}</td>
                    <td className="px-3 py-2 font-mono">{c.client_ip || "—"}</td>
                    <td className="px-3 py-2 font-mono">{c.server_ip || "—"}</td>
                    <td className="px-3 py-2 font-mono">{c.vpn_ip || "—"}</td>
                    <td className="px-3 py-2">{c.username || "—"}</td>
                    <td className="px-3 py-2">{c.connected_since || c.last_seen_at || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-4 text-center opacity-70" colSpan={6}>
                    {t("pptp.noConnections")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
