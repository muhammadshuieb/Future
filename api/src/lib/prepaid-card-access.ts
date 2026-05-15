/**
 * Central prepaid card access rules (mirrors subscriber-access-guard for rm_cards).
 */

export type PrepaidCardLifecycleStatus = "available" | "active" | "consumed" | "expired" | "disabled";

export type PrepaidCardAccessRow = {
  lifecycle_status: string | null;
  active: number | boolean | null;
  revoked: number | boolean | null;
  expiration: string | Date | null;
  total_limit_mb: number | null;
  used_bytes: number | bigint | string | null;
  used_seconds: number | bigint | string | null;
  online_time_limit: number | null;
  available_time_from_activation: number | null;
  first_used_at: Date | string | null;
};

export type PrepaidDenyReason =
  | "disabled"
  | "calendar_expired"
  | "quota_exceeded"
  | "online_time_exceeded"
  | "activation_window_expired"
  | "consumed"
  | "expired";

export const PREPAID_REPLY_MESSAGES: Record<PrepaidDenyReason, string> = {
  disabled: "البطاقة معطّلة",
  calendar_expired: "البطاقة منتهية",
  quota_exceeded: "انتهت كمية البيانات",
  online_time_exceeded: "انتهت مدة الاستخدام",
  activation_window_expired: "تم استهلاك البطاقة",
  consumed: "تم استهلاك البطاقة",
  expired: "البطاقة منتهية",
};

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isDisabled(row: PrepaidCardAccessRow): boolean {
  const st = String(row.lifecycle_status ?? "")
    .trim()
    .toLowerCase();
  if (st === "disabled" || st === "consumed" || st === "expired") return true;
  return Number(row.active ?? 1) === 0 || Number(row.revoked ?? 0) === 1;
}

/** Calendar expiry: expiration date is strictly before today (DATE column). */
export function isPrepaidCardCalendarExpired(expiration: string | Date | null | undefined): boolean {
  if (expiration == null || String(expiration).trim() === "") return false;
  const expDay = String(expiration).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expDay)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return expDay < today;
}

export function prepaidQuotaBytes(totalLimitMb: number): number {
  const mb = Math.max(0, Math.floor(totalLimitMb));
  if (mb <= 0) return 0;
  return mb * 1024 * 1024;
}

export function evaluatePrepaidCardAccessFromRow(
  row: PrepaidCardAccessRow,
  now: Date = new Date()
): { ok: true } | { ok: false; reason: PrepaidDenyReason; message: string } {
  if (isDisabled(row)) {
    const st = String(row.lifecycle_status ?? "").toLowerCase();
    if (st === "consumed") {
      return { ok: false, reason: "consumed", message: PREPAID_REPLY_MESSAGES.consumed };
    }
    if (st === "expired") {
      return { ok: false, reason: "expired", message: PREPAID_REPLY_MESSAGES.expired };
    }
    return { ok: false, reason: "disabled", message: PREPAID_REPLY_MESSAGES.disabled };
  }

  if (isPrepaidCardCalendarExpired(row.expiration)) {
    return { ok: false, reason: "calendar_expired", message: PREPAID_REPLY_MESSAGES.calendar_expired };
  }

  const quotaB = prepaidQuotaBytes(num(row.total_limit_mb));
  const usedB = num(row.used_bytes);
  if (quotaB > 0 && usedB >= quotaB) {
    return { ok: false, reason: "quota_exceeded", message: PREPAID_REPLY_MESSAGES.quota_exceeded };
  }

  const onlineLimitMin = num(row.online_time_limit);
  const usedSec = num(row.used_seconds);
  if (onlineLimitMin > 0 && usedSec >= onlineLimitMin * 60) {
    return {
      ok: false,
      reason: "online_time_exceeded",
      message: PREPAID_REPLY_MESSAGES.online_time_exceeded,
    };
  }

  const activationWindowMin = num(row.available_time_from_activation);
  if (activationWindowMin > 0 && row.first_used_at != null && String(row.first_used_at).trim() !== "") {
    const first = new Date(row.first_used_at as string);
    if (!Number.isNaN(first.getTime())) {
      const deadline = first.getTime() + activationWindowMin * 60 * 1000;
      if (now.getTime() >= deadline) {
        return {
          ok: false,
          reason: "activation_window_expired",
          message: PREPAID_REPLY_MESSAGES.activation_window_expired,
        };
      }
    }
  }

  return { ok: true };
}

export function lifecycleStatusForTerminateReason(
  reason: PrepaidDenyReason
): PrepaidCardLifecycleStatus {
  switch (reason) {
    case "quota_exceeded":
    case "activation_window_expired":
    case "consumed":
      return "consumed";
    case "calendar_expired":
    case "expired":
      return "expired";
    default:
      return "disabled";
  }
}
