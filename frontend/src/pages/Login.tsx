import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await login(email, password);
      nav("/");
    } catch {
      setErr(t("login.error"));
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] p-4"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
          >
            {t("nav.lang")}
          </button>
        </div>
        <Card className="border border-[hsl(var(--border))] shadow-lg">
          <h1 className="mb-1 text-2xl font-bold">{t("login.title")}</h1>
          <p className="mb-6 text-sm opacity-70">{t("login.subtitle")}</p>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <TextField
              label={t("login.email")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <TextField
              label={t("login.password")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {err ? <p className="text-sm text-red-500">{err}</p> : null}
            <Button type="submit">{t("login.submit")}</Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
