import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, Save, Send, Wifi } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextAreaField, TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";

type Status = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  reminder_days: number;
  message_interval_seconds: number;
  auto_send_new: boolean;
  usage_alert_thresholds: number[];
  last_error: string | null;
  last_check_at: string | null;
};

type Settings = {
  enabled: boolean;
  waha_url: string;
  session_name: string;
  api_key: string;
  reminder_days: number;
  message_interval_seconds: number;
  auto_send_new: boolean;
  usage_alert_thresholds: number[];
};

type Template = {
  template_key: "new_account" | "expiry_soon" | "payment_due" | "usage_threshold";
  body: string;
  updated_at: string | null;
};

type LogItem = {
  id: string;
  subscriber_id: string | null;
  phone: string;
  template_key: "new_account" | "expiry_soon" | null;
  message_body: string;
  status: "sent" | "failed";
  provider_message_id: string | null;
  error_message: string | null;
  retry_of: string | null;
  created_at: string;
  sent_at: string | null;
};

function fmt(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function WhatsAppPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<Settings>({
    enabled: false,
    waha_url: "",
    session_name: "",
    api_key: "",
    reminder_days: 5,
    message_interval_seconds: 30,
    auto_send_new: true,
    usage_alert_thresholds: [10, 20, 30, 50],
  });
  const [templates, setTemplates] = useState<Record<Template["template_key"], string>>({
    new_account: "",
    expiry_soon: "",
    payment_due: "",
    usage_threshold: "",
  });
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);

  const canManage = user?.role === "admin" || user?.role === "manager";

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const [statusRes, settingsRes, templatesRes, logsRes] = await Promise.all([
        apiFetch("/api/whatsapp/status"),
        apiFetch("/api/whatsapp/settings"),
        apiFetch("/api/whatsapp/templates"),
        apiFetch("/api/whatsapp/logs?limit=150"),
      ]);
      if (!statusRes.ok) throw new Error(await readApiError(statusRes));
      if (!settingsRes.ok) throw new Error(await readApiError(settingsRes));
      if (!templatesRes.ok) throw new Error(await readApiError(templatesRes));
      if (!logsRes.ok) throw new Error(await readApiError(logsRes));

      const s = (await statusRes.json()) as { status: Status };
      const cfg = (await settingsRes.json()) as { settings: Settings };
      const tpl = (await templatesRes.json()) as { items: Template[] };
      const lg = (await logsRes.json()) as { items: LogItem[] };
      setStatus(s.status);
      setSettings(cfg.settings);
      setLogs(lg.items);
      setTemplates({
        new_account: tpl.items.find((x) => x.template_key === "new_account")?.body ?? "",
        expiry_soon: tpl.items.find((x) => x.template_key === "expiry_soon")?.body ?? "",
        payment_due: tpl.items.find((x) => x.template_key === "payment_due")?.body ?? "",
        usage_threshold: tpl.items.find((x) => x.template_key === "usage_threshold")?.body ?? "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusText = useMemo(() => {
    if (!status) return t("common.loading");
    if (!status.enabled) return t("dash.disabled");
    if (status.connected) return t("dash.connected");
    return t("dash.disconnected");
  }, [status, t]);

  async function saveSettingsAndTemplates() {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const saveRes = await apiFetch("/api/whatsapp/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      if (!saveRes.ok) throw new Error(await readApiError(saveRes));

      const [tpl1, tpl2, tpl3, tpl4] = await Promise.all([
        apiFetch("/api/whatsapp/templates/new_account", {
          method: "PUT",
          body: JSON.stringify({ body: templates.new_account }),
        }),
        apiFetch("/api/whatsapp/templates/expiry_soon", {
          method: "PUT",
          body: JSON.stringify({ body: templates.expiry_soon }),
        }),
        apiFetch("/api/whatsapp/templates/payment_due", {
          method: "PUT",
          body: JSON.stringify({ body: templates.payment_due }),
        }),
        apiFetch("/api/whatsapp/templates/usage_threshold", {
          method: "PUT",
          body: JSON.stringify({ body: templates.usage_threshold }),
        }),
      ]);
      if (!tpl1.ok) throw new Error(await readApiError(tpl1));
      if (!tpl2.ok) throw new Error(await readApiError(tpl2));
      if (!tpl3.ok) throw new Error(await readApiError(tpl3));
      if (!tpl4.ok) throw new Error(await readApiError(tpl4));
      setInfo(t("whatsapp.saved"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setInfo(null);
    try {
      const r = await apiFetch("/api/whatsapp/test", { method: "POST", body: "{}" });
      if (!r.ok) throw new Error(await readApiError(r));
      const json = (await r.json()) as { status: Status };
      setStatus(json.status);
      setInfo(json.status.connected ? t("whatsapp.connected") : t("whatsapp.disconnected"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  async function sendExpiryNow() {
    setSendingNow(true);
    setError(null);
    setInfo(null);
    try {
      const r = await apiFetch("/api/whatsapp/send-expiry-now", { method: "POST", body: "{}" });
      if (!r.ok) throw new Error(await readApiError(r));
      const j = (await r.json()) as { sent: number; failed: number };
      setInfo(`${t("whatsapp.sentNow")}: ${j.sent} / ${j.failed}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSendingNow(false);
    }
  }

  async function resend(id: string) {
    setError(null);
    setInfo(null);
    const r = await apiFetch(`/api/whatsapp/logs/${id}/resend`, { method: "POST", body: "{}" });
    if (!r.ok) {
      setError(await readApiError(r));
      return;
    }
    setInfo(t("whatsapp.resent"));
    await load();
  }

  if (!canManage) return <p className="text-sm opacity-70">{t("api.error_403")}</p>;

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("whatsapp.title")}</h1>
          <p className="text-sm opacity-70">{t("whatsapp.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""} ${isRtl ? "ms-2" : "me-2"}`} />
            {t("common.refresh")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void testConnection()} disabled={testing}>
            <Wifi className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
            {testing ? t("common.loading") : t("whatsapp.test")}
          </Button>
          <Button type="button" onClick={() => void saveSettingsAndTemplates()} disabled={saving}>
            <Save className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
            {saving ? t("common.loading") : t("common.save")}
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div> : null}
      {info ? <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{info}</div> : null}

      <Card className="space-y-3">
        <div className="font-semibold">{t("whatsapp.connection")}</div>
        <div className="text-sm">
          {t("whatsapp.status")}:{" "}
          <span className={status?.connected ? "text-emerald-400" : "text-amber-300"}>{statusText}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
            />
            {t("whatsapp.enabled")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.auto_send_new}
              onChange={(e) => setSettings((s) => ({ ...s, auto_send_new: e.target.checked }))}
            />
            {t("whatsapp.autoNew")}
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("whatsapp.wahaUrl")}
            value={settings.waha_url}
            onChange={(e) => setSettings((s) => ({ ...s, waha_url: e.target.value }))}
          />
          <TextField
            label={t("whatsapp.session")}
            value={settings.session_name}
            onChange={(e) => setSettings((s) => ({ ...s, session_name: e.target.value }))}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("whatsapp.apiKey")}
            value={settings.api_key}
            onChange={(e) => setSettings((s) => ({ ...s, api_key: e.target.value }))}
          />
          <TextField
            type="number"
            min={1}
            max={30}
            label={t("whatsapp.reminderDays")}
            value={String(settings.reminder_days)}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                reminder_days: Math.max(1, Math.min(30, Number.parseInt(e.target.value || "5", 10))),
              }))
            }
          />
          <TextField
            type="number"
            min={0}
            max={300}
            label={t("whatsapp.intervalSeconds")}
            value={String(settings.message_interval_seconds)}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                message_interval_seconds: Math.max(0, Math.min(300, Number.parseInt(e.target.value || "30", 10))),
              }))
            }
          />
        </div>
        <div className="pt-2">
          <Button type="button" variant="outline" onClick={() => void sendExpiryNow()} disabled={sendingNow}>
            <Send className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
            {sendingNow ? t("common.loading") : t("whatsapp.sendExpiryNow")}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="font-semibold">{t("whatsapp.templates")}</div>
        <TextAreaField
          label={t("whatsapp.templateNew")}
          value={templates.new_account}
          onChange={(e) => setTemplates((x) => ({ ...x, new_account: e.target.value }))}
        />
        <TextAreaField
          label={t("whatsapp.templateExpiry")}
          value={templates.expiry_soon}
          onChange={(e) => setTemplates((x) => ({ ...x, expiry_soon: e.target.value }))}
        />
        <TextAreaField
          label={t("whatsapp.templatePaymentDue")}
          value={templates.payment_due}
          onChange={(e) => setTemplates((x) => ({ ...x, payment_due: e.target.value }))}
        />
        <TextAreaField
          label={t("whatsapp.templateUsageThreshold")}
          value={templates.usage_threshold}
          onChange={(e) => setTemplates((x) => ({ ...x, usage_threshold: e.target.value }))}
        />
        <div className="text-xs opacity-70">
          {t("whatsapp.templateVars")}:{" "}
          <code>
            {"{{full_name}}, {{username}}, {{password}}, {{package_name}}, {{speed}}, {{expiration_date}}, {{days_left}}, {{due_amount}}, {{currency}}, {{unpaid_count}}, {{oldest_due_date}}, {{usage_percent}}, {{used_gb}}, {{quota_gb}}, {{remaining_percent}}"}
          </code>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
                <th className="px-4 py-3 text-left">{t("whatsapp.logStatus")}</th>
                <th className="px-4 py-3 text-left">{t("whatsapp.logPhone")}</th>
                <th className="px-4 py-3 text-left">{t("whatsapp.logTemplate")}</th>
                <th className="px-4 py-3 text-left">{t("whatsapp.logTime")}</th>
                <th className="px-4 py-3 text-left">{t("whatsapp.logError")}</th>
                <th className="px-4 py-3 text-right">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-[hsl(var(--border))]/50">
                  <td className={`px-4 py-3 font-semibold ${l.status === "sent" ? "text-emerald-400" : "text-red-400"}`}>
                    {l.status}
                  </td>
                  <td className="px-4 py-3">{l.phone}</td>
                  <td className="px-4 py-3">{l.template_key ?? "-"}</td>
                  <td className="px-4 py-3">{fmt(l.created_at)}</td>
                  <td className="max-w-xs truncate px-4 py-3">{l.error_message ?? "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded-lg p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
                      onClick={() => void resend(l.id)}
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
