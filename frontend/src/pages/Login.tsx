import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Globe, LogIn, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/LocaleContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextField } from "../components/ui/TextField";

export function LoginPage() {
  const { login } = useAuth();
  const { t, isRtl, locale, setLocale } = useI18n();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await login(email, password);
      nav("/");
    } catch {
      setErr(t("login.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-4"
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Ambient animated blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -end-24 h-80 w-80 rounded-full bg-[hsl(var(--primary))]/30 blur-3xl" />
        <div className="absolute -bottom-24 -start-24 h-96 w-96 rounded-full bg-[hsl(var(--accent))]/25 blur-3xl" />
        <div className="absolute inset-y-0 start-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-500/15 blur-3xl" />
      </div>

      <motion.div
        initial={{ scale: 0.97, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] text-white shadow-glow">
              FR
            </div>
            <span>{t("app.name")}</span>
          </div>
          <button
            type="button"
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            className="flex items-center gap-1.5 rounded-full bg-[hsl(var(--card))]/70 px-3 py-1.5 text-xs font-medium backdrop-blur hover:bg-[hsl(var(--card))]"
          >
            <Globe className="h-3.5 w-3.5 text-violet-500" />
            {t("nav.lang")}
          </button>
        </div>

        <Card className="shadow-glow-lg">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500 ring-1 ring-indigo-500/20">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{t("login.title")}</h1>
              <p className="text-xs opacity-70">{t("login.subtitle")}</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <TextField
              label={t("login.email")}
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <TextField
              label={t("login.password")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {err ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {err}
              </p>
            ) : null}
            <Button type="submit" disabled={loading} className="mt-1 py-2.5">
              <LogIn className="h-4 w-4" />
              {loading ? "..." : t("login.submit")}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-[11px] opacity-50">{t("app.tagline")}</p>
      </motion.div>
    </div>
  );
}
