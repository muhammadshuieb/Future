/** Curated IANA zones for the settings UI (offset labels are approximate; DST may apply). */
export const COMMON_APP_TIMEZONES: { id: string; offsetLabel: string }[] = [
  { id: "UTC", offsetLabel: "GMT+0" },
  { id: "Europe/Istanbul", offsetLabel: "GMT+3" },
  { id: "Asia/Riyadh", offsetLabel: "GMT+3" },
  { id: "Asia/Kuwait", offsetLabel: "GMT+3" },
  { id: "Asia/Baghdad", offsetLabel: "GMT+3" },
  { id: "Asia/Damascus", offsetLabel: "GMT+3" },
  { id: "Africa/Cairo", offsetLabel: "GMT+2" },
  { id: "Asia/Beirut", offsetLabel: "GMT+2" },
  { id: "Asia/Amman", offsetLabel: "GMT+2" },
  { id: "Asia/Dubai", offsetLabel: "GMT+4" },
  { id: "Asia/Muscat", offsetLabel: "GMT+4" },
  { id: "Africa/Nairobi", offsetLabel: "GMT+3" },
];

export function isValidIanaTimezone(tz: string): boolean {
  const value = tz.trim();
  if (!value) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function normalizeAppTimezone(raw: unknown, fallback: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return fallback;
  return isValidIanaTimezone(value) ? value : fallback;
}
