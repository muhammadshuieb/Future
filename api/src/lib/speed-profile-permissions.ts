import type { Role } from "../middleware/auth.js";

export const SPEED_PROFILE_PERMISSION_KEYS = [
  "view_speed_profiles",
  "create_speed_profile",
  "edit_speed_profile",
  "delete_speed_profile",
  "manage_speed_schedules",
  "apply_speed_override",
  "view_speed_profile_logs",
] as const;

export type SpeedProfilePermissionKey = (typeof SPEED_PROFILE_PERMISSION_KEYS)[number];

export function defaultSpeedProfilePermissionsAllOn(): Record<SpeedProfilePermissionKey, boolean> {
  return {
    view_speed_profiles: true,
    create_speed_profile: true,
    edit_speed_profile: true,
    delete_speed_profile: true,
    manage_speed_schedules: true,
    apply_speed_override: true,
    view_speed_profile_logs: true,
  };
}

export function defaultSpeedProfilePermissionsAllOff(): Record<SpeedProfilePermissionKey, boolean> {
  return {
    view_speed_profiles: false,
    create_speed_profile: false,
    edit_speed_profile: false,
    delete_speed_profile: false,
    manage_speed_schedules: false,
    apply_speed_override: false,
    view_speed_profile_logs: false,
  };
}

export function normalizeSpeedProfilePermissions(
  input: unknown
): Record<SpeedProfilePermissionKey, boolean> {
  const base = defaultSpeedProfilePermissionsAllOff();
  if (!input || typeof input !== "object") return base;
  const src = input as Record<string, unknown>;
  for (const key of SPEED_PROFILE_PERMISSION_KEYS) {
    if (key in src) base[key] = Boolean(src[key]);
  }
  return base;
}

export function mergeManagerAndSpeedPermissions(
  managerJson: unknown,
  speedJson: unknown
): Record<string, boolean> {
  const m =
    typeof managerJson === "object" && managerJson
      ? (managerJson as Record<string, boolean>)
      : {};
  const s = normalizeSpeedProfilePermissions(speedJson);
  return { ...m, ...s };
}

export function hasSpeedProfilePermission(
  role: Role | undefined,
  permissions: Record<string, boolean> | undefined,
  key: SpeedProfilePermissionKey
): boolean {
  if (role === "admin") return true;
  return Boolean(permissions?.[key]);
}
