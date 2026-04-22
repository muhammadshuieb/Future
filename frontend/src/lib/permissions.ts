/** أدوار يمكنها إنشاء/تعديل المشتركين والباقات و NAS */
export function canManageOperations(role: string | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function canManageStaff(role: string | undefined): boolean {
  return role === "admin" || role === "manager";
}
