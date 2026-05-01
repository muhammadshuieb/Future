/** أدوار يمكنها إنشاء/تعديل المشتركين والباقات و NAS */
export function canManageOperations(role: string | undefined): boolean {
  return role === "admin" || role === "manager";
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
  return hasStaffPermission(role, permissions, "manage_managers") || hasStaffPermission(role, permissions, "transfer_balance");
}
