import { useCallback, useEffect, useMemo, useState } from "react";
import { QrCode, RefreshCw, Save, Wifi } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { whatsAppEmojiPreviewSrc } from "../lib/whatsappEmoji";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextField } from "../components/ui/TextField";
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
  reminder_days: number;
  message_interval_seconds: number;
  auto_send_new: boolean;
  usage_alert_thresholds: number[];
  company_name: string;
  emoji_image_url: string;
  emoji_image_preview_url?: string;
  attach_emoji_image: boolean;
};

type QrResponse = {
  qr_data_url: string | null;
  connected: boolean;
  message: string | null;
};

export function WhatsAppConnectionPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "manager";
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<Settings>({
    enabled: false,
    reminder_days: 5,
    message_interval_seconds: 30,
    auto_send_new: true,
    usage_alert_thresholds: [10, 20, 30, 50],
    company_name: "",
    emoji_image_url: "",
    attach_emoji_image: false,
  });
  const [qr, setQr] = useState<QrResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingEmoji, setUploadingEmoji] = useState(false);
  const [testing, setTesting] = useState(false);
  const [autoConfiguring, setAutoConfiguring] = useState(false);

  const requiresAutoConfig = useCallback((cfg: Settings) => !cfg.enabled, []);

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const [statusRes, settingsRes] = await Promise.all([
        apiFetch("/api/whatsapp/status"),
        apiFetch("/api/whatsapp/settings"),
      ]);
      let currentStatus: Status | null = null;
      if (!statusRes.ok) {
        throw new Error(await readApiError(statusRes));
      }
      const s = (await statusRes.json()) as { status: Status };
      setStatus(s.status);
      currentStatus = s.status;

      if (settingsRes.ok) {
        const cfg = (await settingsRes.json()) as { settings: Settings };
        setSettings(cfg.settings);
        if (!autoConfiguring && requiresAutoConfig(cfg.settings)) {
          setAutoConfiguring(true);
          try {
            const payload: Settings = {
              ...cfg.settings,
              reminder_days: Math.max(1, Math.min(30, Number(cfg.settings.reminder_days || 5))),
              message_interval_seconds: Math.max(0, Math.min(300, Number(cfg.settings.message_interval_seconds || 30))),
              usage_alert_thresholds: Array.from(
                new Set((cfg.settings.usage_alert_thresholds ?? []).filter((x) => [10, 20, 30, 50].includes(Number(x))))
              ).sort((a, b) => a - b),
            };
            const saveRes = await apiFetch("/api/whatsapp/settings", {
              method: "PUT",
              body: JSON.stringify({
                ...payload,
                enabled: true,
                waha_url: "",
                session_name: "default",
                api_key: "",
              }),
            });
            if (saveRes.ok) {
              setSettings({ ...payload, enabled: true });
              await apiFetch("/api/whatsapp/test", { method: "POST", body: "{}" });
              const [statusAfter, qrAfter] = await Promise.all([apiFetch("/api/whatsapp/status"), apiFetch("/api/whatsapp/qr")]);
              if (statusAfter.ok) {
                const st = (await statusAfter.json()) as { status: Status };
                setStatus(st.status);
                currentStatus = st.status;
              }
              if (qrAfter.ok) {
                const q = (await qrAfter.json()) as { qr: QrResponse };
                setQr(q.qr);
              }
              setInfo(t("whatsapp.saved"));
            }
          } finally {
            setAutoConfiguring(false);
          }
        }
      }
      if (currentStatus?.connected) {
        setQr({ qr_data_url: null, connected: true, message: null });
      } else {
        const qrRes = await apiFetch("/api/whatsapp/qr");
        if (!qrRes.ok) {
          throw new Error(await readApiError(qrRes));
        }
        const q = (await qrRes.json()) as { qr: QrResponse };
        setQr(q.qr);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [autoConfiguring, canManage, requiresAutoConfig, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    if (status?.connected || qr?.connected) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const [statusRes, qrRes] = await Promise.all([
          apiFetch("/api/whatsapp/status"),
          apiFetch("/api/whatsapp/qr"),
        ]);
        if (statusRes.ok) {
          const data = (await statusRes.json()) as { status: Status };
          setStatus(data.status);
        }
        if (qrRes.ok) {
          const data = (await qrRes.json()) as { qr: QrResponse };
          setQr(data.qr);
        }
      })();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [canManage, qr?.connected, status?.connected]);

  const statusText = useMemo(() => {
    if (!status) return t("common.loading");
    if (!status.enabled) return t("dash.disabled");
    return status.connected ? t("dash.connected") : t("dash.disconnected");
  }, [status, t]);

  async function uploadEmojiImage(file: File) {
    setUploadingEmoji(true);
    setError(null);
    setInfo(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const r = await apiFetch("/api/whatsapp/emoji-image", { method: "POST", body: form });
      if (!r.ok) throw new Error(await readApiError(r));
      const data = (await r.json()) as { settings: Settings };
      setSettings(data.settings);
      setInfo(t("whatsapp.emojiUploaded"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingEmoji(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const r = await apiFetch("/api/whatsapp/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...settings,
          enabled: settings.enabled,
          waha_url: "",
          session_name: "default",
          api_key: "",
        }),
      });
      if (!r.ok) throw new Error(await readApiError(r));
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
      const data = (await r.json()) as { status: Status };
      setStatus(data.status);
      setInfo(data.status.connected ? t("whatsapp.connected") : t("whatsapp.disconnected"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  if (!canManage) return <p className="text-sm opacity-70">{t("api.error_403")}</p>;

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("whatsapp.connectionPage")}</h1>
          <p className="text-sm opacity-70">{t("whatsapp.connectionPageHint")}</p>
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
          <Button type="button" onClick={() => void saveSettings()} disabled={saving}>
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
          {t("whatsapp.status")}: <span className={status?.connected ? "text-emerald-400" : "text-amber-300"}>{statusText}</span>
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
        <div className="space-y-2">
          <div className="text-sm font-medium">{t("whatsapp.usageAlertThresholds")}</div>
          <div className="flex flex-wrap gap-3">
            {[10, 20, 30, 50].map((value) => {
              const checked = settings.usage_alert_thresholds.includes(value);
              return (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSettings((prev) => {
                        const next = e.target.checked
                          ? [...prev.usage_alert_thresholds, value]
                          : prev.usage_alert_thresholds.filter((x) => x !== value);
                        return {
                          ...prev,
                          usage_alert_thresholds: Array.from(new Set(next)).sort((a, b) => a - b),
                        };
                      })
                    }
                  />
                  {value}%
                </label>
              );
            })}
          </div>
        </div>
        <div className="space-y-3 border-t border-[hsl(var(--border))] pt-4">
          <div className="text-sm font-semibold">{t("whatsapp.templateOptions")}</div>
          <TextField
            label={t("whatsapp.companyName")}
            value={settings.company_name}
            onChange={(e) => setSettings((s) => ({ ...s, company_name: e.target.value }))}
            placeholder={t("whatsapp.companyNamePlaceholder")}
          />
          <div className="space-y-2">
            <label className="block text-sm font-medium">{t("whatsapp.emojiImageUpload")}</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={uploadingEmoji}
              className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-[hsl(var(--primary))] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[hsl(var(--primary-foreground))]"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadEmojiImage(file);
                e.target.value = "";
              }}
            />
            {uploadingEmoji ? <p className="text-xs opacity-60">{t("common.loading")}</p> : null}
            {whatsAppEmojiPreviewSrc(settings.emoji_image_preview_url, settings.emoji_image_url) ? (
              <img
                key={settings.emoji_image_url}
                src={whatsAppEmojiPreviewSrc(settings.emoji_image_preview_url, settings.emoji_image_url)}
                alt=""
                className="h-20 w-20 rounded-lg border border-[hsl(var(--border))] object-contain bg-white/5 p-1"
              />
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.attach_emoji_image}
              onChange={(e) => setSettings((s) => ({ ...s, attach_emoji_image: e.target.checked }))}
            />
            {t("whatsapp.attachEmojiImage")}
          </label>
          <p className="text-xs opacity-60">{t("whatsapp.emojiImageHint")}</p>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <QrCode className="h-4 w-4" />
          {t("whatsapp.qr")}
        </div>
        {status?.connected || qr?.connected ? (
          <div className="text-sm text-emerald-400">{t("whatsapp.connected")}</div>
        ) : qr?.qr_data_url ? (
          <img src={qr.qr_data_url} alt="WAHA QR" className="h-72 w-72 rounded-xl border border-[hsl(var(--border))] bg-white p-2" />
        ) : (
          <div className="space-y-2 text-sm opacity-70">
            <p>{t("whatsapp.qrWaiting")}</p>
            {qr?.message ? <p className="text-amber-300">{qr.message}</p> : null}
            {status?.last_error ? <p className="text-red-300">{status.last_error}</p> : null}
            {!settings.enabled ? <p className="text-amber-300">{t("whatsapp.enableForQr")}</p> : null}
          </div>
        )}
      </Card>
    </div>
  );
}
