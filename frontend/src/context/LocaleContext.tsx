import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translations, type Locale } from "../i18n/translations";

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

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(LOCALE_KEY, l);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    document.documentElement.lang = locale === "ar" ? "ar" : "en";
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const t = (key: string) =>
    translations[locale][key] ?? translations.en[key] ?? translations.ar[key] ?? key;

  const isRtl = locale === "ar";

  return <Ctx.Provider value={{ locale, setLocale, t, isRtl }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("LocaleProvider missing");
  return v;
}
