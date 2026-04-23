import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Phone, RefreshCw, AlertCircle, Building2, Gauge, Calendar, HardDrive, BarChart3 } from "lucide-react";
import { userApiFetch } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useI18n } from "../context/LocaleContext";
import { TextField } from "../components/ui/TextField";

type PublicData = {
  subscriber: {
    username: string;
    status: string;
    start_date: unknown;
    expiration_date: unknown;
    package_name: string;
    speed: string;
    remaining_bytes: string | null;
    is_limited_quota: boolean;
  };
  usage: {
    daily: { total_bytes: string; download_bytes: string; upload_bytes: string };
    monthly: { total_bytes: string; download_bytes: string; upload_bytes: string };
    yearly: { total_bytes: string; download_bytes: string; upload_bytes: string };
  };
  accountant_phone: string;
  license_note: string;
};

function formatBytes(n: string): string {
  const v = BigInt(n || "0");
  if (v <= 0n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let x = Number(v);
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : x >= 10 ? 1 : 2)} ${units[i]}`;
}

function fmtDate(v: unknown): string {
  if (v == null) return "—";
  const s = String(v);
  if (!s) return "—";
  return s.slice(0, 10);
}

export function SubscriberPublicPortalPage() {
  const { t, isRtl } = useI18n();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<PublicData | null>(null);
  const [globalHint, setGlobalHint] = useState<{ accountant_phone: string; license_note: string } | null>(null);

  const loadHint = useCallback(async () => {
    try {
      const r = await userApiFetch("/api/user/public-config");
      if (r.ok) {
        setGlobalHint((await r.json()) as { accountant_phone: string; license_note: string });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadHint();
  }, [loadHint]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setData(null);
    if (!phone.trim()) return;
    setLoading(true);
    try {
      const r = await userApiFetch("/api/user/public-lookup", {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const j = (await r.json()) as { error?: string; subscriber?: PublicData["subscriber"] } & Partial<PublicData>;
      if (!r.ok) {
        if (j.error === "not_found") setErr(t("publicPortal.notFound"));
        else if (j.error === "ambiguous_phone") setErr(t("publicPortal.ambiguous"));
        else setErr(t("publicPortal.lookupError"));
        return;
      }
      setData(j as PublicData);
    } catch {
      setErr(t("publicPortal.lookupError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="relative min-h-screen overflow-x-hidden bg-gradient-to-b from-teal-950/20 via-[hsl(var(--background))] to-[hsl(var(--background))] px-4 py-8 pb-16"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 end-0 h-80 w-80 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="absolute bottom-0 start-0 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto w-full max-w-lg space-y-6"
      >
        <div className="text-center">
          <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/20 text-teal-600 dark:text-teal-400">
            <Building2 className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">{t("publicPortal.title")}</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t("publicPortal.subtitle")}</p>
        </div>

        {globalHint?.license_note ? (
          <p className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 px-4 py-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
            {globalHint.license_note}
          </p>
        ) : null}

        <Card className="p-5 shadow-lg">
          <form onSubmit={onSearch} className="space-y-4">
            <TextField
              label={t("publicPortal.phoneLabel")}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
            {err ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{err}</span>
              </div>
            ) : null}
            <Button type="submit" className="w-full py-3" disabled={loading}>
              {loading ? t("common.loading") : t("publicPortal.show")}
            </Button>
          </form>
        </Card>

        {data ? (
          <Card className="space-y-4 p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <BarChart3 className="h-5 w-5 text-teal-500" />
              {t("publicPortal.summary")}
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="text-[hsl(var(--muted-foreground))]">{t("publicPortal.startDate")}</dt>
                <dd className="font-medium">{fmtDate(data.subscriber.start_date)}</dd>
              </div>
              <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="text-[hsl(var(--muted-foreground))]">{t("publicPortal.endDate")}</dt>
                <dd className="font-medium">{fmtDate(data.subscriber.expiration_date)}</dd>
              </div>
              <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                <dt className="flex items-center gap-1 text-[hsl(var(--muted-foreground))]">
                  <Gauge className="h-3.5 w-3.5" />
                  {t("publicPortal.speed")}
                </dt>
                <dd className="text-start font-medium">{data.subscriber.speed}</dd>
              </div>
              {data.subscriber.is_limited_quota ? (
                <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
                  <dt className="flex items-center gap-1 text-[hsl(var(--muted-foreground))]">
                    <HardDrive className="h-3.5 w-3.5" />
                    {t("publicPortal.remaining")}
                  </dt>
                  <dd className="font-medium text-teal-600 dark:text-teal-400">
                    {data.subscriber.remaining_bytes != null ? formatBytes(data.subscriber.remaining_bytes) : "—"}
                  </dd>
                </div>
              ) : null}
            </dl>

            <h3 className="mt-4 text-sm font-semibold opacity-80">{t("publicPortal.traffic")}</h3>
            <div className="grid gap-2 text-sm">
              {(
                [
                  ["daily", t("publicPortal.daily")],
                  ["monthly", t("publicPortal.monthly")],
                  ["yearly", t("publicPortal.yearly")],
                ] as const
              ).map(([key, label]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-xl bg-[hsl(var(--muted))]/40 px-3 py-2"
                >
                  <span className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                    <Calendar className="h-3.5 w-3.5" />
                    {label}
                  </span>
                  <span className="font-mono text-xs font-medium">
                    {formatBytes(data.usage[key].total_bytes)}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-4 text-center">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("publicPortal.contactHint")}</p>
              <p className="mt-2 flex items-center justify-center gap-2 text-sm font-semibold text-teal-700 dark:text-teal-300">
                <Phone className="h-4 w-4" />
                {data.accountant_phone || globalHint?.accountant_phone || t("publicPortal.noPhone")}
              </p>
            </div>

            <Button type="button" variant="outline" className="w-full" onClick={() => { setData(null); setErr(null); setPhone(""); }}>
              <RefreshCw className="h-4 w-4" />
              {t("publicPortal.newSearch")}
            </Button>
          </Card>
        ) : null}

        <p className="text-center text-[11px] text-[hsl(var(--muted-foreground))]">
          <a href="/user/login" className="text-[hsl(var(--primary))] hover:underline">
            {t("publicPortal.staffStyleLogin")}
          </a>
        </p>
      </motion.div>
    </div>
  );
}
