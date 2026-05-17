import { useCallback, useEffect, useState } from "react";
import { Send, RefreshCw, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { cn } from "../lib/utils";
import { hasMonitoringPermission } from "../lib/permissions";
import { useAuth } from "../context/AuthContext";

type TelegramConfig = {
  configured: boolean;
  chat_id: string | null;
  alerts_enabled: boolean;
  status_reports_enabled: boolean;
  status_interval_minutes: number;
  last_status_report_at: string | null;
  last_test_ok: boolean | null;
  last_error: string | null;
};

type AlertThresholds = {
  voltage_v_min: number | null;
  cpu_percent_max: number;
  ram_percent_max: number;
  disk_percent_max: number;
};

export function TelegramNotificationsPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage =
    user?.role === "admin" ||
    user?.role === "manager" ||
    hasMonitoringPermission(user?.role, user?.permissions, "monitoring:manage");

  const [telegram, setTelegram] = useState<TelegramConfig | null>(null);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [statusReportsEnabled, setStatusReportsEnabled] = useState(true);
  const [statusIntervalMinutes, setStatusIntervalMinutes] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [voltageMin, setVoltageMin] = useState("11.5");
  const [cpuMax, setCpuMax] = useState("90");
  const [ramMax, setRamMax] = useState("90");
  const [diskMax, setDiskMax] = useState("90");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await apiFetch("/api/infrastructure-monitoring/settings");
      if (r.ok) {
        const j = (await r.json()) as { telegram?: TelegramConfig; thresholds?: AlertThresholds };
        if (j.telegram) {
          setTelegram(j.telegram);
          setChatId(j.telegram.chat_id ?? "");
          setStatusReportsEnabled(j.telegram.status_reports_enabled ?? true);
          setStatusIntervalMinutes(j.telegram.status_interval_minutes ?? 5);
        }
        if (j.thresholds) {
          setVoltageMin(
            j.thresholds.voltage_v_min != null ? String(j.thresholds.voltage_v_min) : "11.5"
          );
          setCpuMax(String(j.thresholds.cpu_percent_max ?? 90));
          setRamMax(String(j.thresholds.ram_percent_max ?? 90));
          setDiskMax(String(j.thresholds.disk_percent_max ?? 90));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const body: {
        chat_id: string;
        bot_token?: string;
        status_reports_enabled: boolean;
        status_interval_minutes: number;
      } = {
        chat_id: chatId.trim(),
        status_reports_enabled: statusReportsEnabled,
        status_interval_minutes: Math.max(1, Math.min(1440, statusIntervalMinutes)),
      };
      if (botToken.trim()) body.bot_token = botToken.trim();
      else if (!telegram?.configured) {
        setError(t("telegram.botTokenRequired"));
        return;
      }
      const r = await apiFetch("/api/infrastructure-monitoring/telegram", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const raw = await readApiError(r);
        setError(formatStaffApiError(r.status, raw, t));
        return;
      }
      const j = (await r.json()) as { telegram: TelegramConfig };
      setTelegram(j.telegram);
      setBotToken("");
      setMessage(t("telegram.saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMessage(null);
    setError(null);
    try {
      const r = await apiFetch("/api/infrastructure-monitoring/telegram/test", { method: "POST" });
      const j = (await r.json()) as { ok?: boolean; telegram?: TelegramConfig; error?: string };
      if (j.telegram) setTelegram(j.telegram);
      if (r.ok && j.ok) {
        setMessage(t("telegram.testOk"));
      } else {
        setError(j.error ?? j.telegram?.last_error ?? t("telegram.testFail"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  async function saveThresholds() {
    setSavingThresholds(true);
    setMessage(null);
    setError(null);
    const v = parseFloat(voltageMin.replace(",", "."));
    const cpu = parseInt(cpuMax, 10);
    const ram = parseInt(ramMax, 10);
    const disk = parseInt(diskMax, 10);
    if (!Number.isFinite(v) || v <= 0 || v > 48) {
      setError(t("telegram.thresholdVoltage"));
      setSavingThresholds(false);
      return;
    }
    if (!Number.isFinite(cpu) || cpu < 1 || cpu > 100) {
      setError(t("telegram.thresholdCpu"));
      setSavingThresholds(false);
      return;
    }
    try {
      const r = await apiFetch("/api/infrastructure-monitoring/thresholds/global", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voltage_v_min: v,
          cpu_percent_max: cpu,
          ram_percent_max: Number.isFinite(ram) ? ram : 90,
          disk_percent_max: Number.isFinite(disk) ? disk : 90,
        }),
      });
      if (!r.ok) {
        const raw = await readApiError(r);
        setError(formatStaffApiError(r.status, raw, t));
        return;
      }
      setMessage(t("telegram.thresholdsSaved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingThresholds(false);
    }
  }

  async function sendStatusNow() {
    setSendingReport(true);
    setMessage(null);
    setError(null);
    try {
      const r = await apiFetch("/api/infrastructure-monitoring/telegram/send-status-now", {
        method: "POST",
      });
      const j = (await r.json()) as {
        ok?: boolean;
        telegram?: TelegramConfig;
        error?: string;
        detail?: string;
      };
      if (j.telegram) setTelegram(j.telegram);
      if (r.ok && j.ok) {
        setMessage(t("telegram.statusSent"));
      } else {
        const code = j.error ?? "";
        const detail = j.detail ?? "";
        if (code === "telegram_not_configured") {
          setError(`${t("telegram.errNotConfigured")}${detail ? ` — ${detail}` : ""}`);
        } else if (code === "telegram_send_failed") {
          setError(`${t("telegram.errSendFailed")}${detail ? `: ${detail}` : ""}`);
        } else {
          setError(detail || t("telegram.statusSendFail"));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSendingReport(false);
    }
  }

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("telegram.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("telegram.subtitle")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          {t("common.refresh")}
        </Button>
      </div>

      {!canManage ? (
        <Card className="p-4 text-sm opacity-70">{t("common.error")}</Card>
      ) : (
        <>
          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Send className="h-4 w-4 text-sky-500" />
              {t("telegram.setupTitle")}
            </div>
            <p className="mt-2 text-xs opacity-70">{t("telegram.hint")}</p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <TextField
                label={t("telegram.botToken")}
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={telegram?.configured ? t("telegram.tokenKeepBlank") : "123456:ABC..."}
                autoComplete="off"
              />
              <TextField
                label={t("telegram.chatId")}
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="-1001234567890"
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void save()} disabled={saving || !chatId.trim()}>
                {saving ? t("common.loading") : t("telegram.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void test()}
                disabled={testing || !telegram?.configured}
              >
                {testing ? t("common.loading") : t("telegram.test")}
              </Button>
              {telegram?.configured ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("telegram.active")}
                </span>
              ) : null}
              {telegram?.last_test_ok === false ? (
                <span className="inline-flex items-center gap-1 text-xs text-red-500">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {telegram.last_error ?? t("telegram.testFail")}
                </span>
              ) : null}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              {t("telegram.instantAlertsTitle")}
            </div>
            <p className="mt-2 text-xs opacity-70">{t("telegram.instantAlertsHint")}</p>

            <p className="mt-4 text-xs font-semibold opacity-90">{t("telegram.thresholdsTitle")}</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <TextField
                label={t("telegram.thresholdVoltage")}
                type="number"
                step="0.1"
                min={0.1}
                max={48}
                value={voltageMin}
                onChange={(e) => setVoltageMin(e.target.value)}
                hint={t("telegram.thresholdVoltageHint")}
              />
              <TextField
                label={t("telegram.thresholdCpu")}
                type="number"
                min={1}
                max={100}
                value={cpuMax}
                onChange={(e) => setCpuMax(e.target.value)}
                hint={t("telegram.thresholdCpuHint")}
              />
              <TextField
                label={t("telegram.thresholdRam")}
                type="number"
                min={1}
                max={100}
                value={ramMax}
                onChange={(e) => setRamMax(e.target.value)}
                hint={t("telegram.thresholdRamHint")}
              />
              <TextField
                label={t("telegram.thresholdDisk")}
                type="number"
                min={1}
                max={100}
                value={diskMax}
                onChange={(e) => setDiskMax(e.target.value)}
                hint={t("telegram.thresholdDiskHint")}
              />
            </div>

            <div className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => void saveThresholds()}
                disabled={savingThresholds}
              >
                {savingThresholds ? t("common.loading") : t("telegram.saveThresholds")}
              </Button>
            </div>

            <ul className="mt-4 list-inside list-disc space-y-1 text-xs opacity-80">
              <li>{t("telegram.alertVoltage")}</li>
              <li>{t("telegram.alertRouterCpu")}</li>
              <li>{t("telegram.alertRouterRam")}</li>
              <li>{t("telegram.alertServerDisk")}</li>
              <li>{t("telegram.alertServerRam")}</li>
              <li>{t("telegram.alertServerCpu")}</li>
            </ul>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-sky-500" />
              {t("telegram.statusReportsTitle")}
            </div>
            <p className="mt-2 text-xs opacity-70">{t("telegram.statusReportsHint")}</p>

            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={statusReportsEnabled}
                onChange={(e) => setStatusReportsEnabled(e.target.checked)}
                className="rounded border-[hsl(var(--border))]"
              />
              {t("telegram.statusReportsEnabled")}
            </label>

            <div className="mt-4 max-w-xs">
              <TextField
                label={t("telegram.statusIntervalMinutes")}
                type="number"
                min={1}
                max={1440}
                value={String(statusIntervalMinutes)}
                onChange={(e) => setStatusIntervalMinutes(Number(e.target.value) || 5)}
              />
              <p className="mt-1 text-[10px] opacity-60">{t("telegram.statusIntervalHelp")}</p>
            </div>

            {telegram?.last_status_report_at ? (
              <p className="mt-2 text-xs opacity-60">
                {t("telegram.lastStatusReport")}:{" "}
                {new Date(telegram.last_status_report_at).toLocaleString(isRtl ? "ar-SY" : "en")}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void save()} disabled={saving}>
                {t("telegram.saveInterval")}
              </Button>
              <Button
                type="button"
                onClick={() => void sendStatusNow()}
                disabled={sendingReport || !telegram?.configured || !statusReportsEnabled}
              >
                {sendingReport ? t("common.loading") : t("telegram.sendStatusNow")}
              </Button>
            </div>

            <ul className="mt-4 list-inside list-disc space-y-1 text-xs opacity-80">
              <li>{t("telegram.reportField1")}</li>
              <li>{t("telegram.reportField2")}</li>
              <li>{t("telegram.reportField3")}</li>
            </ul>
            <p className="mt-4 text-xs opacity-70">
              {t("telegram.nasSettingsHint")}{" "}
              <Link to="/nas" className="font-medium text-sky-600 underline dark:text-sky-400">
                {t("telegram.goNas")}
              </Link>
            </p>
          </Card>

          {message ? <p className="text-xs text-emerald-600 dark:text-emerald-400">{message}</p> : null}
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </>
      )}
    </div>
  );
}
