import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, getStaffToken, setStaffToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const ALLOWED_TIMEOUTS = [5, 10, 15, 30, 60] as const;
const DEFAULT_TIMEOUT_MIN = 30;
const WARN_BEFORE_MS = 60_000;

type SystemSettingsSlice = {
  admin_session_timeout_minutes?: number;
};

function normalizeTimeoutMinutes(raw: unknown): number {
  const n = Number(raw);
  if (ALLOWED_TIMEOUTS.includes(n as (typeof ALLOWED_TIMEOUTS)[number])) return n;
  return DEFAULT_TIMEOUT_MIN;
}

/**
 * Logs staff out after configured inactivity. Resets on pointer, keyboard, scroll, and API calls.
 */
export function useAdminInactivityLogout(enabled: boolean) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const timeoutMsRef = useRef(DEFAULT_TIMEOUT_MIN * 60_000);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    timerRef.current = null;
    warnTimerRef.current = null;
    warnedRef.current = false;
  }, []);

  const doLogout = useCallback(() => {
    clearTimers();
    setStaffToken(null);
    logout();
    navigate("/login", { replace: true });
  }, [clearTimers, logout, navigate]);

  const scheduleLogout = useCallback(() => {
    clearTimers();
    const total = timeoutMsRef.current;
    const warnAt = Math.max(0, total - WARN_BEFORE_MS);
    if (warnAt > 0 && total > WARN_BEFORE_MS) {
      warnTimerRef.current = setTimeout(() => {
        if (!warnedRef.current) {
          warnedRef.current = true;
          window.alert("ستنتهي جلستك خلال دقيقة بسبب عدم النشاط. حرّك الماوس أو اضغط مفتاحاً للبقاء متصلاً.");
        }
      }, warnAt);
    }
    timerRef.current = setTimeout(() => {
      doLogout();
    }, total);
  }, [clearTimers, doLogout]);

  const resetActivity = useCallback(() => {
    if (!enabled || !getStaffToken()) return;
    scheduleLogout();
  }, [enabled, scheduleLogout]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await apiFetch("/api/system-settings");
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as { settings?: SystemSettingsSlice };
        timeoutMsRef.current = normalizeTimeoutMinutes(j.settings?.admin_session_timeout_minutes) * 60_000;
        resetActivity();
      } catch {
        timeoutMsRef.current = DEFAULT_TIMEOUT_MIN * 60_000;
        resetActivity();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, resetActivity]);

  useEffect(() => {
    if (!enabled) return;
    const events = ["mousedown", "keydown", "touchstart", "scroll", "click"] as const;
    const onActivity = () => resetActivity();
    for (const ev of events) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    const origFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (getStaffToken()) resetActivity();
      return origFetch(input, init);
    }) as typeof window.fetch;
    resetActivity();
    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, onActivity);
      }
      window.fetch = origFetch;
      clearTimers();
    };
  }, [enabled, resetActivity, clearTimers]);
}
