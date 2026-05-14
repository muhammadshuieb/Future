import { Link } from "react-router-dom";
import { useI18n } from "../context/LocaleContext";

export function PrepaidUnavailablePage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">{t("prepaid.unavailable.title")}</h1>
      <p className="text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{t("prepaid.unavailable.body")}</p>
      <div className="flex flex-wrap gap-3 pt-2">
        <Link
          to="/packages"
          className="inline-flex rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-95"
        >
          {t("prepaid.unavailable.linkPackages")}
        </Link>
        <Link
          to="/users"
          className="inline-flex rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))]/40"
        >
          {t("prepaid.unavailable.linkSubscribers")}
        </Link>
      </div>
    </div>
  );
}
