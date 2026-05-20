import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, Database, Radio, Save, Send, ShieldCheck, Trash2 } from "lucide-react";
import { Card } from "../components/ui/Card";
import { useTheme } from "../context/ThemeContext";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { useI18n } from "../context/LocaleContext";
import { COMMON_APP_TIMEZONES } from "../lib/app-timezones";

type SystemSettings = {
  critical_alert_enabled: boolean;
  critical_alert_phone: string;
  critical_alert_use_session_owner: boolean;
  backup_alert_enabled: boolean;
  backup_alert_phone: string;
  backup_alert_use_session_owner: boolean;
  server_log_retention_days: number;
  radpostauth_retention_enabled: boolean;
  radpostauth_retention_months: number;
  user_idle_timeout_minutes: number;
  admin_session_timeout_minutes: number;
  mikrotik_interim_update_minutes: number;
  disconnect_on_activation: boolean;
  disconnect_on_update: boolean;
  billing_currency: "USD" | "SYP" | "TRY";
  app_timezone: string;
  subscription_license_note: string;
  accountant_contact_phone: string;
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
    backup_alert_enabled: false,
    backup_alert_phone: "",
    backup_alert_use_session_owner: true,
    server_log_retention_days: 5,
    radpostauth_retention_enabled: true,
    radpostauth_retention_months: 2,
    user_idle_timeout_minutes: 4,
    admin_session_timeout_minutes: 5,
    mikrotik_interim_update_minutes: 1,
    disconnect_on_activation: true,
    disconnect_on_update: true,
    billing_currency: "USD",
    app_timezone: "Asia/Riyadh",
    subscription_license_note: "",
    accountant_contact_phone: "",
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
      const j = (await res.json()) as { settings: Partial<SystemSettings> };
      setSettings((prev) => ({ ...prev, ...j.settings }));
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
      const j = (await res.json()) as { settings: Partial<SystemSettings> };
      setSettings((prev) => ({ ...prev, ...j.settings }));
      setMsg(t("settings.saved"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runRadpostauthPrune() {
    setErr(null);
    setMsg(null);
    try {
      const res = await apiFetch("/api/system-settings/radpostauth-prune", { method: "POST" });
      if (!res.ok) {
        const raw = await readApiError(res);
        setErr(formatStaffApiError(res.status, raw, t));
        return;
      }
      const j = (await res.json()) as { deleted?: number; cutoff?: string | null; ran?: boolean };
      const deleted = Number(j.deleted ?? 0);
      const cutoff = j.cutoff ?? "—";
      setMsg(
        t("settings.radpostauthPruneDone")
          .replace("{deleted}", String(deleted))
          .replace("{cutoff}", String(cutoff))
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
              server_log_retention_days: Math.max(3, Math.min(90, Number(e.target.value) || 5)),
            }))
          }
          hint={t("settings.logRetentionHint")}
        />
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Database className="h-4 w-4 text-rose-500" />
          {t("settings.radpostauthRetention")}
        </div>
        <p className="whitespace-pre-wrap text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
          {t("settings.radpostauthRetentionIntro")}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.radpostauth_retention_enabled}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, radpostauth_retention_enabled: e.target.checked }))
            }
          />
          {t("settings.radpostauthRetentionEnabled")}
        </label>
        <TextField
          label={t("settings.radpostauthRetentionMonths")}
          type="number"
          min={1}
          max={36}
          value={String(settings.radpostauth_retention_months)}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              radpostauth_retention_months: Math.max(1, Math.min(36, Number(e.target.value) || 2)),
            }))
          }
          hint={t("settings.radpostauthRetentionMonthsHint")}
          disabled={!settings.radpostauth_retention_enabled}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={saving || loading}>
            <Save className="h-4 w-4" />
            {saving ? t("common.loading") : t("common.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={runRadpostauthPrune}
            disabled={!settings.radpostauth_retention_enabled || saving || loading}
          >
            <Trash2 className="h-4 w-4" />
            {t("settings.radpostauthPruneNow")}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-violet-500" />
          {t("settings.security")}
        </div>
        <label className="text-sm font-medium">{t("settings.adminSessionTimeout")}</label>
        <select
          className="w-full max-w-xs rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2.5 text-sm"
          value={String(settings.admin_session_timeout_minutes ?? 5)}
          onChange={(e) =>
            setSettings((p) => ({
              ...p,
              admin_session_timeout_minutes: Number(e.target.value) || 5,
            }))
          }
        >
          {[5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} {t("settings.minutesUnit")}
            </option>
          ))}
        </select>
        <p className="text-[11px] opacity-60">{t("settings.adminSessionTimeoutHint")}</p>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-sky-500" />
          {t("settings.timezone")}
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">{t("settings.timezoneHint")}</p>
        <label className="text-sm font-medium">{t("settings.timezoneLabel")}</label>
        <select
          className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2.5 text-sm"
          value={settings.app_timezone || "Asia/Riyadh"}
          onChange={(e) => setSettings((p) => ({ ...p, app_timezone: e.target.value }))}
        >
          {COMMON_APP_TIMEZONES.map((tz) => (
            <option key={tz.id} value={tz.id}>
              {tz.offsetLabel} — {tz.id}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={saving || loading}>
            <Save className="h-4 w-4" />
            {saving ? t("common.loading") : t("common.save")}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Radio className="h-4 w-4 text-cyan-500" />
          {t("settings.radiusPolicy")}
        </div>
        <p className="whitespace-pre-wrap text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
          {t("settings.radiusPolicyIntro")}
        </p>
        <TextField
          label={t("settings.userIdleTimeout")}
          type="number"
          min={2}
          max={10080}
          value={String(settings.user_idle_timeout_minutes)}
          onChange={(e) =>
            setSettings((p) => ({
              ...p,
              user_idle_timeout_minutes: Math.max(2, Math.min(10080, Number(e.target.value) || 4)),
            }))
          }
          hint={t("settings.userIdleTimeoutHint")}
        />
        <TextField
          label={t("settings.mikrotikInterim")}
          type="number"
          min={1}
          max={60}
          value={String(settings.mikrotik_interim_update_minutes)}
          onChange={(e) =>
            setSettings((p) => ({
              ...p,
              mikrotik_interim_update_minutes: Math.max(1, Math.min(60, Number(e.target.value) || 1)),
            }))
          }
          hint={t("settings.mikrotikInterimHint")}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.disconnect_on_activation}
            onChange={(e) => setSettings((p) => ({ ...p, disconnect_on_activation: e.target.checked }))}
          />
          {t("settings.disconnectOnActivation")}
        </label>
        <p className="text-[11px] opacity-60">{t("settings.disconnectOnActivationHint")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.disconnect_on_update}
            onChange={(e) => setSettings((p) => ({ ...p, disconnect_on_update: e.target.checked }))}
          />
          {t("settings.disconnectOnUpdate")}
        </label>
        <p className="text-[11px] opacity-60">{t("settings.disconnectOnUpdateHint")}</p>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("settings.billingCurrency")}</label>
          <select
            className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
            value={settings.billing_currency}
            onChange={(e) =>
              setSettings((p) => ({
                ...p,
                billing_currency: (["USD", "SYP", "TRY"].includes(e.target.value) ? e.target.value : "USD") as
                  | "USD"
                  | "SYP"
                  | "TRY",
              }))
            }
          >
            <option value="USD">{t("currency.usd")}</option>
            <option value="SYP">{t("currency.syp")}</option>
            <option value="TRY">{t("currency.try")}</option>
          </select>
          <p className="text-[11px] opacity-60">{t("settings.billingCurrencyHint")}</p>
        </div>
        <TextField
          label={t("settings.licenseNote")}
          value={settings.subscription_license_note}
          onChange={(e) =>
            setSettings((p) => ({ ...p, subscription_license_note: e.target.value }))
          }
          hint={t("settings.licenseNoteHint")}
        />
        <TextField
          label={t("settings.accountantPhone")}
          value={settings.accountant_contact_phone}
          onChange={(e) =>
            setSettings((p) => ({ ...p, accountant_contact_phone: e.target.value }))
          }
          hint={t("settings.accountantPhoneHint")}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={saving || loading}>
            <Save className="h-4 w-4" />
            {saving ? t("common.loading") : t("common.save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            {t("common.refresh")}
          </Button>
        </div>
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

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Bell className="h-4 w-4 text-violet-500" />
          {t("settings.backupAlerts")}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.backup_alert_enabled}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, backup_alert_enabled: e.target.checked }))
            }
          />
          {t("settings.enableBackupAlerts")}
        </label>
        <TextField
          label={t("settings.backupAlertPhone")}
          value={settings.backup_alert_phone}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              backup_alert_phone: e.target.value,
            }))
          }
          hint={t("settings.backupAlertPhoneHint")}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.backup_alert_use_session_owner}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                backup_alert_use_session_owner: e.target.checked,
              }))
            }
          />
          {t("settings.backupUseSessionOwner")}
        </label>
        <p className="text-[11px] opacity-60">{t("settings.backupAlertsHint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={saving || loading}>
            <Save className="h-4 w-4" />
            {saving ? t("common.loading") : t("common.save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            {t("common.refresh")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
