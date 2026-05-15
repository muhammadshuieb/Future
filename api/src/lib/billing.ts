import {
  isSubscriptionExpiredByCalendarDate,
  parseSubscriptionExpirationInput,
} from "./expiration-date.js";

/**
 * Base date for stacking `billing_period_days` after payment.
 * Active subscription (expiry still in the future): extend from current expiry.
 * Expired or missing expiry: extend from today at noon.
 */
export function subscriptionRenewalBaseDate(
  currentExpiration: Date | string | null | undefined
): Date {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  if (currentExpiration != null && String(currentExpiration).trim() !== "") {
    const exp =
      currentExpiration instanceof Date
        ? new Date(currentExpiration)
        : new Date(String(currentExpiration));
    if (!Number.isNaN(exp.getTime())) {
      exp.setHours(12, 0, 0, 0);
      if (!isSubscriptionExpiredByCalendarDate(exp)) {
        return exp;
      }
    }
  }
  return today;
}

/**
 * Renewals add days on top of the renewal base (see `subscriptionRenewalBaseDate`).
 * Expiration is always anchored at 12:00 (local server time).
 */
export function extendSubscriptionByDaysNoon(
  currentExpiration: Date | string | null | undefined,
  days: number
): Date {
  const safeDays = Math.max(1, Math.floor(Number(days) || 1));
  const base = subscriptionRenewalBaseDate(currentExpiration);
  const next = new Date(base);
  next.setDate(next.getDate() + safeDays);
  next.setHours(12, 0, 0, 0);
  return next;
}

/** Explicit API date wins; otherwise package/profile billing days from renewal base. */
export function resolveExpirationAfterPayment(
  explicitRaw: string | undefined,
  currentExpiration: Date | string | null | undefined,
  billingDays: number
): { next: Date; usedExplicit: boolean } {
  if (explicitRaw?.trim()) {
    const parsed = parseSubscriptionExpirationInput(explicitRaw);
    if (!parsed) throw new Error("invalid_expiration");
    return { next: parsed, usedExplicit: true };
  }
  return {
    next: extendSubscriptionByDaysNoon(
      currentExpiration != null ? currentExpiration : new Date(),
      billingDays
    ),
    usedExplicit: false,
  };
}

export function billingDaysFromInvoiceMeta(meta: unknown): number | null {
  try {
    const parsedMeta = typeof meta === "string" ? JSON.parse(meta) : meta;
    const d = Number((parsedMeta as { billing_days?: unknown } | null)?.billing_days);
    return Number.isFinite(d) && d >= 1 ? Math.floor(d) : null;
  } catch {
    return null;
  }
}

export function defaultExpirationNoonFromNow(days = 30): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d;
}
