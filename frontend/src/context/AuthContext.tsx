import { createContext, useContext, useState, type ReactNode } from "react";
import { apiFetch, setStaffToken } from "../lib/api";

type User = {
  id: string;
  name?: string | null;
  email: string;
  role: string;
  tenantId: string;
  permissions?: Record<string, boolean>;
  walletBalance?: number;
};

const Ctx = createContext<{
  user: User | null;
  setUser: (u: User | null) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

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
