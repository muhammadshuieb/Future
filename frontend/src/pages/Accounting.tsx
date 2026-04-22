import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { Card } from "../components/ui/Card";

export function AccountingPage() {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [sessions, setSessions] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    void (async () => {
      const [a, b] = await Promise.all([
        apiFetch("/api/accounting/summary"),
        apiFetch("/api/accounting/sessions"),
      ]);
      if (a.ok) setSummary(await a.json());
      if (b.ok) setSessions(((await b.json()) as { sessions: typeof sessions }).sessions);
    })();
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Accounting</h1>
      {summary && (
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase opacity-60">Active sessions</div>
              <div className="text-2xl font-bold">{String(summary.active_sessions)}</div>
            </div>
            <div>
              <div className="text-xs uppercase opacity-60">Tracked bytes (tenant)</div>
              <div className="text-2xl font-bold">{String(summary.tracked_bytes_total)}</div>
            </div>
          </div>
        </Card>
      )}
      <Card className="max-h-[480px] overflow-auto">
        <h2 className="mb-2 font-semibold">Online sessions</h2>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="opacity-60">
              <th className="pb-2">User</th>
              <th className="pb-2">NAS</th>
              <th className="pb-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {sessions.slice(0, 100).map((s) => (
              <tr key={String(s.radacctid)} className="border-t border-[hsl(var(--border))]/40">
                <td className="py-1">{String(s.username)}</td>
                <td className="py-1">{String(s.nasipaddress)}</td>
                <td className="py-1">{String(s.framedipaddress)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
