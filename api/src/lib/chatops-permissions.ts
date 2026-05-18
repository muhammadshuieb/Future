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

export function defaultChatOpsPermissionsAllOn(): Record<ChatOpsPermissionKey, boolean> {
  return {
    "chatops:use": true,
    "chatops:view_subscriber": true,
    "chatops:create_subscriber": true,
    "chatops:renew_subscriber": true,
    "chatops:disconnect_user": true,
    "chatops:view_finance": true,
    "chatops:print_prepaid_cards": true,
    "chatops:view_monitoring": true,
    "chatops:execute_router_actions": true,
  };
}

export function defaultChatOpsPermissionsManager(): Record<ChatOpsPermissionKey, boolean> {
  return {
    "chatops:use": true,
    "chatops:view_subscriber": true,
    "chatops:create_subscriber": true,
    "chatops:renew_subscriber": true,
    "chatops:disconnect_user": true,
    "chatops:view_finance": true,
    "chatops:print_prepaid_cards": true,
    "chatops:view_monitoring": true,
    "chatops:execute_router_actions": false,
  };
}

export function normalizeChatOpsPermissions(input: unknown): Record<ChatOpsPermissionKey, boolean> {
  const base = defaultChatOpsPermissionsManager();
  if (!input || typeof input !== "object") return base;
  const src = input as Record<string, unknown>;
  for (const key of CHATOPS_PERMISSION_KEYS) {
    if (key in src) base[key] = Boolean(src[key]);
  }
  return base;
}

export type ChatOpsStaffContext = {
  role: string;
  permissions: Record<string, boolean>;
};

export function hasChatOpsPermission(
  ctx: ChatOpsStaffContext,
  key: ChatOpsPermissionKey
): boolean {
  if (ctx.role === "admin") return true;
  if (ctx.role !== "manager" && ctx.role !== "accountant" && ctx.role !== "viewer") return false;
  if (key === "chatops:use") {
    return Boolean(ctx.permissions["chatops:use"]);
  }
  if (!ctx.permissions["chatops:use"]) return false;
  return Boolean(ctx.permissions[key]);
}
