import { createContext, useContext, useState, type ReactNode } from "react";
import { apiFetch, getStaffToken, setStaffToken } from "../lib/api";

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
    if (!payload.sub || !payload.tenantId || !payload.role || !payload.email) return null;
    if (payload.exp && Date.now() >= payload.exp * 1000) return null;
    return {
      id: String(payload.sub),
      name: payload.name ?? null,
      email: String(payload.email),
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
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const fromToken = parseUserFromToken(getStaffToken());
    if (!fromToken) {
      setStaffToken(null);
      return null;
    }
    return fromToken;
  });

  async function login(email: string, password: string) {
    const r = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    });
    if (!r.ok) throw new Error("Login failed");
    const data = (await r.json()) as { token: string; user: User };
    setStaffToken(data.token);
    setUser(data.user);
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
