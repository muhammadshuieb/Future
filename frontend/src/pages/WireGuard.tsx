import { useCallback, useEffect, useState } from "react";
import { Copy, Download, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ActionDialog } from "../components/ui/ActionDialog";
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
  connection?: {
    status: "connected" | "waiting" | "unknown";
    latest_handshake_at: string | null;
    latest_handshake_seconds_ago: number | null;
    endpoint: string | null;
    rx_bytes: number;
    tx_bytes: number;
  };
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
  const [deletePeerId, setDeletePeerId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [tunnelIp, setTunnelIp] = useState("");
  const [clientConfig, setClientConfig] = useState<{ username: string; config: string } | null>(null);
  const [mikrotikCommands, setMikrotikCommands] = useState<{
    username: string;
    interfaceName?: string;
    wireguard_conf: string;
    commands: string;
  } | null>(null);
  const [configModalNote, setConfigModalNote] = useState<string | null>(null);
  const [mikrotikModalNote, setMikrotikModalNote] = useState<string | null>(null);

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
    setDeletePeerId(id);
  }

  async function confirmDeletePeer() {
    const id = deletePeerId;
    setDeletePeerId(null);
    if (!id) return;
    const res = await apiFetch(`/api/wireguard/peers/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  async function showClientConfig(peer: WireGuardPeer) {
    setConfigModalNote(null);
    const res = await apiFetch(`/api/wireguard/peers/${peer.id}/config`);
    if (!res.ok) {
      setErr(formatStaffApiError(res.status, await readApiError(res), t));
      return;
    }
    setClientConfig((await res.json()) as { username: string; config: string });
  }

  async function downloadClientConfFile(peer: WireGuardPeer) {
    setErr(null);
    const res = await apiFetch(`/api/wireguard/peers/${peer.id}/config`);
    if (!res.ok) {
      setErr(formatStaffApiError(res.status, await readApiError(res), t));
      return;
    }
    const data = (await res.json()) as { username: string; config: string };
    const safe =
      String(data.username || peer.username)
        .replace(/[^\w.\-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "wireguard-peer";
    const blob = new Blob([data.config], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function showMikroTikCommands(peer: WireGuardPeer) {
    setMikrotikModalNote(null);
    const res = await apiFetch(`/api/wireguard/peers/${peer.id}/mikrotik-commands`);
    if (!res.ok) {
      setErr(formatStaffApiError(res.status, await readApiError(res), t));
      return;
    }
    const data = (await res.json()) as {
      username: string;
      interfaceName?: string;
      wireguard_conf?: string;
      commands: string;
    };
    setMikrotikCommands({
      username: data.username,
      interfaceName: data.interfaceName,
      wireguard_conf: data.wireguard_conf ?? "",
      commands: data.commands,
    });
  }

  async function copyClientConfig() {
    if (!clientConfig) return;
    await copyText(clientConfig.config, { flash: "config" });
  }

  async function copyMikroTikCommands() {
    if (!mikrotikCommands) return;
    await copyText(mikrotikCommands.commands, { flash: "mikrotik" });
  }

  async function copyWireGuardConfFile() {
    if (!mikrotikCommands?.wireguard_conf) return;
    await copyText(mikrotikCommands.wireguard_conf, { flash: "mikrotik" });
  }

  function downloadWireGuardConf() {
    if (!mikrotikCommands?.wireguard_conf) return;
    const raw = mikrotikCommands.interfaceName || mikrotikCommands.username || "wireguard-peer";
    const safe = String(raw).replace(/[^\w.\-]+/g, "-").replace(/^-+|-+$/g, "") || "wireguard-peer";
    const blob = new Blob([mikrotikCommands.wireguard_conf], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(text: string, options?: { flash: "page" | "config" | "mikrotik" }) {
    setErr(null);
    const where = options?.flash ?? "page";
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      const line = t("wireguard.copied");
      if (where === "page") {
        setConfigModalNote(null);
        setMikrotikModalNote(null);
        setMsg(line);
      } else if (where === "config") {
        setMsg(null);
        setMikrotikModalNote(null);
        setConfigModalNote(line);
        window.setTimeout(() => setConfigModalNote((cur) => (cur === line ? null : cur)), 2200);
      } else {
        setMsg(null);
        setConfigModalNote(null);
        setMikrotikModalNote(line);
        window.setTimeout(() => setMikrotikModalNote((cur) => (cur === line ? null : cur)), 2200);
      }
    } catch {
      setErr(t("wireguard.copyFailed"));
    }
  }

  const defaultClientAllowedIps = config.wireguard_interface_cidr.replace(/(\.\d+)(\/\d+)$/, ".0$2");

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
                <th className="px-3 py-2 text-start">{t("wireguard.status")}</th>
                <th className="px-3 py-2 text-start">{t("wireguard.allowedIps")}</th>
                <th className="px-3 py-2 text-start">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {peers.map((peer) => (
                <tr key={peer.id} className="border-t border-[hsl(var(--border))]/60">
                  <td className="px-3 py-2 font-medium">{peer.username}</td>
                  <td className="px-3 py-2 font-mono">{peer.tunnel_ip}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <span
                        className={cn(
                          "inline-flex w-fit rounded-full px-2 py-1 text-xs font-medium",
                          peer.connection?.status === "connected"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : peer.connection?.status === "waiting"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : "bg-slate-500/10 text-slate-600 dark:text-slate-300"
                        )}
                      >
                        {t(`wireguard.status.${peer.connection?.status ?? "unknown"}`)}
                      </span>
                      {peer.connection?.latest_handshake_seconds_ago !== null &&
                      peer.connection?.latest_handshake_seconds_ago !== undefined ? (
                        <span className="text-xs opacity-60">
                          {t("wireguard.lastHandshake")}: {peer.connection.latest_handshake_seconds_ago}s
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono">{peer.allowed_ips?.trim() || defaultClientAllowedIps}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => void showClientConfig(peer)}>
                        {t("wireguard.showConfig")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void downloadClientConfFile(peer)}
                        title={t("wireguard.downloadConf")}
                      >
                        <Download className="h-4 w-4" />
                        {t("wireguard.downloadConf")}
                      </Button>
                      <Button type="button" variant="soft" onClick={() => void showMikroTikCommands(peer)}>
                        <Copy className="h-4 w-4" />
                        {t("wireguard.mikrotikCommands")}
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
                  <td colSpan={5} className="px-3 py-8 text-center text-sm opacity-60">
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

      <Modal
        open={clientConfig !== null}
        onClose={() => {
          setClientConfig(null);
          setConfigModalNote(null);
        }}
        title={clientConfig?.username ?? ""}
        wide
      >
        <div className="space-y-3">
          {configModalNote ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
              {configModalNote}
            </div>
          ) : null}
          <textarea
            className="min-h-80 w-full rounded-xl border border-[hsl(var(--border))] bg-transparent p-3 font-mono text-left text-xs"
            dir="ltr"
            value={clientConfig?.config ?? ""}
            readOnly
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void copyClientConfig()}>
              <Copy className="h-4 w-4" />
              {t("wireguard.copyConfig")}
            </Button>
            {clientConfig ? (
              <Button
                type="button"
                variant="soft"
                onClick={() => {
                  if (!clientConfig) return;
                  const safe =
                    String(clientConfig.username)
                      .replace(/[^\w.\-]+/g, "-")
                      .replace(/^-+|-+$/g, "") || "wireguard-peer";
                  const blob = new Blob([clientConfig.config], { type: "text/plain;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${safe}.conf`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="h-4 w-4" />
                {t("wireguard.downloadConf")}
              </Button>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        open={mikrotikCommands !== null}
        onClose={() => {
          setMikrotikCommands(null);
          setMikrotikModalNote(null);
        }}
        title={
          mikrotikCommands
            ? `${mikrotikCommands.username} — ${t("wireguard.mikrotikCommands")}`
            : ""
        }
        wide
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed opacity-70">{t("wireguard.mikrotikCommandsHint")}</p>
          {mikrotikModalNote ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
              {mikrotikModalNote}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-sm font-semibold">{t("wireguard.confFileSection")}</div>
            <p className="text-xs opacity-70">{t("wireguard.confFileHint")}</p>
            <textarea
              className="min-h-48 w-full rounded-xl border border-[hsl(var(--border))] bg-transparent p-3 font-mono text-left text-xs"
              dir="ltr"
              value={mikrotikCommands?.wireguard_conf ?? ""}
              readOnly
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copyWireGuardConfFile()} disabled={!mikrotikCommands?.wireguard_conf}>
                <Copy className="h-4 w-4" />
                {t("wireguard.copyConfFile")}
              </Button>
              <Button type="button" variant="soft" onClick={() => downloadWireGuardConf()} disabled={!mikrotikCommands?.wireguard_conf}>
                <Download className="h-4 w-4" />
                {t("wireguard.downloadConf")}
              </Button>
            </div>
          </div>

          <div className="space-y-2 border-t border-[hsl(var(--border))]/60 pt-4">
            <div className="text-sm font-semibold">{t("wireguard.terminalSection")}</div>
            <textarea
              className="min-h-56 w-full rounded-xl border border-[hsl(var(--border))] bg-transparent p-3 font-mono text-left text-xs"
              dir="ltr"
              value={mikrotikCommands?.commands ?? ""}
              readOnly
            />
            <Button type="button" onClick={() => void copyMikroTikCommands()}>
              <Copy className="h-4 w-4" />
              {t("wireguard.copyTerminal")}
            </Button>
          </div>
        </div>
      </Modal>
      <ActionDialog
        open={Boolean(deletePeerId)}
        title={t("common.delete")}
        message={t("wireguard.deleteConfirm")}
        variant="danger"
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onClose={() => setDeletePeerId(null)}
        onConfirm={() => {
          void confirmDeletePeer();
        }}
      />
    </div>
  );
}
