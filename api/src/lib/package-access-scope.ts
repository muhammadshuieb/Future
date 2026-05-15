/**
 * Package-level NAS and manager whitelists (JSON on `packages`).
 * NULL / missing = no restriction. Non-empty JSON array = enforce whitelist.
 */

export function parseJsonStringArray(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter((s) => s.length > 0);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || t === "null") return [];
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter((s) => s.length > 0);
      }
    } catch {
      return [];
    }
  }
  return [];
}

/** When package has a NAS whitelist, subscriber must be bound to one of those NAS devices. */
export function subscriberNasAllowedForPackage(
  subscriberNasServerId: string | null | undefined,
  packageAllowedNasIdsJson: unknown
): boolean {
  const allowed = parseJsonStringArray(packageAllowedNasIdsJson);
  if (allowed.length === 0) return true;
  const sid = subscriberNasServerId != null ? String(subscriberNasServerId).trim() : "";
  if (!sid) return false;
  return allowed.includes(sid);
}

/** Manager may use package in UI / assignment when whitelist is empty or includes them. */
export function managerAllowedForPackage(
  staffRole: string | undefined,
  staffUserId: string | undefined,
  packageManagersJson: unknown
): boolean {
  if (staffRole === "admin") return true;
  const allowed = parseJsonStringArray(packageManagersJson);
  if (allowed.length === 0) return true;
  const uid = staffUserId != null ? String(staffUserId).trim() : "";
  if (!uid) return false;
  return allowed.includes(uid);
}

export function toJsonColumnValue(ids: string[] | undefined | null): string | null {
  if (ids == null) return null;
  const cleaned = ids.map((s) => String(s).trim()).filter((s) => s.length > 0);
  if (cleaned.length === 0) return null;
  return JSON.stringify(cleaned);
}
