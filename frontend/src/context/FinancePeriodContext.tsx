import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type FinancePeriod = "month" | "quarter" | "year";

type FinancePeriodContextValue = {
  period: FinancePeriod;
  setPeriod: (period: FinancePeriod) => void;
};

const FinancePeriodContext = createContext<FinancePeriodContextValue | null>(null);

const STORAGE_KEY = "future-radius.finance-period";

export function FinancePeriodProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriodState] = useState<FinancePeriod>("month");

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "month" || raw === "quarter" || raw === "year") {
      setPeriodState(raw);
    }
  }, []);

  const value = useMemo<FinancePeriodContextValue>(
    () => ({
      period,
      setPeriod: (next) => {
        setPeriodState(next);
        localStorage.setItem(STORAGE_KEY, next);
      },
    }),
    [period]
  );

  return <FinancePeriodContext.Provider value={value}>{children}</FinancePeriodContext.Provider>;
}

export function useFinancePeriod() {
  const ctx = useContext(FinancePeriodContext);
  if (!ctx) throw new Error("useFinancePeriod must be used inside FinancePeriodProvider");
  return ctx;
}
