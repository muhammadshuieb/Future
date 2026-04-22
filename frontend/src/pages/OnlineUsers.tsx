import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";

type OnlineSession = {
  radacctid: string;
  username: string;
  nasipaddress: string;
  framedipaddress: string;
  callingstationid: string;
  acctstarttime: string | null;
  duration_seconds: number;
  session_bytes: string;
};

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function formatBytes(value: string): string {
  const n = Number(value || "0");
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const x = n / Math.pow(1024, i);
  return `${x.toFixed(x >= 100 || i === 0 ? 0 : x >= 10 ? 1 : 2)} ${units[i]}`;
}

export function OnlineUsersPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canDisconnect = user?.role === "admin" || user?.role === "manager";
  const [items, setItems] = useState<OnlineSession[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("/api/online-users?limit=500");
      if (!r.ok) throw new Error(await readApiError(r));
      const data = (await r.json()) as { count: number; sessions: OnlineSession[] };
      setCount(Number(data.count ?? 0));
      setItems(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function disconnectSession(item: OnlineSession) {
    if (!canDisconnect) return;
    if (!confirm(`${t("onlineUsers.disconnectConfirm")} ${item.username}?`)) return;
    setDisconnectingId(item.radacctid);
    setError(null);
    try {
      const r = await apiFetch(`/api/online-users/${item.radacctid}/disconnect`, {
        method: "POST",
        body: "{}",
      });
      if (!r.ok) throw new Error(await readApiError(r));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDisconnectingId(null);
    }
  }

  const totalUsage = useMemo(
    () => items.reduce((acc, x) => acc + (Number(x.session_bytes || "0") || 0), 0),
    [items]
  );

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("onlineUsers.title")}</h1>
          <p className="text-sm opacity-70">{t("onlineUsers.subtitle")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""} ${isRtl ? "ms-2" : "me-2"}`} />
          {t("common.refresh")}
        </Button>
      </div>

      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-1">
          <div className="text-xs uppercase opacity-60">{t("onlineUsers.connectedCount")}</div>
          <div className="text-3xl font-bold">{count}</div>
        </Card>
        <Card className="space-y-1">
          <div className="text-xs uppercase opacity-60">{t("onlineUsers.totalUsage")}</div>
          <div className="text-3xl font-bold">{formatBytes(String(totalUsage))}</div>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
                <th className={`px-4 py-3 ${isRtl ? "text-right" : "text-left"}`}>{t("users.username")}</th>
                <th className={`px-4 py-3 ${isRtl ? "text-right" : "text-left"}`}>{t("onlineUsers.nas")}</th>
                <th className={`px-4 py-3 ${isRtl ? "text-right" : "text-left"}`}>{t("onlineUsers.ip")}</th>
                <th className={`px-4 py-3 ${isRtl ? "text-right" : "text-left"}`}>{t("onlineUsers.usage")}</th>
                <th className={`px-4 py-3 ${isRtl ? "text-right" : "text-left"}`}>{t("onlineUsers.duration")}</th>
                <th className={`px-4 py-3 ${isRtl ? "text-left" : "text-right"}`}>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.radacctid} className="border-b border-[hsl(var(--border))]/50">
                  <td className="px-4 py-3 font-medium">{item.username}</td>
                  <td className="px-4 py-3">{item.nasipaddress || "-"}</td>
                  <td className="px-4 py-3">{item.framedipaddress || "-"}</td>
                  <td className="px-4 py-3">{formatBytes(item.session_bytes)}</td>
                  <td className="px-4 py-3 font-mono">{formatDuration(item.duration_seconds)}</td>
                  <td className={`px-4 py-3 ${isRtl ? "text-left" : "text-right"}`}>
                    {canDisconnect ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="border-red-500/50 text-red-600"
                        onClick={() => void disconnectSession(item)}
                        disabled={disconnectingId === item.radacctid}
                      >
                        {disconnectingId === item.radacctid ? t("common.loading") : t("onlineUsers.disconnect")}
                      </Button>
                    ) : (
                      <span className="text-xs opacity-60">{t("api.error_403")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 && !loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm opacity-70">
            <WifiOff className="h-4 w-4" />
            {t("onlineUsers.empty")}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
