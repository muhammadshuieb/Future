import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, Save, Send, ShieldCheck } from "lucide-react";
import { Card } from "../components/ui/Card";
import { useTheme } from "../context/ThemeContext";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { useI18n } from "../context/LocaleContext";

type SystemSettings = {
  critical_alert_enabled: boolean;
  critical_alert_phone: string;
  critical_alert_use_session_owner: boolean;
  server_log_retention_days: number;
};

export function SettingsPage() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [settings, setSettings] = useState<SystemSettings>({
    critical_alert_enabled: false,
    critical_alert_phone: "",
    critical_alert_use_session_owner: true,
    server_log_retention_days: 14,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/system-settings");
      if (!res.ok) {
        const raw = await readApiError(res);
        setErr(formatStaffApiError(res.status, raw, t));
        return;
      }
      const j = (await res.json()) as { settings: SystemSettings };
      setSettings(j.settings);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await apiFetch("/api/system-settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const raw = await readApiError(res);
        setErr(formatStaffApiError(res.status, raw, t));
        return;
      }
      const j = (await res.json()) as { settings: SystemSettings };
      setSettings(j.settings);
      setMsg(t("settings.saved"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function sendTestAlert() {
    setErr(null);
    setMsg(null);
    try {
      const res = await apiFetch("/api/system-settings/test-alert", { method: "POST" });
      if (!res.ok) {
        const raw = await readApiError(res);
        setErr(formatStaffApiError(res.status, raw, t));
        return;
      }
      setMsg(t("settings.testAlertSent"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>

      {err ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {err}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {msg}
        </div>
      ) : null}

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4 text-indigo-500" />
              {t("settings.appearance")}
            </div>
            <div className="text-sm opacity-70">{t("settings.theme")}: {theme}</div>
          </div>
          <Button type="button" onClick={toggle}>
            {t("settings.toggleTheme")}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          {t("settings.serverLogs")}
        </div>
        <TextField
          label={t("settings.logRetentionDays")}
          type="number"
          min={3}
          max={90}
          value={String(settings.server_log_retention_days)}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              server_log_retention_days: Math.max(3, Math.min(90, Number(e.target.value) || 14)),
            }))
          }
          hint={t("settings.logRetentionHint")}
        />
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Bell className="h-4 w-4 text-green-500" />
          {t("settings.criticalAlerts")}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.critical_alert_enabled}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, critical_alert_enabled: e.target.checked }))
            }
          />
          {t("settings.enableCriticalAlerts")}
        </label>
        <TextField
          label={t("settings.alertPhone")}
          value={settings.critical_alert_phone}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              critical_alert_phone: e.target.value,
            }))
          }
          hint={t("settings.alertPhoneHint")}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.critical_alert_use_session_owner}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                critical_alert_use_session_owner: e.target.checked,
              }))
            }
          />
          {t("settings.useSessionOwner")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={saving || loading}>
            <Save className="h-4 w-4" />
            {saving ? t("common.loading") : t("common.save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            {t("common.refresh")}
          </Button>
          <Button type="button" variant="soft" onClick={sendTestAlert}>
            <Send className="h-4 w-4" />
            {t("settings.sendTestAlert")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
