import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { userApiFetch, setUserToken } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useNavigate } from "react-router-dom";

export function UserPortalLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await userApiFetch("/api/user/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      setErr("Invalid credentials");
      return;
    }
    const data = (await r.json()) as { token: string };
    setUserToken(data.token);
    nav("/user/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] p-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Card>
          <h1 className="text-xl font-bold">Subscriber portal</h1>
          <p className="mb-4 text-sm opacity-70">Sign in with your RADIUS username and password</p>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <input
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              type="password"
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {err && <p className="text-sm text-red-500">{err}</p>}
            <Button type="submit">Sign in</Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}

export function UserPortalDashboard() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    void (async () => {
      const r = await userApiFetch("/api/user/me");
      if (!r.ok) {
        nav("/user/login", { replace: true });
        return;
      }
      setData(await r.json());
    })();
  }, [nav]);

  if (!data) return <p className="p-6 opacity-70">Loading…</p>;

  const sub = data.subscriber as Record<string, unknown>;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-bold">My service</h1>
      <Card>
        <dl className="space-2 text-sm">
          <div>
            <dt className="text-xs opacity-60">Speed profile</dt>
            <dd>{String(sub?.mikrotik_rate_limit ?? "—")}</dd>
          </div>
          <div>
            <dt className="text-xs opacity-60">Expiry</dt>
            <dd>{String(sub?.expiration_date ?? "—")}</dd>
          </div>
          <div>
            <dt className="text-xs opacity-60">Usage / quota (bytes)</dt>
            <dd>
              {String(data.usage_bytes)} / {String(data.quota_bytes)}{" "}
              {data.remaining_bytes != null ? `(remaining ${String(data.remaining_bytes)})` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs opacity-60">Current IP</dt>
            <dd>{String(data.current_ip ?? "—")}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
