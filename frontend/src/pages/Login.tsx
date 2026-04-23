import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/LocaleContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextField } from "../components/ui/TextField";
import { LogoLockup, LogoMark } from "../components/brand/Logo";

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
        <div className="absolute -top-32 -end-32 h-96 w-96 animate-pulse rounded-full bg-[hsl(var(--primary))]/30 blur-3xl" />
        <div className="absolute -bottom-32 -start-32 h-[28rem] w-[28rem] animate-pulse rounded-full bg-[hsl(var(--accent))]/25 blur-3xl" />
        <div className="absolute inset-y-0 start-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-cyan-500/15 blur-3xl" />
      </div>

      <motion.div
        initial={{ scale: 0.97, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <div className="mb-5">
          <LogoLockup size="sm" />
        </div>

        <Card className="shadow-glow-lg">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex items-center justify-center rounded-3xl bg-gradient-to-br from-[hsl(var(--primary))]/15 to-[hsl(var(--accent))]/15 p-3 ring-1 ring-[hsl(var(--primary))]/20">
              <LogoMark size="lg" />
            </div>
            <div className="bg-gradient-to-r from-[hsl(var(--primary))] via-violet-500 to-[hsl(var(--accent))] bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
              Future Radius
            </div>
            <p className="mt-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
              {t("login.brand_tagline")}
            </p>
            <h1 className="mt-4 text-lg font-semibold">{t("login.title")}</h1>
            <p className="mt-1 text-xs opacity-70">{t("login.subtitle")}</p>
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
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-[hsl(var(--foreground))]/80">
                {t("login.langLabel")}
              </span>
              <select
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 px-3 py-2.5 text-sm outline-none transition focus:border-[hsl(var(--primary))]/60 focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                value={locale}
                onChange={(e) => setLocale(e.target.value as "ar" | "en")}
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
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
