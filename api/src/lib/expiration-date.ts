/**
 * Normalize subscription expiry from API/UI date strings (YYYY-MM-DD or ISO).
 * Anchors at 12:00 local server time to match billing renewals.
 */
export function parseSubscriptionExpirationInput(raw: string): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = dateOnly ? new Date(`${s}T12:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (!dateOnly) {
    d.setHours(12, 0, 0, 0);
  }
  return d;
}

export function formatExpirationForDb(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Matches subscriber list SQL: `DATE(expiration_date) <= CURDATE()` is expired. */
export function isSubscriptionExpiredByCalendarDate(
  expiration: Date | string | null | undefined
): boolean {
  if (expiration == null || String(expiration).trim() === "") return false;
  const exp = new Date(expiration as string);
  if (Number.isNaN(exp.getTime())) return true;
  const now = new Date();
  const expY = exp.getFullYear();
  const expM = exp.getMonth();
  const expD = exp.getDate();
  if (expY < now.getFullYear()) return true;
  if (expY > now.getFullYear()) return false;
  if (expM < now.getMonth()) return true;
  if (expM > now.getMonth()) return false;
  return expD <= now.getDate();
}
