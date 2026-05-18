import type { Request } from "express";

export const RESELLER_PERMISSION_KEYS = [
  "view_resellers",
  "create_reseller",
  "edit_reseller",
  "suspend_reseller",
  "manage_reseller_wallet",
  "adjust_reseller_wallet",
  "view_reseller_commissions",
  "approve_reseller_settlements",
  "manage_reseller_branding",
] as const;

export type ResellerPermissionKey = (typeof RESELLER_PERMISSION_KEYS)[number];

export type EnterpriseStaffPermissionKey = ResellerPermissionKey;

export function hasEnterpriseStaffPermission(
  req: Request,
  key: EnterpriseStaffPermissionKey
): boolean {
  const role = req.auth?.role;
  if (role === "admin") return true;
  return Boolean(req.auth?.permissions?.[key]);
}
