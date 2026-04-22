export enum SubscriberState {
  ACTIVE = "ACTIVE",
  EXPIRED = "EXPIRED",
  LIMITED = "LIMITED",
  BLOCKED = "BLOCKED",
}

export type SubscriberStateInput = {
  status?: string | null;
  expirationDate?: string | Date | null;
  quotaTotalBytes?: number | null;
  usedBytes?: number | null;
  quotaLimitedToday?: boolean | null;
  overdueInvoicesCount?: number | null;
};

export function resolveSubscriberState(input: SubscriberStateInput): SubscriberState {
  if (input.quotaLimitedToday) return SubscriberState.LIMITED;
  const overdueInvoicesCount = Number(input.overdueInvoicesCount ?? 0);
  if (overdueInvoicesCount > 0) return SubscriberState.BLOCKED;
  if (input.expirationDate) {
    const exp = new Date(input.expirationDate);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
      return SubscriberState.EXPIRED;
    }
  }
  const normalized = String(input.status ?? "").toLowerCase();
  if (normalized === "disabled" || normalized === "inactive" || normalized === "suspended") {
    return SubscriberState.BLOCKED;
  }
  return SubscriberState.ACTIVE;
}
