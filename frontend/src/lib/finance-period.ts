import type { FinancePeriod } from "../context/FinancePeriodContext";

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

export function getFinancePeriodMonths(period: FinancePeriod, baseDate = new Date()) {
  const count = period === "month" ? 1 : period === "quarter" ? 3 : 12;
  const result: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth() - i, 1);
    result.push(monthKey(d));
  }
  return result;
}

export function toMonthKeyFromIso(dateIsoLike: string | null | undefined) {
  if (!dateIsoLike) return "";
  const d = new Date(dateIsoLike);
  if (Number.isNaN(d.getTime())) return "";
  return monthKey(d);
}

/** True when the date falls in one of the YYYY-MM keys in `months`. */
export function inFinancePeriod(dateIsoLike: string | null | undefined, months: Set<string>) {
  const key = toMonthKeyFromIso(dateIsoLike);
  return Boolean(key && months.has(key));
}
