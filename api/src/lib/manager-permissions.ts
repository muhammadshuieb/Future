import type { Request } from "express";

export const MANAGER_PERMISSION_KEYS = [
  "manage_subscribers",
  "renew_subscriptions",
  "manage_invoices",
  "manage_managers",
  "transfer_balance",
  "disconnect_users",
] as const;

export type ManagerPermissionKey = (typeof MANAGER_PERMISSION_KEYS)[number];
export type ManagerPermissions = Record<ManagerPermissionKey, boolean>;

export function defaultManagerPermissions(): ManagerPermissions {
  return {
    manage_subscribers: true,
    renew_subscriptions: true,
    manage_invoices: true,
    manage_managers: true,
    transfer_balance: true,
    disconnect_users: true,
  };
}

export function normalizeManagerPermissions(input: unknown): ManagerPermissions {
  const base = defaultManagerPermissions();
  if (!input || typeof input !== "object") return base;
  const src = input as Record<string, unknown>;
  for (const key of MANAGER_PERMISSION_KEYS) {
    if (key in src) base[key] = Boolean(src[key]);
  }
  return base;
}

export function parseManagerPermissions(raw: unknown): ManagerPermissions {
  if (!raw) return defaultManagerPermissions();
  if (typeof raw === "string") {
    try {
      return normalizeManagerPermissions(JSON.parse(raw));
    } catch {
      return defaultManagerPermissions();
    }
  }
  if (typeof raw === "object") return normalizeManagerPermissions(raw);
  return defaultManagerPermissions();
}

export function parsePermissionsObject(raw: unknown): Record<string, boolean> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return parsePermissionsObject(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(src)) out[key] = Boolean(src[key]);
  return out;
}

export function hasManagerPermission(
  role: string | undefined,
  permissions: Record<string, boolean> | undefined,
  key: ManagerPermissionKey
): boolean {
  if (role === "admin") return true;
  if (role !== "manager") return false;
  const parsed = normalizeManagerPermissions(permissions ?? {});
  return Boolean(parsed[key]);
}

export function requestHasManagerPermission(req: Request, key: ManagerPermissionKey): boolean {
  return hasManagerPermission(req.auth?.role, req.auth?.permissions, key);
}
