/** أدوار يمكنها إنشاء/تعديل المشتركين والباقات و NAS */
export function canManageOperations(role: string | undefined): boolean {
  return role === "admin" || role === "manager";
}

/** تسجيل فواتير ومدفوعات (مثل صفحة الفوترة). */
export function canRecordFinance(role: string | undefined): boolean {
  return role === "admin" || role === "manager" || role === "accountant";
}

export function canManageStaff(role: string | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function hasStaffPermission(
  role: string | undefined,
  permissions: Record<string, boolean> | undefined,
  key: "manage_managers" | "transfer_balance"
): boolean {
  if (role === "admin") return true;
  if (role !== "manager") return false;
  return Boolean(permissions?.[key]);
}

export function canOpenStaffSection(
  role: string | undefined,
  permissions: Record<string, boolean> | undefined
): boolean {
  return (
    hasStaffPermission(role, permissions, "manage_managers") ||
    hasStaffPermission(role, permissions, "transfer_balance") ||
    canTopupManagerWallet(role, permissions)
  );
}

/** شحن محفظة مدير: admin، أو managers:topup_wallet، أو transfer_balance للمدير. */
export function canTopupManagerWallet(
  role: string | undefined,
  permissions: Record<string, boolean> | undefined
): boolean {
  if (role === "admin") return true;
  if (hasIspPermission(role, permissions, "managers:topup_wallet")) return true;
  return hasStaffPermission(role, permissions, "transfer_balance");
}

/** جباية تسوية من المدير. */
export function canCollectManagerSettlement(
  role: string | undefined,
  permissions: Record<string, boolean> | undefined
): boolean {
  if (role === "admin") return true;
  return hasIspPermission(role, permissions, "managers:collect_settlement");
}

export function canViewSpeedProfiles(
  role: string | undefined,
  permissions: Record<string, boolean> | undefined
): boolean {
  if (role === "admin") return true;
  return Boolean(permissions?.view_speed_profiles);
}

export function canManageSpeedProfiles(
  role: string | undefined,
  permissions: Record<string, boolean> | undefined
): boolean {
  if (role === "admin") return true;
  if (role !== "manager") return false;
  return Boolean(
    permissions?.create_speed_profile ||
      permissions?.edit_speed_profile ||
      permissions?.manage_speed_schedules ||
      permissions?.apply_speed_override
  );
}

/** JWT merged permissions include keys like `financial_reports:view`, `managers:view_wallet`. */
export function hasIspPermission(
  role: string | undefined,
  permissions: Record<string, boolean> | undefined,
  key: string
): boolean {
  if (role === "admin") return true;
  return Boolean(permissions?.[key]);
}

export const CHATOPS_PERMISSION_KEYS = [
  "chatops:use",
  "chatops:view_subscriber",
  "chatops:create_subscriber",
  "chatops:renew_subscriber",
  "chatops:disconnect_user",
  "chatops:view_finance",
  "chatops:print_prepaid_cards",
  "chatops:view_monitoring",
  "chatops:execute_router_actions",
] as const;

export type ChatOpsPermissionKey = (typeof CHATOPS_PERMISSION_KEYS)[number];

export function hasChatOpsPermission(
  role: string | undefined,
  permissions: Record<string, boolean> | undefined,
  key: ChatOpsPermissionKey
): boolean {
  if (role === "admin") return true;
  if (!permissions?.["chatops:use"]) return false;
  if (key === "chatops:use") return true;
  return Boolean(permissions?.[key]);
}

export function canUseChatOps(role: string | undefined, permissions: Record<string, boolean> | undefined): boolean {
  return role === "admin" || Boolean(permissions?.["chatops:use"]);
}

export function hasMonitoringPermission(
  role: string | undefined,
  permissions: Record<string, boolean> | undefined,
  key: "monitoring:view" | "monitoring:manage" | "monitoring:acknowledge_alerts" | "monitoring:execute_router_actions"
): boolean {
  if (role === "admin") return true;
  if (role === "manager") {
    if (key === "monitoring:execute_router_actions") return Boolean(permissions?.[key]);
    return permissions?.[key] !== false;
  }
  if (role === "accountant" || role === "viewer") {
    return key === "monitoring:view" && Boolean(permissions?.["monitoring:view"]);
  }
  return false;
}
