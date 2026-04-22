import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { SelectField, TextAreaField, TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";

type Pkg = { id: string; name: string; mikrotik_rate_limit?: string | null };

export function WhatsAppBroadcastPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "manager";
  const [filterType, setFilterType] = useState<"all" | "speed" | "region">("all");
  const [speed, setSpeed] = useState("");
  const [region, setRegion] = useState("");
  const [message, setMessage] = useState("");
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const presetMessages = [
    {
      id: "maintenance",
      label: t("whatsapp.presetMaintenance"),
      text: t("whatsapp.presetMaintenanceText"),
    },
    {
      id: "renewal",
      label: t("whatsapp.presetRenewal"),
      text: t("whatsapp.presetRenewalText"),
    },
    {
      id: "outage",
      label: t("whatsapp.presetOutage"),
      text: t("whatsapp.presetOutageText"),
    },
  ];

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const pkgRes = await apiFetch("/api/packages/");
      if (pkgRes.ok) {
        const pj = (await pkgRes.json()) as { items: Pkg[] };
        setPackages(pj.items);
      }
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendBroadcast() {
    setSending(true);
    setError(null);
    setInfo(null);
    try {
      const r = await apiFetch("/api/whatsapp/broadcast/send", {
        method: "POST",
        body: JSON.stringify({
          filter_type: filterType,
          speed: filterType === "speed" ? speed : null,
          region: filterType === "region" ? region : null,
          message,
        }),
      });
      if (!r.ok) throw new Error(await readApiError(r));
      const j = (await r.json()) as { total: number; sent: number; failed: number };
      setInfo(`${t("whatsapp.sentNow")}: ${j.sent}/${j.total} (${j.failed} failed)`);
      setMessage("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  if (!canManage) return <p className="text-sm opacity-70">{t("api.error_403")}</p>;

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("whatsapp.broadcastPage")}</h1>
          <p className="text-sm opacity-70">{t("whatsapp.broadcastPageHint")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""} ${isRtl ? "ms-2" : "me-2"}`} />
          {t("common.refresh")}
        </Button>
      </div>

      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div> : null}
      {info ? <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{info}</div> : null}

      <Card className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">{t("whatsapp.presets")}</div>
          <div className="flex flex-wrap gap-2">
            {presetMessages.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                onClick={() => setMessage(preset.text)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
        <SelectField label={t("whatsapp.broadcastFilter")} value={filterType} onChange={(e) => setFilterType(e.target.value as "all" | "speed" | "region")}>
          <option value="all">{t("whatsapp.filterAll")}</option>
          <option value="speed">{t("whatsapp.filterSpeed")}</option>
          <option value="region">{t("whatsapp.filterRegion")}</option>
        </SelectField>
        {filterType === "speed" ? (
          <SelectField label={t("whatsapp.filterSpeed")} value={speed} onChange={(e) => setSpeed(e.target.value)}>
            <option value="">—</option>
            {packages.map((p) => (
              <option key={p.id} value={p.mikrotik_rate_limit ?? ""}>
                {p.name} ({p.mikrotik_rate_limit ?? "-"})
              </option>
            ))}
          </SelectField>
        ) : null}
        {filterType === "region" ? (
          <TextField label={t("whatsapp.filterRegion")} value={region} onChange={(e) => setRegion(e.target.value)} />
        ) : null}
        <TextAreaField label={t("whatsapp.broadcastMessage")} value={message} onChange={(e) => setMessage(e.target.value)} />
        <Button type="button" onClick={() => void sendBroadcast()} disabled={sending || !message.trim()}>
          <Send className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
          {sending ? t("common.loading") : t("whatsapp.broadcastSend")}
        </Button>
      </Card>

    </div>
  );
}
