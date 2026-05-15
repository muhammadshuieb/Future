import type { SubscriberAccessRow } from "./subscriber-access-guard.js";
import { evaluateSubscriberAccessFromRow } from "./subscriber-access-guard.js";
import { subscriberNasAllowedForPackage } from "./package-access-scope.js";

export function resolveRadiusSyncDenyReason(
  access: SubscriberAccessRow & {
    credential_password?: string | null;
    package_id?: string | null;
    nas_server_id?: string | null;
    package_allowed_nas_ids?: unknown;
  },
  allTenantNasIds?: string[]
): string | null {
  const password = String(access.credential_password ?? "").trim();
  if (!password) return "missing_password";
  const gate = evaluateSubscriberAccessFromRow(access);
  if (!gate.ok) return gate.reason;
  const nasOk =
    !access.package_id ||
    subscriberNasAllowedForPackage(
      access.nas_server_id,
      access.package_allowed_nas_ids,
      allTenantNasIds
    );
  if (!nasOk) return "nas_not_allowed_for_package";
  return null;
}
