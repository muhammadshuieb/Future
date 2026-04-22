/**
 * Renewals extend from the current expiration date, not "today".
 * Expiration is always anchored at 12:00 (local server time).
 */
export function extendSubscriptionByDaysNoon(
  currentExpiration: Date,
  days: number
): Date {
  const base = new Date(currentExpiration);
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  next.setHours(12, 0, 0, 0);
  return next;
}

export function defaultExpirationNoonFromNow(days = 30): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d;
}
