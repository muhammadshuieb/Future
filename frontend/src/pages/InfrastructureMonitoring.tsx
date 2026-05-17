import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Cpu,
  Gauge,
  RefreshCw,
  Server,
  Thermometer,
  Zap,
  CheckCircle2,
  Bell,
  Send,
} from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { cn } from "../lib/utils";
import { hasMonitoringPermission } from "../lib/permissions";
import { useAuth } from "../context/AuthContext";

type RouterRow = {
  nas_device_id: string;
  nas_name: string;
  nas_ip: string;
  health_status: string;
  cpu_percent: number | null;
  ram_percent: number | null;
  board_temperature_c: number | null;
  voltage_v: number | null;
  voltage_supported: boolean;
  uptime_seconds: number | null;
  ppp_active_sessions: number;
  last_sync_ok: boolean;
  last_sync_error: string | null;
};

type AlertRow = {
  id: string;
  alert_type: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  nas_name_resolved?: string;
  last_seen_at: string;
};

type TelegramConfig = {
  configured: boolean;
  chat_id: string | null;
  alerts_enabled: boolean;
  last_test_ok: boolean | null;
  last_error: string | null;
};

type Overview = {
  routers: RouterRow[];
  server: {
    health_status: string;
    ram_percent: number | null;
    disk_percent: number | null;
    cpu_load_1m: number | null;
  } | null;
  alerts: AlertRow[];
  summary: {
    routers_offline: number;
    critical_alerts: number;
    warning_alerts: number;
    high_cpu: number;
    high_temperature: number;
    low_voltage: number;
  };
};

function severityClass(sev: string): string {
  if (sev === "critical") return "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400";
  if (sev === "warning") return "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
}

