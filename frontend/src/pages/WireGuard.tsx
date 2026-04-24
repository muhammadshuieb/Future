import { useCallback, useEffect, useState } from "react";
import { Copy, Download, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { cn } from "../lib/utils";

type WireGuardConfig = {
  wireguard_vpn_enabled: boolean;
  wireguard_server_host: string;
  wireguard_server_port: number;
  wireguard_interface_cidr: string;
  wireguard_client_dns: string;
  wireguard_persistent_keepalive: number;
  wireguard_server_public_key: string;
  wireguard_server_private_key_set?: boolean;
};

type WireGuardPeer = {
  id: string;
  username: string;
  public_key: string;
  tunnel_ip: string;
  allowed_ips: string;
  is_active: boolean;
  note: string;
  updated_at?: string | null;
};

const defaultServerHost =
  typeof window !== "undefined" ? window.location.hostname.replace(/^\[|\]$/g, "") : "";

export function WireGuardPage() {
  const { t, isRtl } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [peers, setPeers] = useState<WireGuardPeer[]>([]);
  const [config, setConfig] = useState<WireGuardConfig>({
    wireguard_vpn_enabled: true,
    wireguard_server_host: defaultServerHost,
    wireguard_server_port: 51820,
    wireguard_interface_cidr: "10.20.0.1/24",
    wireguard_client_dns: "1.1.1.1,8.8.8.8",
    wireguard_persistent_keepalive: 25,
    wireguard_server_public_key: "",
    wireguard_server_private_key_set: false,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [tunnelIp, setTunnelIp] = useState("");
  const [clientConfig, setClientConfig] = useState<{ username: string; config: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [cfgRes, peerRes] = await Promise.all([
        apiFetch("/api/wireguard/config"),
        apiFetch("/api/wireguard/peers"),
      ]);
      if (!cfgRes.ok) {
        setErr(formatStaffApiError(cfgRes.status, await readApiError(cfgRes), t));
        return;
      }
      if (!peerRes.ok) {
        setErr(formatStaffApiError(peerRes.status, await readApiError(peerRes), t));
        return;
      }
      const cfg = (await cfgRes.json()) as { config: Partial<WireGuardConfig> };
      const peerJson = (await peerRes.json()) as { peers: WireGuardPeer[] };
      setConfig((prev) => ({
        ...prev,
        ...cfg.config,
        wireguard_server_host:
          String(cfg.config.wireguard_server_host ?? "").trim() || defaultServerHost,
      }));
      setPeers(peerJson.peers ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveConfig() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await apiFetch("/api/wireguard/config", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        setErr(formatStaffApiError(res.status, await readApiError(res), t));
        return;
      }
      const next = (await res.json()) as { config: Partial<WireGuardConfig> };
      setConfig((prev) => ({ ...prev, ...next.config }));
      setMsg(t("wireguard.saved"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function createPeer(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/wireguard/peers", {
        method: "POST",
        body: JSON.stringify({
          username,
          tunnel_ip: tunnelIp || undefined,
          is_active: true,
        }),
      });
      if (!res.ok) {
        setErr(formatStaffApiError(res.status, await readApiError(res), t));
        return;
      }
      setModalOpen(false);
      setUsername("");
      setTunnelIp("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deletePeer(id: string) {
    if (!window.confirm(t("wireguard.deleteConfirm"))) return;
    const res = await apiFetch(`/api/wireguard/peers/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  async function showClientConfig(peer: WireGuardPeer) {
    const res = await apiFetch(`/api/wireguard/peers/${peer.id}/config`);
    if (!res.ok) {
      setErr(formatStaffApiError(res.status, await readApiError(res), t));
      return;
    }
    setClientConfig((await res.json()) as { username: string; config: string });
  }

  async function downloadMikroTikConfig(peer: WireGuardPeer) {
    const res = await apiFetch(`/api/wireguard/peers/${peer.id}/mikrotik`);
    if (!res.ok) {
      setErr(formatStaffApiError(res.status, await readApiError(res), t));
      return;
    }
    const j = (await res.json()) as { filename: string; script: string };
    const blob = new Blob([j.script], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = j.filename || `${peer.username}-wireguard.rsc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copyClientConfig() {
    if (!clientConfig) return;
    await navigator.clipboard.writeText(clientConfig.config);
    setMsg(t("wireguard.copied"));
  }

  return (
    <div className="space-y-6">
      {err ? (
        <div className="whitespace-pre-wrap rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {err}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {msg}
        </div>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("nav.wireguard")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("wireguard.hint")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2", loading && "animate-spin")} />
          {t("common.refresh")}
        </Button>
      </div>

      <Card className="space-y-4">
        <div className="font-semibold">{t("wireguard.serverTitle")}</div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.wireguard_vpn_enabled}
            onChange={(e) => setConfig((p) => ({ ...p, wireguard_vpn_enabled: e.target.checked }))}
          />
          {t("wireguard.enabled")}
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t("wireguard.host")}
            value={config.wireguard_server_host}
            onChange={(e) => setConfig((p) => ({ ...p, wireguard_server_host: e.target.value }))}
          />
          <TextField
            label={t("wireguard.port")}
            type="number"
            value={String(config.wireguard_server_port)}
            onChange={(e) =>
              setConfig((p) => ({
                ...p,
                wireguard_server_port: Math.max(1, Math.min(65535, Number(e.target.value) || 51820)),
              }))
            }
          />
          <TextField
            label={t("wireguard.interfaceCidr")}
            value={config.wireguard_interface_cidr}
            onChange={(e) => setConfig((p) => ({ ...p, wireguard_interface_cidr: e.target.value }))}
            hint="10.20.0.1/24"
          />
          <TextField
            label={t("wireguard.dns")}
            value={config.wireguard_client_dns}
            onChange={(e) => setConfig((p) => ({ ...p, wireguard_client_dns: e.target.value }))}
          />
          <TextField
            label={t("wireguard.keepalive")}
            type="number"
            value={String(config.wireguard_persistent_keepalive)}
            onChange={(e) =>
              setConfig((p) => ({
                ...p,
                wireguard_persistent_keepalive: Math.max(0, Math.min(300, Number(e.target.value) || 25)),
              }))
            }
          />
          <TextField
            label={t("wireguard.publicKey")}
            value={config.wireguard_server_public_key || t("common.loading")}
            readOnly
          />
        </div>
        <Button type="button" onClick={saveConfig} disabled={saving || loading}>
          {saving ? t("common.loading") : t("common.save")}
        </Button>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold">{t("wireguard.peersTitle")}</div>
          <Button type="button" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("wireguard.addPeer")}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs opacity-70">
              <tr>
                <th className="px-3 py-2 text-start">{t("users.username")}</th>
                <th className="px-3 py-2 text-start">{t("wireguard.tunnelIp")}</th>
                <th className="px-3 py-2 text-start">{t("wireguard.allowedIps")}</th>
                <th className="px-3 py-2 text-start">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {peers.map((peer) => (
                <tr key={peer.id} className="border-t border-[hsl(var(--border))]/60">
                  <td className="px-3 py-2 font-medium">{peer.username}</td>
                  <td className="px-3 py-2 font-mono">{peer.tunnel_ip}</td>
                  <td className="px-3 py-2 font-mono">{peer.allowed_ips || config.wireguard_interface_cidr}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => void showClientConfig(peer)}>
                        {t("wireguard.showConfig")}
                      </Button>
                      <Button type="button" variant="soft" onClick={() => void downloadMikroTikConfig(peer)}>
                        <Download className="h-4 w-4" />
                        {t("wireguard.downloadMikrotik")}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => void deletePeer(peer.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {peers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm opacity-60">
                    {t("wireguard.noPeers")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t("wireguard.addPeer")}>
        <form onSubmit={createPeer} className="space-y-4">
          <p className="text-xs leading-relaxed opacity-70">{t("wireguard.addPeerHint")}</p>
          <TextField label={t("wireguard.deviceName")} value={username} onChange={(e) => setUsername(e.target.value)} required />
          <TextField
            label={t("wireguard.staticIp")}
            value={tunnelIp}
            onChange={(e) => setTunnelIp(e.target.value)}
            hint={t("wireguard.staticIpHint")}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={saving || !username.trim()}>{saving ? t("common.loading") : t("common.save")}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={clientConfig !== null} onClose={() => setClientConfig(null)} title={clientConfig?.username ?? ""} wide>
        <div className="space-y-3">
          <textarea
            className="min-h-80 w-full rounded-xl border border-[hsl(var(--border))] bg-transparent p-3 font-mono text-xs"
            value={clientConfig?.config ?? ""}
            readOnly
          />
          <Button type="button" onClick={() => void copyClientConfig()}>
            <Copy className="h-4 w-4" />
            {t("wireguard.copyConfig")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
