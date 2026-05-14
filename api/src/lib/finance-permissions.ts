import type { Request } from "express";

/** Fine-grained finance flags stored in JWT `permissions` (managers + optional accountant overrides). */
export const FINANCE_PERMISSION_KEYS = [
  "view_finance",
  "create_invoice",
  "collect_payment",
  "apply_discount",
  "issue_refund",
  "delete_payment",
  "view_receivables",
  "export_financial_reports",
  "send_financial_whatsapp_reports",
  "manage_cashboxes",
  "view_journal_entries",
  "post_manual_adjustments",
] as const;

export type FinancePermissionKey = (typeof FINANCE_PERMISSION_KEYS)[number];

export function defaultFinancePermissions(): Record<FinancePermissionKey, boolean> {
  const o = {} as Record<FinancePermissionKey, boolean>;
  for (const k of FINANCE_PERMISSION_KEYS) o[k] = true;
  return o;
}

export function normalizeFinancePermissions(raw: unknown): Record<FinancePermissionKey, boolean> {
  const base = defaultFinancePermissions();
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Record<string, unknown>;
  for (const k of FINANCE_PERMISSION_KEYS) {
    if (k in src) base[k] = Boolean(src[k]);
  }
  return base;
}

export function accountantFinanceDefaults(): Record<FinancePermissionKey, boolean> {
  const o = defaultFinancePermissions();
  o.delete_payment = false;
  o.issue_refund = false;
  o.post_manual_adjustments = false;
  o.manage_cashboxes = false;
  return o;
}

export function hasFinancePermission(
  role: string | undefined,
  perms: Record<string, boolean> | undefined,
  key: FinancePermissionKey
): boolean {
  if (role === "admin") return true;
  if (role === "viewer") return false;
  const fromJwt = normalizeFinancePermissions(perms ?? {});
  return Boolean(fromJwt[key]);
}

export function requestHasFinancePermission(req: Request, key: FinancePermissionKey): boolean {
  return hasFinancePermission(req.auth?.role, req.auth?.permissions, key);
}