function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function InfrastructureMonitoringPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = hasMonitoringPermission(user?.role, user?.permissions, "monitoring:manage");
  const canAck = hasMonitoringPermission(user?.role, user?.permissions, "monitoring:acknowledge_alerts");

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const [telegram, setTelegram] = useState<TelegramConfig | null>(null);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [tgSaving, setTgSaving] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);
  const [tgMessage, setTgMessage] = useState<string | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/infrastructure-monitoring/overview");
      if (r.ok) setData((await r.json()) as Overview);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTelegram = useCallback(async () => {
    if (!canManage) return;
    const r = await apiFetch("/api/infrastructure-monitoring/settings");
    if (!r.ok) return;
    const j = (await r.json()) as { telegram?: TelegramConfig };
    if (j.telegram) {
      setTelegram(j.telegram);
      setChatId(j.telegram.chat_id ?? "");
    }
  }, [canManage]);

  useEffect(() => {
    void load();
    void loadTelegram();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load, loadTelegram]);

  async function runCycle() {
    setRunning(true);
    try {
      await apiFetch("/api/infrastructure-monitoring/run-cycle", { method: "POST" });
      await load();
    } finally {
      setRunning(false);
    }
  }

  async function acknowledge(id: string) {
    await apiFetch(`/api/infrastructure-monitoring/alerts/${id}/acknowledge`, { method: "POST" });
    await load();
  }

  async function saveTelegram() {
    setTgSaving(true);
    setTgMessage(null);
    setTgError(null);
    try {
      const body: { chat_id: string; bot_token?: string } = { chat_id: chatId.trim() };
      if (botToken.trim()) body.bot_token = botToken.trim();
      else if (!telegram?.configured) {
        setTgError(t("monitoring.telegramBotToken"));
        return;
      }
      const r = await apiFetch("/api/infrastructure-monitoring/telegram", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const raw = await readApiError(r);
        setTgError(formatStaffApiError(r.status, raw, t));
        return;
      }
      const j = (await r.json()) as { telegram: TelegramConfig };
      setTelegram(j.telegram);
      setBotToken("");
      setTgMessage(t("monitoring.telegramConfigured"));
    } catch (e) {
      setTgError(e instanceof Error ? e.message : String(e));
    } finally {
      setTgSaving(false);
    }
  }

  async function testTelegram() {
    setTgTesting(true);
    setTgMessage(null);
    setTgError(null);
    try {
      const r = await apiFetch("/api/infrastructure-monitoring/telegram/test", { method: "POST" });
      const j = (await r.json()) as { ok?: boolean; telegram?: TelegramConfig; error?: string };
      if (j.telegram) setTelegram(j.telegram);
      if (r.ok && j.ok) {
        setTgMessage(t("monitoring.telegramTestOk"));
      } else {
        setTgError(j.error ?? j.telegram?.last_error ?? t("monitoring.telegramTestFail"));
      }
    } catch (e) {
      setTgError(e instanceof Error ? e.message : String(e));
    } finally {
      setTgTesting(false);
    }
  }

  const summary = data?.summary;

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("monitoring.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("monitoring.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t("common.refresh")}
          </Button>
          {canManage ? (
            <Button type="button" onClick={() => void runCycle()} disabled={running}>
              {running ? t("common.loading") : t("monitoring.runCycle")}
            </Button>
          ) : null}
        </div>
      </div>

      {canManage ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Send className="h-4 w-4 text-[hsl(var(--primary))]" />
            {t("monitoring.telegramTitle")}
          </div>
          <p className="mt-2 text-xs opacity-70">{t("monitoring.telegramHint")}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <TextField
              label={t("monitoring.telegramBotToken")}
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={telegram?.configured ? t("monitoring.tokenKeepBlank") : "123456:ABC..."}
              autoComplete="off"
            />
            <TextField
              label={t("monitoring.telegramChatId")}
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-1001234567890"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void saveTelegram()} disabled={tgSaving || !chatId.trim()}>
              {tgSaving ? t("common.loading") : t("monitoring.telegramSave")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void testTelegram()}
              disabled={tgTesting || !telegram?.configured}
            >
              {tgTesting ? t("common.loading") : t("monitoring.telegramTest")}
            </Button>
            {telegram?.configured ? (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">{t("monitoring.telegramConfigured")}</span>
            ) : (
              <span className="text-xs opacity-60">{t("monitoring.telegramNotConfigured")}</span>
            )}
          </div>
          {tgMessage ? <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{tgMessage}</p> : null}
          {tgError ? <p className="mt-2 text-xs text-red-500">{tgError}</p> : null}
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          { label: t("monitoring.offlineRouters"), value: summary?.routers_offline ?? 0, icon: Server, tone: "text-red-500" },
          { label: t("monitoring.criticalAlerts"), value: summary?.critical_alerts ?? 0, icon: AlertTriangle, tone: "text-red-500" },
          { label: t("monitoring.warningAlerts"), value: summary?.warning_alerts ?? 0, icon: Bell, tone: "text-amber-500" },
          { label: t("monitoring.highCpu"), value: summary?.high_cpu ?? 0, icon: Cpu, tone: "text-orange-500" },
          { label: t("monitoring.highTemp"), value: summary?.high_temperature ?? 0, icon: Thermometer, tone: "text-rose-500" },
          { label: t("monitoring.lowVoltage"), value: summary?.low_voltage ?? 0, icon: Zap, tone: "text-violet-500" },
        ].map((item) => (
          <Card key={item.label} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs opacity-70">{item.label}</span>
              <item.icon className={cn("h-4 w-4", item.tone)} />
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{item.value}</div>
          </Card>
        ))}
      </div>

      {data?.server ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="h-4 w-4 text-[hsl(var(--primary))]" />
            {t("monitoring.serverHealth")}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs opacity-85">
            <span>
              {t("monitoring.status")}: <strong>{data.server.health_status}</strong>
            </span>
            <span>CPU load: {data.server.cpu_load_1m ?? "—"}</span>
            <span>RAM: {data.server.ram_percent != null ? `${data.server.ram_percent}%` : "—"}</span>
            <span>
              {t("monitoring.disk")}: {data.server.disk_percent != null ? `${data.server.disk_percent}%` : "—"}
            </span>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4" />
            {t("monitoring.routers")}
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {(data?.routers ?? []).map((r) => (
              <div
                key={r.nas_device_id}
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  r.last_sync_ok ? "border-emerald-500/30" : "border-red-500/40 bg-red-500/5"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.nas_name}</span>
                  <span className="font-mono opacity-70">{r.nas_ip}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 opacity-80">
                  <span>
                    {t("monitoring.uptime")} {formatUptime(r.uptime_seconds)}
                  </span>
                  <span>CPU {r.cpu_percent ?? "—"}%</span>
                  <span>RAM {r.ram_percent ?? "—"}%</span>
                  <span>
                    {t("monitoring.temp")}{" "}
                    {r.board_temperature_c != null ? `${r.board_temperature_c}°C` : "—"}
                  </span>
                  <span>
                    {t("monitoring.voltage")}{" "}
                    {!r.voltage_supported
                      ? t("monitoring.voltageUnsupported")
                      : r.voltage_v != null
                        ? `${r.voltage_v}V`
                        : "—"}
                  </span>
                  <span>PPP {r.ppp_active_sessions}</span>
                </div>
                {!r.last_sync_ok && r.last_sync_error ? (
                  <p className="mt-1 text-red-500">{r.last_sync_error}</p>
                ) : null}
              </div>
            ))}
            {!loading && (data?.routers?.length ?? 0) === 0 ? (
              <p className="text-sm opacity-60">{t("monitoring.noRouters")}</p>
            ) : null}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4" />
            {t("monitoring.latestAlerts")}
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {(data?.alerts ?? []).map((a) => (
              <div key={a.id} className={cn("rounded-lg border px-3 py-2 text-xs", severityClass(a.severity))}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{a.title}</div>
                    <p className="mt-0.5 opacity-90">{a.message}</p>
                    <p className="mt-1 opacity-60">
                      {a.nas_name_resolved ?? "—"} · {a.alert_type} · {a.status}
                    </p>
                  </div>
                  {canAck && a.status === "firing" ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0 px-2 py-1 text-[10px]"
                      onClick={() => void acknowledge(a.id)}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {t("monitoring.ack")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            {!loading && (data?.alerts?.length ?? 0) === 0 ? (
              <p className="text-sm opacity-60">{t("monitoring.noAlerts")}</p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
