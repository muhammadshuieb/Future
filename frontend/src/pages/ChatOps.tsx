import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { CHATOPS_PERMISSION_KEYS } from "../lib/permissions";

type ChatOpsSettings = {
  enabled: boolean;
  whatsapp_enabled: boolean;
  telegram_enabled: boolean;
  telegram_configured: boolean;
  allow_whatsapp_groups: boolean;
  allow_telegram_groups: boolean;
  commands_per_minute: number;
  failed_attempts_before_lockout: number;
  lockout_minutes: number;
  max_prepaid_cards_per_command: number;
  max_financial_amount_non_admin: number;
};

type Identity = {
  id: string;
  staff_user_id: string;
  staff_name: string;
  channel: "whatsapp" | "telegram";
  external_id: string;
  phone_number: string | null;
  display_name: string | null;
  is_active: boolean;
};

type StaffUser = { id: string; name: string; email: string };

export function ChatOpsPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canManage = isAdmin || user?.role === "manager";

  const [settings, setSettings] = useState<ChatOpsSettings | null>(null);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [pending, setPending] = useState<Record<string, unknown>[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");

  const [newIdentity, setNewIdentity] = useState({
    staff_user_id: "",
    channel: "whatsapp" as "whatsapp" | "telegram",
    external_id: "",
    phone_number: "",
    display_name: "",
  });

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [sRes, iRes, lRes, pRes, staffRes] = await Promise.all([
        apiFetch("/api/chatops/settings"),
        apiFetch("/api/chatops/identities"),
        apiFetch("/api/chatops/logs?limit=30"),
        apiFetch("/api/chatops/pending"),
        apiFetch("/api/staff"),
      ]);
      if (sRes.ok) {
        const j = (await sRes.json()) as { settings: ChatOpsSettings };
        setSettings(j.settings);
      }
      if (iRes.ok) {
        const j = (await iRes.json()) as { items: Identity[] };
        setIdentities(j.items);
      }
      if (lRes.ok) {
        const j = (await lRes.json()) as { items: Record<string, unknown>[] };
        setLogs(j.items);
      }
      if (pRes.ok) {
        const j = (await pRes.json()) as { items: Record<string, unknown>[] };
        setPending(j.items);
      }
      if (staffRes.ok) {
        const j = (await staffRes.json()) as { items?: StaffUser[] };
        setStaff(j.items ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async () => {
    if (!settings || !isAdmin) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/chatops/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          telegram_bot_token: telegramToken.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      setInfo(t("chatops.saved"));
      setTelegramToken("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const addIdentity = async () => {
    setError(null);
    try {
      const res = await apiFetch("/api/chatops/identities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newIdentity,
          phone_number: newIdentity.phone_number || null,
          display_name: newIdentity.display_name || null,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      setInfo(t("chatops.identityAdded"));
      setNewIdentity({
        staff_user_id: "",
        channel: "whatsapp",
        external_id: "",
        phone_number: "",
        display_name: "",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeIdentity = async (id: string) => {
    const res = await apiFetch(`/api/chatops/identities/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await readApiError(res));
      return;
    }
    await load();
  };

  if (!canManage) {
    return (
      <div className="p-6 text-sm opacity-70" dir={isRtl ? "rtl" : "ltr"}>
        {t("chatops.noAccess")}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t("chatops.title")}</h1>
          <p className="text-sm opacity-70">{t("chatops.subtitle")}</p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          {t("common.refresh")}
        </Button>
      </div>

      {error ? <div className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-600">{error}</div> : null}
      {info ? <div className="rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700">{info}</div> : null}

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">{t("chatops.settings")}</h2>
        {settings ? (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                disabled={!isAdmin}
              />
              {t("chatops.enabled")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.whatsapp_enabled}
                onChange={(e) => setSettings({ ...settings, whatsapp_enabled: e.target.checked })}
                disabled={!isAdmin}
              />
              {t("chatops.whatsappEnabled")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.telegram_enabled}
                onChange={(e) => setSettings({ ...settings, telegram_enabled: e.target.checked })}
                disabled={!isAdmin}
              />
              {t("chatops.telegramEnabled")}
            </label>
            <TextField
              label={t("chatops.telegramToken")}
              type="password"
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
              placeholder={settings.telegram_configured ? "••••••••" : ""}
              disabled={!isAdmin}
            />
            <TextField
              label={t("chatops.rateLimit")}
              type="number"
              value={String(settings.commands_per_minute)}
              onChange={(e) =>
                setSettings({ ...settings, commands_per_minute: parseInt(e.target.value, 10) || 20 })
              }
              disabled={!isAdmin}
            />
            <TextField
              label={t("chatops.maxPrepaid")}
              type="number"
              value={String(settings.max_prepaid_cards_per_command)}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  max_prepaid_cards_per_command: parseInt(e.target.value, 10) || 50,
                })
              }
              disabled={!isAdmin}
            />
            {isAdmin ? (
              <div className="md:col-span-2">
                <Button onClick={() => void saveSettings()} disabled={saving}>
                  <Save className="h-4 w-4" />
                  {t("common.save")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="mt-4 text-xs opacity-60">{t("chatops.webhookNote")}</p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">{t("chatops.linkManagers")}</h2>
        <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <select
            className="rounded-lg border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
            value={newIdentity.staff_user_id}
            onChange={(e) => setNewIdentity({ ...newIdentity, staff_user_id: e.target.value })}
          >
            <option value="">{t("chatops.selectStaff")}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.email})
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
            value={newIdentity.channel}
            onChange={(e) =>
              setNewIdentity({ ...newIdentity, channel: e.target.value as "whatsapp" | "telegram" })
            }
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
          </select>
          <TextField
            label={t("chatops.externalId")}
            value={newIdentity.external_id}
            onChange={(e) => setNewIdentity({ ...newIdentity, external_id: e.target.value })}
          />
          <TextField
            label={t("chatops.phone")}
            value={newIdentity.phone_number}
            onChange={(e) => setNewIdentity({ ...newIdentity, phone_number: e.target.value })}
          />
          <Button onClick={() => void addIdentity()} disabled={!newIdentity.staff_user_id || !newIdentity.external_id}>
            <Plus className="h-4 w-4" />
            {t("chatops.addLink")}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] text-start opacity-70">
                <th className="p-2">{t("chatops.staff")}</th>
                <th className="p-2">{t("chatops.channel")}</th>
                <th className="p-2">{t("chatops.externalId")}</th>
                <th className="p-2">{t("chatops.phone")}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {identities.map((row) => (
                <tr key={row.id} className="border-b border-[hsl(var(--border))]/50">
                  <td className="p-2">{row.staff_name}</td>
                  <td className="p-2">{row.channel}</td>
                  <td className="p-2 font-mono text-xs">{row.external_id}</td>
                  <td className="p-2">{row.phone_number ?? "—"}</td>
                  <td className="p-2">
                    <Button variant="ghost" size="sm" onClick={() => void removeIdentity(row.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">{t("chatops.permissions")}</h2>
        <ul className="grid gap-1 text-sm md:grid-cols-2">
          {CHATOPS_PERMISSION_KEYS.map((key) => (
            <li key={key} className="rounded-md bg-[hsl(var(--muted))]/30 px-2 py-1 font-mono text-xs">
              {key}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs opacity-60">{t("chatops.permissionsHint")}</p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">{t("chatops.commandLog")}</h2>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(logs, null, 2)}</pre>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">{t("chatops.pending")}</h2>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(pending, null, 2)}</pre>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">{t("chatops.examples")}</h2>
        <pre className="whitespace-pre-wrap text-sm leading-relaxed opacity-90">{t("chatops.examplesText")}</pre>
      </Card>
    </div>
  );
}
