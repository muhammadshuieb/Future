import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { type Locale, translate } from "../i18n/translations";

const LOCALE_KEY = "fr_locale";

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
  isRtl: boolean;
};

const Ctx = createContext<Ctx | null>(null);

function readStoredLocale(): Locale {
  try {
    const s = localStorage.getItem(LOCALE_KEY);
    if (s === "en" || s === "ar") return s;
  } catch {
    /* ignore */
  }
  return "ar";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(LOCALE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "ar" ? "ar" : "en";
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const t = useCallback((key: string) => translate(locale, key), [locale]);

  const isRtl = locale === "ar";

  const ctxValue = useMemo(
    () => ({ locale, setLocale, t, isRtl }),
    [locale, setLocale, t, isRtl]
  );

  return <Ctx.Provider value={ctxValue}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("LocaleProvider missing");
  return v;
}
