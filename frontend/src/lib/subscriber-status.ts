export type SubscriberUiKind = "disabled" | "expired" | "online" | "active";

export type SubscriberStatusRow = {
  status?: string | null;
  state?: string | null;
  expiration_date?: string | null;
  is_online?: number | string | null;
  subscriber_ui_status?: string | null;
};

export function dateOnlyExpired(expirationDate: string | null | undefined): boolean {
  if (!expirationDate) return false;
  const d = new Date(expirationDate);
  if (Number.isNaN(d.getTime())) return false;
  const ymd = d.toISOString().slice(0, 10);
  const today = new Date();
  const todayYmd = today.toISOString().slice(0, 10);
  return ymd <= todayYmd;
}

export function isExplicitlyDisabled(row: SubscriberStatusRow): boolean {
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status === "disabled" || status === "inactive" || status === "suspended" || status === "blocked") return true;
  const smart = String(row.state ?? "").trim().toUpperCase();
  return smart === "BLOCKED";
}

export function resolveSubscriberUiKind(row: SubscriberStatusRow): SubscriberUiKind {
  const fromApi = String(row.subscriber_ui_status ?? "").trim().toLowerCase();
  if (fromApi === "disabled" || fromApi === "expired" || fromApi === "online" || fromApi === "active") {
    return fromApi;
  }
  if (isExplicitlyDisabled(row)) return "disabled";
  if (String(row.status ?? "").toLowerCase() === "expired" || dateOnlyExpired(row.expiration_date)) return "expired";
  if (Number(row.is_online ?? 0) > 0) return "online";
  return "active";
}

export function subscriberStatusPresentation(
  kind: SubscriberUiKind,
  t: (key: string) => string
): { badgeClass: string; dotClass: string; rowClass: string; label: string } {
  switch (kind) {
    case "online":
      return {
        badgeClass:
          "border border-blue-500/30 bg-blue-500/12 text-blue-800 dark:border-blue-500/35 dark:bg-blue-500/15 dark:text-blue-200",
        dotClass: "bg-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]",
        rowClass:
          "border-s-[3px] border-s-blue-500/55 bg-blue-500/[0.045] hover:bg-blue-500/[0.07] dark:bg-blue-500/[0.06] dark:hover:bg-blue-500/[0.09]",
        label: t("users.state.online"),
      };
    case "active":
      return {
        badgeClass:
          "border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:border-emerald-500/35 dark:bg-emerald-500/12 dark:text-emerald-200",
        dotClass: "bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]",
        rowClass:
          "border-s-[3px] border-s-emerald-500/40 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07] dark:bg-emerald-500/[0.05] dark:hover:bg-emerald-500/[0.08]",
        label: t("users.state.active"),
      };
    case "expired":
      return {
        badgeClass:
          "border border-amber-500/35 bg-amber-500/12 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/14 dark:text-amber-100",
        dotClass: "bg-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.45)]",
        rowClass:
          "border-s-[3px] border-s-amber-500/50 bg-amber-500/[0.06] hover:bg-amber-500/[0.09] dark:bg-amber-500/[0.07] dark:hover:bg-amber-500/[0.1]",
        label: t("users.state.expired"),
      };
    case "disabled":
    default:
      return {
        badgeClass:
          "border border-red-500/35 bg-red-500/10 text-red-900 dark:border-red-500/40 dark:bg-red-500/12 dark:text-red-200",
        dotClass: "bg-red-500 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]",
        rowClass:
          "border-s-[3px] border-s-red-500/50 bg-red-500/[0.05] hover:bg-red-500/[0.08] dark:bg-red-500/[0.06] dark:hover:bg-red-500/[0.09]",
        label: t("users.state.disabled"),
      };
  }
}
