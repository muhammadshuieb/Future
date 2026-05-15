const STAFF_TOKEN_KEY = "fr_staff_token";
const LAST_ACTIVITY_KEY = "fr_staff_last_activity";
const TIMEOUT_MIN_KEY = "fr_staff_session_timeout_min";

const ALLOWED_TIMEOUTS = [5, 10, 15, 30, 60] as const;
const DEFAULT_TIMEOUT_MIN = 5;

export function getCachedSessionTimeoutMinutes(): number {
  const n = Number(localStorage.getItem(TIMEOUT_MIN_KEY));
  if (ALLOWED_TIMEOUTS.includes(n as (typeof ALLOWED_TIMEOUTS)[number])) return n;
  return DEFAULT_TIMEOUT_MIN;
}

export function setCachedSessionTimeoutMinutes(minutes: number) {
  const n = Number(minutes);
  if (ALLOWED_TIMEOUTS.includes(n as (typeof ALLOWED_TIMEOUTS)[number])) {
    localStorage.setItem(TIMEOUT_MIN_KEY, String(n));
  }
}

function hasStaffToken() {
  return Boolean(localStorage.getItem(STAFF_TOKEN_KEY));
}

export function touchStaffActivity() {
  if (hasStaffToken()) {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  }
}

export function clearStaffActivity() {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
}

function lastActivityFromJwt(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { iat?: number };
    if (payload.iat && Number.isFinite(payload.iat)) return payload.iat * 1000;
  } catch {
    /* ignore */
  }
  return null;
}

function getLastActivityMs(token: string): number | null {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return lastActivityFromJwt(token);
}

/** True when staff token exists but idle time exceeds configured admin session timeout. */
export function isStaffSessionIdleExpired(): boolean {
  const token = localStorage.getItem(STAFF_TOKEN_KEY);
  if (!token) return false;
  const last = getLastActivityMs(token);
  if (last === null) return true;
  const timeoutMs = getCachedSessionTimeoutMinutes() * 60_000;
  return Date.now() - last > timeoutMs;
}
