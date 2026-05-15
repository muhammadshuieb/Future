import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch, getStaffToken, readApiError, setStaffToken } from "../lib/api";
import {
  isStaffSessionIdleExpired,
  setCachedSessionTimeoutMinutes,
  touchStaffActivity,
} from "../lib/staffSession";

type User = {
  id: string;
  name?: string | null;
  email: string;
  role: string;
  tenantId: string;
  permissions?: Record<string, boolean>;
  walletBalance?: number;
};

function parseUserFromToken(token: string | null): User | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json) as Partial<User> & {
      sub?: string;
      tenantId?: string;
      role?: string;
      email?: string;
      name?: string | null;
      permissions?: Record<string, boolean>;
      walletBalance?: number;
      exp?: number;
    };
    if (!payload.sub || !payload.tenantId || !payload.role) return null;
    const emailFromJwt =
      typeof payload.email === "string" && payload.email.trim()
        ? String(payload.email).trim()
        : typeof payload.sub === "string" && payload.sub.startsWith("rm:")
          ? `${payload.sub.slice(3)}@radius.local`
          : "";
    if (!emailFromJwt) return null;
    if (payload.exp && Date.now() >= payload.exp * 1000) return null;
    return {
      id: String(payload.sub),
      name: payload.name ?? null,
      email: emailFromJwt,
      role: String(payload.role),
      tenantId: String(payload.tenantId),
      permissions: payload.permissions,
      walletBalance: payload.walletBalance,
    };
  } catch {
    return null;
  }
}

const Ctx = createContext<{
  user: User | null;
  setUser: (u: User | null) => void;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; status: number; detail: string }>;
  logout: () => void;
} | null>(null);

function resolveInitialUser(): User | null {
  const tok = getStaffToken();
  if (!tok) return null;
  if (isStaffSessionIdleExpired()) {
    setStaffToken(null);
    return null;
  }
  return parseUserFromToken(tok);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => resolveInitialUser());

  useEffect(() => {
    const tok = getStaffToken();
    if (!tok) return;
    if (!parseUserFromToken(tok) || isStaffSessionIdleExpired()) {
      setStaffToken(null);
      setUser(null);
      return;
    }
    touchStaffActivity();
    void (async () => {
      try {
        const r = await apiFetch("/api/system-settings");
        if (!r.ok) return;
        const j = (await r.json()) as { settings?: { admin_session_timeout_minutes?: number } };
        const raw = j.settings?.admin_session_timeout_minutes;
        const n = Number(raw);
        if ([5, 10, 15, 30, 60].includes(n)) setCachedSessionTimeoutMinutes(n);
        if (isStaffSessionIdleExpired()) {
          setStaffToken(null);
          setUser(null);
        }
      } catch {
        /* keep cached timeout */
      }
    })();
  }, []);

  async function login(
    email: string,
    password: string
  ): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
    const r = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    });
    if (!r.ok) {
      const detail = await readApiError(r);
      return { ok: false, status: r.status, detail };
    }
    const data = (await r.json()) as { token: string; user: User };
    setStaffToken(data.token);
    setUser(data.user);
    return { ok: true };
  }

  function logout() {
    setStaffToken(null);
    setUser(null);
  }

  return <Ctx.Provider value={{ user, setUser, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
