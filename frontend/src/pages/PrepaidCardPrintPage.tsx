import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { useI18n } from "../context/LocaleContext";
import { apiFetch } from "../lib/api";
import { buildPrepaidCardsPrintHtml, type PrepaidCardPrintItem } from "../lib/prepaid-card-print";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { SelectField, TextField } from "../components/ui/TextField";
import { cn } from "../lib/utils";

type NavState = {
  series?: string;
  cards?: PrepaidCardPrintItem[];
  packageName?: string;
};

export function PrepaidCardPrintPage() {
  const { t, isRtl } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = (location.state ?? {}) as NavState;

  const [companyName, setCompanyName] = useState(t("app.name"));
  const [layout, setLayout] = useState<"a4-8" | "a4-6" | "a4-4">("a4-8");
  const [showPrice, setShowPrice] = useState(true);
  const [showQr, setShowQr] = useState(false);
  const [cards, setCards] = useState<PrepaidCardPrintItem[]>(nav.cards ?? []);
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState(nav.series ?? "");

  const labels = useMemo(
    () => ({
      package: t("users.package"),
      username: t("users.username"),
      password: t("users.password"),
      speed: t("prepaid.print.speed"),
      validity: t("prepaid.print.validity"),
      price: t("prepaid.print.price"),
      instructions: t("prepaid.print.instructionsDefault"),
    }),
    [t]
  );

  async function loadSeries() {
    if (!series.trim()) return;
    setLoading(true);
    try {
      const r = await apiFetch(`/api/rm-cards/${encodeURIComponent(series.trim())}/cards`);
      if (!r.ok) return;
      const j = (await r.json()) as {
        items?: Array<{
          cardnum: string;
          password: string;
          service_name?: string;
          value?: string | number;
          expiration?: string;
        }>;
      };
      setCards(
        (j.items ?? []).map((c) => ({
          cardnum: c.cardnum,
          password: c.password,
          packageName: c.service_name ?? nav.packageName ?? "—",
          priceLabel: showPrice && c.value != null ? String(c.value) : undefined,
          validityLabel: c.expiration ? String(c.expiration).slice(0, 10) : undefined,
        }))
      );
    } finally {
      setLoading(false);
    }
  }

  function openPrint() {
    if (!cards.length) return;
    const html = buildPrepaidCardsPrintHtml({
      companyName,
      showPrice,
      showQr,
      layout,
      cards,
      labels,
    });
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
        </Button>
        <h1 className="text-xl font-bold">{t("prepaid.print.title")}</h1>
      </div>

      <Card className="space-y-4 p-4">
        <TextField label={t("prepaid.print.companyName")} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t("prepaid.print.series")} value={series} onChange={(e) => setSeries(e.target.value)} />
          <div className="flex items-end">
            <Button type="button" variant="outline" disabled={loading || !series.trim()} onClick={() => void loadSeries()}>
              {loading ? t("common.loading") : t("prepaid.print.loadSeries")}
            </Button>
          </div>
        </div>
        <SelectField label={t("prepaid.print.layout")} value={layout} onChange={(e) => setLayout(e.target.value as typeof layout)}>
          <option value="a4-8">{t("prepaid.print.layout8")}</option>
          <option value="a4-6">{t("prepaid.print.layout6")}</option>
          <option value="a4-4">{t("prepaid.print.layout4")}</option>
        </SelectField>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
          {t("prepaid.print.showPrice")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showQr} onChange={(e) => setShowQr(e.target.checked)} />
          {t("prepaid.print.showQr")}
        </label>
        <p className="text-sm opacity-70">
          {t("prepaid.print.cardCount")}: {cards.length}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={openPrint} disabled={!cards.length}>
            <Printer className="h-4 w-4" />
            {t("prepaid.print.print")}
          </Button>
          <Link to="/users/prepaid-cards" className="text-sm text-[hsl(var(--primary))] hover:underline">
            {t("prepaid.print.backBatch")}
          </Link>
        </div>
      </Card>

      {cards.length > 0 ? (
        <Card className="overflow-auto p-4">
          <p className="mb-3 text-sm font-medium">{t("prepaid.print.preview")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {cards.slice(0, 4).map((c) => (
              <div key={c.cardnum} className="rounded-lg border border-[hsl(var(--border))] p-3 text-xs">
                <div className="font-semibold">{companyName}</div>
                <div>{c.packageName}</div>
                <div dir="ltr" className="font-mono">
                  {c.cardnum} / {c.password}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
