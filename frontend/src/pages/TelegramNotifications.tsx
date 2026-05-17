import { useCallback, useEffect, useState } from "react";
import { Send, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
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
  last_test_ok: boolean | null;
  last_error: string | null;
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
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
        const j = (await r.json()) as { telegram?: TelegramConfig };
        if (j.telegram) {
          setTelegram(j.telegram);
          setChatId(j.telegram.chat_id ?? "");
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
      const body: { chat_id: string; bot_token?: string } = { chat_id: chatId.trim() };
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

          {message ? <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">{message}</p> : null}
          {error ? <p className="mt-3 text-xs text-red-500">{error}</p> : null}

          <div className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-4 text-xs opacity-85">
            <p className="font-semibold">{t("telegram.autoTitle")}</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>{t("telegram.auto1")}</li>
              <li>{t("telegram.auto2")}</li>
              <li>{t("telegram.auto3")}</li>
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}
