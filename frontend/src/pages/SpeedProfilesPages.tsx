import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gauge, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField, SelectField } from "../components/ui/TextField";
import { ActionDialog } from "../components/ui/ActionDialog";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { canViewSpeedProfiles, canManageSpeedProfiles } from "../lib/permissions";
import { cn } from "../lib/utils";

type ProfileRow = Record<string, unknown>;

export function SpeedProfilesPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canView = canViewSpeedProfiles(user?.role, user?.permissions);
  const canManage = canManageSpeedProfiles(user?.role, user?.permissions);
  const [items, setItems] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [dl, setDl] = useState("10M");
  const [ul, setUl] = useState("2M");
  const [bdl, setBdl] = useState("");
  const [bul, setBul] = useState("");
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("/api/speed-profiles");
      if (!r.ok) {
        setError(formatStaffApiError(r.status, await readApiError(r), t));
        return;
      }
      const j = (await r.json()) as { items: ProfileRow[] };
      setItems(j.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [canView, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) {
    return <p className="text-sm opacity-70">{t("speed.forbidden")}</p>;
  }

  async function onCreate() {
    if (!canManage || !name.trim()) return;
    setBusy(true);
    try {
      const r = await apiFetch("/api/speed-profiles", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          download_rate: dl,
          upload_rate: ul,
          burst_download_rate: bdl.trim() || null,
          burst_upload_rate: bul.trim() || null,
          is_active: true,
        }),
      });
      if (!r.ok) {
        setError(formatStaffApiError(r.status, await readApiError(r), t));
        return;
      }
      setCreateOpen(false);
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!canManage) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/speed-profiles/${id}`, { method: "DELETE" });
      if (!r.ok) {
        setError(formatStaffApiError(r.status, await readApiError(r), t));
        return;
      }
      setDelId(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Gauge className="h-7 w-7 text-[hsl(var(--primary))]" />
            {t("speed.profilesTitle")}
          </h1>
          <p className="mt-1 text-sm opacity-70">{t("speed.profilesSubtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2", loading && "animate-spin")} />
            {t("common.refresh")}
          </Button>
          {canManage ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
              {t("speed.createProfile")}
            </Button>
          ) : null}
          <Link
            to="/speed-profiles/schedules"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/40 px-4 py-2 text-sm font-medium backdrop-blur transition-all hover:bg-[hsl(var(--muted))]/60"
          >
            {t("speed.schedulesLink")}
          </Link>
          <Link
            to="/speed-profiles/live"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/40 px-4 py-2 text-sm font-medium backdrop-blur transition-all hover:bg-[hsl(var(--muted))]/60"
          >
            {t("speed.liveLink")}
          </Link>
        </div>
      </div>
      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}
      <Card className="overflow-x-auto">
        {loading ? (
          <p className="p-4 text-sm opacity-70">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm opacity-70">{t("speed.emptyProfiles")}</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] text-start text-xs opacity-70">
                <th className="px-3 py-2">{t("speed.colName")}</th>
                <th className="px-3 py-2">{t("speed.colMikrotik")}</th>
                <th className="px-3 py-2">{t("speed.colDefault")}</th>
                <th className="px-3 py-2 w-24">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={String(row.id)} className="border-b border-[hsl(var(--border))]/60">
                  <td className="px-3 py-2 font-medium">{String(row.name ?? "")}</td>
                  <td className="px-3 py-2 font-mono text-xs break-all">{String(row.mikrotik_rate_limit_value ?? "")}</td>
                  <td className="px-3 py-2">{Number(row.is_default) === 1 ? t("common.yes") : "—"}</td>
                  <td className="px-3 py-2">
                    {canManage ? (
                      <Button type="button" variant="ghost" aria-label={t("common.delete")} onClick={() => setDelId(String(row.id))}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {createOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="presentation">
          <Card className="w-full max-w-md space-y-3 p-4">
            <div className="flex items-center gap-2 font-semibold">
              <Zap className="h-5 w-5" />
              {t("speed.createProfile")}
            </div>
            <TextField label={t("speed.colName")} value={name} onChange={(e) => setName(e.target.value)} />
            <TextField label={t("speed.download")} value={dl} onChange={(e) => setDl(e.target.value)} />
            <TextField label={t("speed.upload")} value={ul} onChange={(e) => setUl(e.target.value)} />
            <TextField label={t("speed.burstDl")} value={bdl} onChange={(e) => setBdl(e.target.value)} />
            <TextField label={t("speed.burstUl")} value={bul} onChange={(e) => setBul(e.target.value)} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" disabled={busy || !name.trim()} onClick={() => void onCreate()}>
                {busy ? t("common.loading") : t("common.save")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <ActionDialog
        open={Boolean(delId)}
        title={t("common.delete")}
        message={t("speed.deleteProfileConfirm")}
        variant="danger"
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId) void onDelete(delId);
        }}
      />
    </div>
  );
}

export function SpeedProfileSchedulesPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canView = canViewSpeedProfiles(user?.role, user?.permissions);
  const canManage = Boolean(user?.role === "admin" || user?.permissions?.manage_speed_schedules);
  const [items, setItems] = useState<ProfileRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState("package");
  const [targetId, setTargetId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [timeStart, setTimeStart] = useState("00:00");
  const [timeEnd, setTimeEnd] = useState("06:00");
  const [days, setDays] = useState("0,1,2,3,4,5,6");
  const [priority, setPriority] = useState("100");

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [r1, r2] = await Promise.all([apiFetch("/api/speed-profiles/schedules"), apiFetch("/api/speed-profiles")]);
      if (r1.ok) setItems(((await r1.json()) as { items: ProfileRow[] }).items ?? []);
      if (r2.ok) setProfiles(((await r2.json()) as { items: ProfileRow[] }).items ?? []);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) return <p className="text-sm opacity-70">{t("speed.forbidden")}</p>;

  async function submitSchedule() {
    if (!canManage || !name.trim() || !profileId) return;
    setBusy(true);
    try {
      const dayParts = days
        .split(",")
        .map((x) => parseInt(x.trim(), 10))
        .filter((n) => n >= 0 && n <= 6);
      const r = await apiFetch("/api/speed-profiles/schedules", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          target_type: targetType,
          target_id: targetId.trim() || null,
          speed_profile_id: profileId,
          time_start: timeStart,
          time_end: timeEnd,
          days_of_week: dayParts.length ? dayParts : null,
          priority: parseInt(priority, 10) || 100,
          repeat_mode: "daily",
          condition_type: "always",
          timezone: "Asia/Riyadh",
        }),
      });
      if (!r.ok) {
        setError(formatStaffApiError(r.status, await readApiError(r), t));
        return;
      }
      setFormOpen(false);
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("speed.schedulesTitle")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("speed.schedulesSubtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
            {t("common.refresh")}
          </Button>
          {canManage ? (
            <Button type="button" onClick={() => setFormOpen(true)}>
              <Plus className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
              {t("speed.addSchedule")}
            </Button>
          ) : null}
          <Link
            to="/speed-profiles"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/40 px-4 py-2 text-sm font-medium backdrop-blur transition-all hover:bg-[hsl(var(--muted))]/60"
          >
            {t("speed.backProfiles")}
          </Link>
        </div>
      </div>
      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm">{error}</div>
      ) : null}
      <Card className="overflow-x-auto">
        {loading ? (
          <p className="p-4 text-sm opacity-70">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm opacity-70">{t("speed.emptySchedules")}</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] text-start text-xs opacity-70">
                <th className="px-3 py-2">{t("speed.colName")}</th>
                <th className="px-3 py-2">{t("speed.colTarget")}</th>
                <th className="px-3 py-2">{t("speed.colTime")}</th>
                <th className="px-3 py-2">{t("speed.colPriority")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={String(row.id)} className="border-b border-[hsl(var(--border))]/60">
                  <td className="px-3 py-2">{String(row.name ?? "")}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {String(row.target_type ?? "")} {row.target_id ? `· ${String(row.target_id).slice(0, 8)}…` : ""}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {String(row.time_start ?? "")} → {String(row.time_end ?? "")}
                  </td>
                  <td className="px-3 py-2">{String(row.priority ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {formOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-lg space-y-3 p-4">
            <TextField label={t("speed.colName")} value={name} onChange={(e) => setName(e.target.value)} />
            <SelectField label={t("speed.colTarget")} value={targetType} onChange={(e) => setTargetType(e.target.value)}>
              <option value="package">package</option>
              <option value="subscriber">subscriber</option>
              <option value="reseller">reseller</option>
              <option value="branch">branch</option>
              <option value="tenant">tenant</option>
            </SelectField>
            <TextField label={t("speed.targetId")} value={targetId} onChange={(e) => setTargetId(e.target.value)} />
            <SelectField label={t("speed.speedProfile")} value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">—</option>
              {profiles.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {String(p.name)}
                </option>
              ))}
            </SelectField>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t("speed.timeStart")} value={timeStart} onChange={(e) => setTimeStart(e.target.value)} />
              <TextField label={t("speed.timeEnd")} value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} />
            </div>
            <TextField label={t("speed.daysCsv")} value={days} onChange={(e) => setDays(e.target.value)} />
            <TextField label={t("speed.colPriority")} value={priority} onChange={(e) => setPriority(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void submitSchedule()}>
                {busy ? t("common.loading") : t("common.save")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

export function SpeedProfilesLivePage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canView = canViewSpeedProfiles(user?.role, user?.permissions);
  const canManage = Boolean(user?.role === "admin" || user?.permissions?.manage_speed_schedules);
  const [dash, setDash] = useState<{
    boosted: ProfileRow[];
    activeSchedules: ProfileRow[];
    recentLogs: ProfileRow[];
    failedCoa: ProfileRow[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const r = await apiFetch("/api/speed-profiles/live/summary");
      if (r.ok) {
        setDash(await r.json());
      } else setDash(null);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyNow() {
    if (!canManage) return;
    setBusy(true);
    try {
      await apiFetch("/api/speed-profiles/apply-now", { method: "POST", body: JSON.stringify({}) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!canView) return <p className="text-sm opacity-70">{t("speed.forbidden")}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("speed.liveTitle")}</h1>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
            {t("common.refresh")}
          </Button>
          {canManage ? (
            <Button type="button" disabled={busy} onClick={() => void applyNow()}>
              {t("speed.applyNow")}
            </Button>
          ) : null}
          <Link
            to="/speed-profiles"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/40 px-4 py-2 text-sm font-medium backdrop-blur transition-all hover:bg-[hsl(var(--muted))]/60"
          >
            {t("speed.backProfiles")}
          </Link>
        </div>
      </div>
      {loading ? (
        <p className="text-sm opacity-70">{t("common.loading")}</p>
      ) : !dash ? (
        <p className="text-sm opacity-70">{t("speed.liveEmpty")}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-2 p-4">
            <h2 className="font-semibold">{t("speed.liveBoosted")}</h2>
            {dash.boosted.length === 0 ? (
              <p className="text-sm opacity-70">{t("common.none")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {dash.boosted.map((b) => (
                  <li key={String(b.id)}>
                    {String(b.username)} — {String(b.profile_name ?? "")}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="font-semibold">{t("speed.liveActiveSchedules")}</h2>
            {dash.activeSchedules.length === 0 ? (
              <p className="text-sm opacity-70">{t("common.none")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {dash.activeSchedules.map((s) => (
                  <li key={String(s.id)}>{String(s.name)}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="space-y-2 p-4 lg:col-span-2">
            <h2 className="font-semibold">{t("speed.liveCoaIssues")}</h2>
            {dash.failedCoa.length === 0 ? (
              <p className="text-sm opacity-70">{t("speed.noCoaFailures")}</p>
            ) : (
              <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
                {dash.failedCoa.map((l) => (
                  <li key={String(l.id)}>
                    {String(l.username ?? l.subscriber_id)} — {String(l.coa_message ?? "")}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
