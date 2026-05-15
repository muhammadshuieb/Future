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
