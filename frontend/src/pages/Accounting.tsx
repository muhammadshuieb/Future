import { useEffect, useMemo, useState } from "react";
import { Activity, Database, Network, Search, UserCircle2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import { Card } from "../components/ui/Card";
import { TextField } from "../components/ui/TextField";
import { useFinancePeriod } from "../context/FinancePeriodContext";
import { getFinancePeriodMonths, inFinancePeriod } from "../lib/finance-period";
import { FinancePeriodFilter } from "../components/finance/FinancePeriodFilter";

type AccountingSummary = {
  active_sessions?: number;
  tracked_bytes_total?: number;
};

type SessionRow = {
  radacctid?: string | number;
  username?: string;
  nasipaddress?: string;
  framedipaddress?: string;
  acctstarttime?: string;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let next = value;
  let idx = 0;
  while (next >= 1024 && idx < units.length - 1) {
    next /= 1024;
    idx += 1;
  }
  return `${next.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

export function AccountingPage() {
  const { period } = useFinancePeriod();
  const periodMonthSet = useMemo(() => new Set(getFinancePeriodMonths(period)), [period]);
  const [summary, setSummary] = useState<AccountingSummary | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void (async () => {
      const [a, b] = await Promise.all([
        apiFetch("/api/accounting/summary"),
        apiFetch("/api/accounting/sessions"),
      ]);
      if (a.ok) setSummary((await a.json()) as AccountingSummary);
      if (b.ok) setSessions(((await b.json()) as { sessions?: SessionRow[] }).sessions ?? []);
    })();
  }, []);

  const sessionsInPeriod = useMemo(
    () => sessions.filter((s) => inFinancePeriod(s.acctstarttime, periodMonthSet)),
    [sessions, periodMonthSet]
  );

  const filteredSessions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return sessionsInPeriod;
    return sessionsInPeriod.filter((s) =>
      [s.username, s.nasipaddress, s.framedipaddress, s.acctstarttime]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(term))
    );
  }, [sessionsInPeriod, query]);

  const activeCountAll = Number(summary?.active_sessions ?? 0);
  const sessionsInPeriodCount = sessionsInPeriod.length;
  const trackedBytes = Number(summary?.tracked_bytes_total ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Accounting</h1>
          <p className="text-sm opacity-70">Operational RADIUS accounting visibility in one workspace.</p>
        </div>
      </div>

      <FinancePeriodFilter />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4" variant="solid">
          <div className="mb-2 flex items-center justify-between text-xs uppercase opacity-60">
            <span>Online in period</span>
            <Activity className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold">{sessionsInPeriodCount.toLocaleString()}</div>
          <div className="text-xs opacity-60">of {activeCountAll.toLocaleString()} active (session start in period)</div>
        </Card>
        <Card className="p-4" variant="solid">
          <div className="mb-2 flex items-center justify-between text-xs uppercase opacity-60">
            <span>Tracked Bytes</span>
            <Database className="h-4 w-4 text-sky-500" />
          </div>
          <div className="text-2xl font-bold">{formatBytes(trackedBytes)}</div>
          <div className="text-xs opacity-60">Live tenant total (not split by period)</div>
        </Card>
        <Card className="p-4" variant="solid">
          <div className="mb-2 flex items-center justify-between text-xs uppercase opacity-60">
            <span>Filtered View</span>
            <Network className="h-4 w-4 text-violet-500" />
          </div>
          <div className="text-2xl font-bold">{filteredSessions.length.toLocaleString()}</div>
          <div className="text-xs opacity-60">from {sessionsInPeriod.length.toLocaleString()} in period</div>
        </Card>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Online sessions</h2>
            <p className="text-xs opacity-65">Sessions whose start time falls in the selected financial period.</p>
          </div>
          <div className="w-full max-w-xs">
            <TextField
              label="Search sessions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Username, NAS, IP..."
            />
          </div>
        </div>

        <div className="max-h-[540px] overflow-auto">
          <table className="sticky-list-table w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]/70 bg-[hsl(var(--muted))]/40 uppercase tracking-wide opacity-70">
                <th className="px-3 py-3">User</th>
                <th className="px-3 py-3">NAS</th>
                <th className="px-3 py-3">Client IP</th>
                <th className="px-3 py-3">Started At</th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.slice(0, 200).map((s) => (
                <tr key={String(s.radacctid ?? `${s.username}-${s.framedipaddress}`)} className="border-b border-[hsl(var(--border))]/40">
                  <td className="px-3 py-2.5">
                    <div className="inline-flex items-center gap-2">
                      <UserCircle2 className="h-3.5 w-3.5 opacity-60" />
                      {String(s.username ?? "—")}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono">{String(s.nasipaddress ?? "—")}</td>
                  <td className="px-3 py-2.5 font-mono">{String(s.framedipaddress ?? "—")}</td>
                  <td className="px-3 py-2.5">{String(s.acctstarttime ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm opacity-65">
            <Search className="h-4 w-4" />
            No sessions match your search.
          </div>
        ) : null}
      </Card>
    </div>
  );
}
