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

/** NULL / [] in DB, or whitelist covering every tenant NAS = no NAS restriction. */
export function packageNasWhitelistIsUnrestricted(
  packageAllowedNasIdsJson: unknown,
  allTenantNasIds: string[]
): boolean {
  const allowed = parseJsonStringArray(packageAllowedNasIdsJson);
  if (allowed.length === 0) return true;
  const tenantIds = allTenantNasIds.map((id) => String(id).trim()).filter(Boolean);
  if (tenantIds.length === 0) return true;
  const allowedSet = new Set(allowed);
  return tenantIds.every((id) => allowedSet.has(id));
}

/** When package has a NAS whitelist, subscriber must be bound to one of those NAS devices. */
export function subscriberNasAllowedForPackage(
  subscriberNasServerId: string | null | undefined,
  packageAllowedNasIdsJson: unknown,
  allTenantNasIds?: string[]
): boolean {
  const allowed = parseJsonStringArray(packageAllowedNasIdsJson);
  if (allowed.length === 0) return true;
  if (allTenantNasIds && packageNasWhitelistIsUnrestricted(packageAllowedNasIdsJson, allTenantNasIds)) {
    return true;
  }
  const sid = subscriberNasServerId != null ? String(subscriberNasServerId).trim() : "";
  if (!sid) return false;
  return allowed.includes(sid);
}

/** NULL / [] in DB, or whitelist covering every manager = no manager restriction. */
export function packageManagersWhitelistIsUnrestricted(
  packageManagersJson: unknown,
  allManagerUserIds: string[]
): boolean {
  const allowed = parseJsonStringArray(packageManagersJson);
  if (allowed.length === 0) return true;
  const managerIds = allManagerUserIds.map((id) => String(id).trim()).filter(Boolean);
  if (managerIds.length === 0) return true;
  const allowedSet = new Set(allowed);
  return managerIds.every((id) => allowedSet.has(id));
}

/** Manager may use package in UI / assignment when whitelist is empty or includes them. */
export function managerAllowedForPackage(
  staffRole: string | undefined,
  staffUserId: string | undefined,
  packageManagersJson: unknown,
  allManagerUserIds?: string[]
): boolean {
  if (staffRole === "admin") return true;
  const allowed = parseJsonStringArray(packageManagersJson);
  if (allowed.length === 0) return true;
  if (allManagerUserIds && packageManagersWhitelistIsUnrestricted(packageManagersJson, allManagerUserIds)) {
    return true;
  }
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
