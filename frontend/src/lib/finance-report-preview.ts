export type FinanceReportPreview = {
  title: string;
  rows: Record<string, unknown>[];
  columns: string[];
};

export function formatFinanceCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** Normalize API payloads into tabular rows for the reports hub. */
export function parseFinanceReportPayload(j: Record<string, unknown>): Pick<FinanceReportPreview, "rows" | "columns"> {
  if (Array.isArray(j.items)) {
    const rows = j.items as Record<string, unknown>[];
    const columns = rows.length ? Object.keys(rows[0]!) : [];
    return { rows, columns };
  }

  const skip = new Set(["items", "ok", "error", "detail"]);
  const keys = Object.keys(j).filter((k) => !skip.has(k));
  const scalarKeys = keys.filter((k) => {
    const v = j[k];
    return v == null || typeof v !== "object";
  });

  if (scalarKeys.length > 0) {
    return {
      rows: scalarKeys.map((k) => ({ field: k, value: j[k] })),
      columns: ["field", "value"],
    };
  }

  if (keys.length === 0) {
    return { rows: [], columns: [] };
  }

  const rows = [j];
  return { rows, columns: Object.keys(rows[0]!) };
}
