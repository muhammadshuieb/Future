import type { Request } from "express";
import type { Role } from "../middleware/auth.js";

/** Granular ISP / company finance permissions (JWT `permissions` object). */
export const ISP_PERMISSION_KEYS = [
  "managers:view",
  "managers:create",
  "managers:update",
  "managers:topup_wallet",
  "managers:set_negative_limit",
  "managers:set_commission",
  "managers:view_wallet",
  "managers:view_statement",
  "managers:collect_settlement",
  "managers:view_subscribers",
  "subscribers:renew",
  "subscribers:view_all",
  "subscribers:assign_manager",
  "invoices:collect",
  "prepaid_cards:print",
  "prepaid_cards:sell",
  "expenses:view",
  "expenses:create",
  "expenses:update",
  "expenses:delete",
  "assets:view",
  "assets:create",
  "assets:update",
  "financial_reports:view",
  "financial_reports:export",
  "cashbox:manage",
] as const;

export type IspPermissionKey = (typeof ISP_PERMISSION_KEYS)[number];

export function defaultIspPermissionsAllOn(): Record<IspPermissionKey, boolean> {
  const o = {} as Record<IspPermissionKey, boolean>;
  for (const k of ISP_PERMISSION_KEYS) o[k] = true;
  return o;
}

export function defaultIspPermissionsManager(): Record<IspPermissionKey, boolean> {
  const o = defaultIspPermissionsAllOn();
  o["managers:create"] = false;
  o["managers:update"] = false;
  o["managers:set_negative_limit"] = false;
  o["managers:set_commission"] = false;
  o["managers:collect_settlement"] = false;
  o["subscribers:view_all"] = false;
  o["subscribers:assign_manager"] = false;
  o["expenses:create"] = false;
  o["expenses:update"] = false;
  o["expenses:delete"] = false;
  o["assets:create"] = false;
  o["assets:update"] = false;
  o["cashbox:manage"] = false;
  return o;
}

export function defaultIspPermissionsAccountant(): Record<IspPermissionKey, boolean> {
  const o = defaultIspPermissionsAllOn();
  for (const k of ISP_PERMISSION_KEYS) o[k] = false;
  o["expenses:view"] = true;
  o["expenses:create"] = true;
  o["financial_reports:view"] = true;
  o["financial_reports:export"] = true;
  o["managers:view"] = true;
  o["managers:view_wallet"] = true;
  o["managers:view_statement"] = true;
  o["managers:collect_settlement"] = true;
  return o;
}

export function defaultIspPermissionsViewer(): Record<IspPermissionKey, boolean> {
  const o = defaultIspPermissionsAllOn();
  for (const k of ISP_PERMISSION_KEYS) o[k] = false;
  o["financial_reports:view"] = true;
  o["expenses:view"] = true;
  o["assets:view"] = true;
  o["managers:view"] = true;
  return o;
}

export function normalizeIspPermissions(
  raw: unknown,
  base: Record<IspPermissionKey, boolean>
): Record<IspPermissionKey, boolean> {
  const out = { ...base };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const k of ISP_PERMISSION_KEYS) {
    if (k in src) out[k] = Boolean(src[k]);
  }
  return out;
}

export function hasIspPermission(
  role: Role | string | undefined,
  perms: Record<string, boolean> | undefined,
  key: IspPermissionKey
): boolean {
  if (role === "admin") return true;
  const p = normalizeIspPermissions(perms ?? {}, defaultIspPermissionsViewer());
  return Boolean(p[key]);
}

export function requestHasIspPermission(req: Request, key: IspPermissionKey): boolean {
  return hasIspPermission(req.auth?.role, req.auth?.permissions, key);
}
