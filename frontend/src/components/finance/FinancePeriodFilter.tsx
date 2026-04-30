import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { useFinancePeriod, type FinancePeriod } from "../../context/FinancePeriodContext";
import { useI18n } from "../../context/LocaleContext";

const options: FinancePeriod[] = ["month", "quarter", "year"];

export function FinancePeriodFilter() {
  const { period, setPeriod } = useFinancePeriod();
  const { t } = useI18n();

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4" variant="solid">
      <div>
        <div className="text-sm font-semibold">{t("finance.periodTitle")}</div>
        <div className="text-xs opacity-65">{t("finance.periodHint")}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((item) => (
          <Button key={item} type="button" variant={period === item ? "primary" : "outline"} onClick={() => setPeriod(item)}>
            {t(`finance.period.${item}`)}
          </Button>
        ))}
      </div>
    </Card>
  );
}
