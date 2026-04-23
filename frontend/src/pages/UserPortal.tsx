import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { Fingerprint, LogIn, Network, UserCircle, Wifi } from "lucide-react";
import { userApiFetch, setUserToken } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
function formatBytesLabel(n: string): string {
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

export function UserPortalLogin() {
  const { t, isRtl, locale, setLocale } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await userApiFetch("/api/user/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      setErr(t("userPortalLogin.error"));
      return;
    }
    const data = (await r.json()) as { token: string };
    setUserToken(data.token);
    nav("/user/dashboard");
  }

  return (
    <div
      className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-slate-900/40 via-[hsl(var(--background))] to-cyan-950/30 px-4 py-10"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute end-0 top-0 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute bottom-0 start-0 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto w-full max-w-md"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-600 dark:text-cyan-300">
              <Wifi className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-bold text-[hsl(var(--foreground))]">{t("userPortalLogin.brand")}</div>
              <div className="text-[10px] opacity-60">{t("userPortalLogin.badge")}</div>
            </div>
          </div>
        </div>

        <Card className="p-5 shadow-lg ring-1 ring-cyan-500/10">
          <h1 className="text-lg font-bold">{t("userPortalLogin.title")}</h1>
          <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">{t("userPortalLogin.subtitle")}</p>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <TextField
              label={t("userPortalLogin.user")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <TextField
              label={t("userPortalLogin.pass")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <label className="text-xs text-[hsl(var(--muted-foreground))]">
              {t("userPortalLogin.langLabel")}
            </label>
            <select
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 px-3 py-2.5 text-sm"
              value={locale}
              onChange={(e) => setLocale(e.target.value as "ar" | "en")}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
            {err ? <p className="text-sm text-red-500 dark:text-red-400">{err}</p> : null}
            <Button type="submit" className="w-full">
              <LogIn className="me-2 h-4 w-4" />
              {t("userPortalLogin.submit")}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-sm">
          <Link to="/portal" className="text-cyan-600 hover:underline dark:text-cyan-400">
            {t("userPortalLogin.phoneLink")}
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

export function UserPortalDashboard() {
  const { t, isRtl } = useI18n();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    void (async () => {
      const r = await userApiFetch("/api/user/me");
      if (!r.ok) {
        nav("/user/login", { replace: true });
        return;
      }
      setData(await r.json());
    })();
  }, [nav]);

  if (!data) {
    return (
      <div className="min-h-screen p-6 text-sm opacity-70" dir={isRtl ? "rtl" : "ltr"}>
        {t("common.loading")}
      </div>
    );
  }

  const sub = data.subscriber as Record<string, unknown>;
  const quota = String(data.quota_bytes ?? "0");
  const rem = data.remaining_bytes != null ? String(data.remaining_bytes) : null;
  const used = String(data.usage_bytes ?? "0");

  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-b from-cyan-950/20 to-[hsl(var(--background))] px-4 py-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <UserCircle className="h-7 w-7 text-cyan-500" />
          {t("userPortalDash.title")}
        </h1>
        <Card className="p-4">
          <dl className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
              <dt className="flex items-center gap-1 text-[hsl(var(--muted-foreground))]">
                <Network className="h-4 w-4" />
                {t("userPortalDash.speed")}
              </dt>
              <dd className="font-medium">{String(sub?.mikrotik_rate_limit ?? "—")}</dd>
            </div>
            <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
              <dt className="text-[hsl(var(--muted-foreground))]">{t("userPortalDash.expiry")}</dt>
              <dd className="font-medium">
                {sub?.expiration_date != null
                  ? String(sub.expiration_date).slice(0, 10)
                  : "—"}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--border))]/50 pb-2">
              <dt className="text-[hsl(var(--muted-foreground))]">{t("userPortalDash.start")}</dt>
              <dd className="font-medium">
                {sub?.start_date != null ? String(sub.start_date).slice(0, 10) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[hsl(var(--muted-foreground))]">{t("userPortalDash.usage")}</dt>
              <dd className="mt-1 font-mono text-xs">
                {formatBytesLabel(used)} / {formatBytesLabel(quota)}
                {rem != null && (
                  <span className="ms-2 text-cyan-600 dark:text-cyan-400">
                    ({t("userPortalDash.rem")}: {formatBytesLabel(rem)})
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1 text-[hsl(var(--muted-foreground))]">
                <Fingerprint className="h-3.5 w-3.5" />
                {t("userPortalDash.currentIp")}
              </dt>
              <dd className="mt-1 font-mono text-sm">{String(data.current_ip ?? "—")}</dd>
            </div>
          </dl>
        </Card>
        <p className="text-center text-xs text-[hsl(var(--muted-foreground))]">
          <a href="/portal" className="text-cyan-600 hover:underline">
            {t("userPortalLogin.phoneLink")}
          </a>
        </p>
      </div>
    </div>
  );
}
