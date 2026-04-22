import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";

type LogItem = {
  id: string;
  phone: string;
  template_key: "new_account" | "expiry_soon" | "payment_due" | "usage_threshold" | "invoice_paid" | null;
  status: "sent" | "failed";
  error_message: string | null;
  created_at: string;
};

function fmt(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function WhatsAppLogsPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "manager";
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [typeSortDir, setTypeSortDir] = useState<"asc" | "desc">("asc");

  const failedCount = useMemo(() => logs.filter((x) => x.status === "failed").length, [logs]);
  const getMessageTypeLabel = useCallback(
    (key: LogItem["template_key"]) => {
      if (key === "new_account") return t("whatsapp.logType.new_account");
      if (key === "expiry_soon") return t("whatsapp.logType.expiry_soon");
      if (key === "payment_due") return t("whatsapp.logType.payment_due");
      if (key === "usage_threshold") return t("whatsapp.logType.usage_threshold");
      if (key === "invoice_paid") return t("whatsapp.logType.invoice_paid");
      return t("whatsapp.logType.general");
    },
    [t]
  );
  const sortedLogs = useMemo(() => {
    const arr = [...logs];
    arr.sort((a, b) => {
      const x = getMessageTypeLabel(a.template_key);
      const y = getMessageTypeLabel(b.template_key);
      const cmp = x.localeCompare(y, "ar");
      return typeSortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [getMessageTypeLabel, logs, typeSortDir]);

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/whatsapp/logs?limit=300");
      if (!res.ok) throw new Error(await readApiError(res));
      const json = (await res.json()) as { items: LogItem[] };
      setLogs(json.items);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resendFailed() {
    setWorking(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/whatsapp/logs/resend-failed?limit=200", {
        method: "POST",
        body: "{}",
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = (await res.json()) as { attempted: number; sent: number; failed: number };
      setInfo(`${t("whatsapp.sentNow")}: ${data.sent}/${data.attempted} (${data.failed} failed)`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  async function resendOne(id: string) {
    setWorking(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch(`/api/whatsapp/logs/${id}/resend`, { method: "POST", body: "{}" });
      if (!res.ok) throw new Error(await readApiError(res));
      setInfo(t("whatsapp.resent"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  async function deleteLogs(payload: { all?: boolean; failed_only?: boolean; ids?: string[] }) {
    setWorking(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/whatsapp/logs", {
        method: "DELETE",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      setInfo(t("common.success"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  if (!canManage) return <p className="text-sm opacity-70">{t("api.error_403")}</p>;

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("whatsapp.logsPage")}</h1>
          <p className="text-sm opacity-70">{t("whatsapp.logsPageHint")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading || working}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""} ${isRtl ? "ms-2" : "me-2"}`} />
          {t("common.refresh")}
        </Button>
      </div>

      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div> : null}
      {info ? <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{info}</div> : null}

      <Card className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => void resendFailed()} disabled={working || failedCount === 0}>
          <RotateCcw className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
          {t("whatsapp.resendFailed")}
        </Button>
        <Button type="button" variant="outline" onClick={() => void deleteLogs({ failed_only: true })} disabled={working || failedCount === 0}>
          <Trash2 className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
          {t("whatsapp.deleteFailed")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void deleteLogs({ ids: Array.from(selected) })}
          disabled={working || selected.size === 0}
        >
          <Trash2 className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
          {t("whatsapp.deleteSelected")}
        </Button>
        <Button type="button" variant="outline" onClick={() => void deleteLogs({ all: true })} disabled={working || logs.length === 0}>
          <Trash2 className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
          {t("whatsapp.deleteAll")}
        </Button>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={sortedLogs.length > 0 && selected.size === sortedLogs.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(sortedLogs.map((x) => x.id)) : new Set())}
                  />
                </th>
                <th className="px-4 py-3 text-left">{t("whatsapp.logStatus")}</th>
                <th className="px-4 py-3 text-left">{t("whatsapp.logPhone")}</th>
                <th className="px-4 py-3 text-left">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:opacity-80"
                    onClick={() => setTypeSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  >
                    {t("whatsapp.logMessageType")}
                    <span className="text-[10px] opacity-70">{typeSortDir === "asc" ? "▲" : "▼"}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-left">{t("whatsapp.logTime")}</th>
                <th className="px-4 py-3 text-left">{t("whatsapp.logError")}</th>
                <th className="px-4 py-3 text-right">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedLogs.map((l) => (
                <tr key={l.id} className="border-b border-[hsl(var(--border))]/50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(l.id);
                          else next.delete(l.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className={`px-4 py-3 font-semibold ${l.status === "sent" ? "text-emerald-400" : "text-red-400"}`}>{l.status}</td>
                  <td className="px-4 py-3">{l.phone}</td>
                  <td className="px-4 py-3">{getMessageTypeLabel(l.template_key)}</td>
                  <td className="px-4 py-3">{fmt(l.created_at)}</td>
                  <td className="max-w-xs truncate px-4 py-3">{l.error_message ?? "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded-lg p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
                      onClick={() => void resendOne(l.id)}
                      title={t("whatsapp.resend")}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
