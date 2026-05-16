import type { Request } from "express";
import type { Role } from "../middleware/auth.js";

export const MONITORING_PERMISSION_KEYS = [
  "monitoring:view",
  "monitoring:manage",
  "monitoring:acknowledge_alerts",
  "monitoring:execute_router_actions",
] as const;

export type MonitoringPermissionKey = (typeof MONITORING_PERMISSION_KEYS)[number];

export function defaultMonitoringPermissionsAllOn(): Record<MonitoringPermissionKey, boolean> {
  const o = {} as Record<MonitoringPermissionKey, boolean>;
  for (const k of MONITORING_PERMISSION_KEYS) o[k] = true;
  return o;
}

export function defaultMonitoringPermissionsManager(): Record<MonitoringPermissionKey, boolean> {
  return {
    "monitoring:view": true,
    "monitoring:manage": true,
    "monitoring:acknowledge_alerts": true,
    "monitoring:execute_router_actions": false,
  };
}

export function defaultMonitoringPermissionsViewer(): Record<MonitoringPermissionKey, boolean> {
  return {
    "monitoring:view": true,
    "monitoring:manage": false,
    "monitoring:acknowledge_alerts": false,
    "monitoring:execute_router_actions": false,
  };
}

export function normalizeMonitoringPermissions(
  raw: unknown,
  base: Record<MonitoringPermissionKey, boolean>
): Record<MonitoringPermissionKey, boolean> {
  const out = { ...base };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const k of MONITORING_PERMISSION_KEYS) {
    if (k in src) out[k] = Boolean(src[k]);
  }
  return out;
}

export function hasMonitoringPermission(
  role: Role | string | undefined,
  perms: Record<string, boolean> | undefined,
  key: MonitoringPermissionKey
): boolean {
  if (role === "admin") return true;
  if (role === "manager") {
    const p = normalizeMonitoringPermissions(perms ?? {}, defaultMonitoringPermissionsManager());
    return Boolean(p[key]);
  }
  if (role === "accountant" || role === "viewer") {
    const p = normalizeMonitoringPermissions(perms ?? {}, defaultMonitoringPermissionsViewer());
    return Boolean(p[key]);
  }
  return false;
}

export function requestHasMonitoringPermission(req: Request, key: MonitoringPermissionKey): boolean {
  return hasMonitoringPermission(req.auth?.role, req.auth?.permissions, key);
}
