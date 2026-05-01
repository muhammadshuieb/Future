import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, GitBranch } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ActionDialog } from "../components/ui/ActionDialog";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/LocaleContext";

type UpdateStatus = {
  updateEnabled: boolean;
  envUpdateEnabled?: boolean;
  runtimeUpdateEnabled?: boolean | null;
  configuredRemote: string;
  configuredBranch: string;
  currentBranch: string;
  currentCommit: string;
  currentCommitDate?: string | null;
  lastCheckedAt?: string | null;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  remoteCommit?: string | null;
  remoteCommitDate?: string | null;
  repoDir: string;
};

type CheckResult = {
  updateAvailable: boolean;
  localCommit: string;
  remoteCommit: string;
  remote: string;
  branch: string;
  remoteCommitDate?: string | null;
};

export function UpdatesPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const canAccessUpdates = user?.role === "admin" || user?.role === "manager";
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [confirmUpdateOpen, setConfirmUpdateOpen] = useState(false);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/maintenance/updates/status");
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      const json = (await res.json()) as UpdateStatus;
      setStatus(json);
    } finally {
      setLoading(false);
    }
  }

  async function checkUpdates() {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/updates/check", { method: "POST", body: "{}" });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      const json = (await res.json()) as CheckResult;
      setCheck(json);
      setInfo(json.updateAvailable ? t("updates.available") : t("updates.none"));
    } finally {
      setLoading(false);
    }
  }

  async function runUpdate() {
    setConfirmUpdateOpen(true);
  }

  async function confirmRunUpdate() {
    setConfirmUpdateOpen(false);
    setRunning(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/updates/run", {
        method: "POST",
        body: "{}",
      });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      const payload = (await res.json()) as {
        changed: boolean;
        beforeCommit: string;
        afterCommit: string;
        note?: string;
        composeEnabled?: boolean;
      };
      const base = payload.changed
        ? `${t("updates.done")} (${payload.beforeCommit.slice(0, 8)} -> ${payload.afterCommit.slice(0, 8)})`
        : t("updates.noChange");
      const composeMsg = payload.composeEnabled ? t("updates.composeAutoDone") : payload.note ?? "";
      setInfo([base, composeMsg].filter(Boolean).join(" — "));
      await loadStatus();
      await checkUpdates();
    } finally {
      setRunning(false);
    }
  }

  async function setFeatureEnabled(enabled: boolean) {
    setToggling(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/updates/feature", {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      setInfo(enabled ? t("updates.featureEnabled") : t("updates.featureDisabled"));
      await loadStatus();
    } finally {
      setToggling(false);
    }
  }

  useEffect(() => {
    if (!canAccessUpdates) return;
    void loadStatus();
    void checkUpdates();
  }, [canAccessUpdates]);

  if (!canAccessUpdates) {
    return <p className="text-sm opacity-70">{t("api.error_403")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("updates.title")}</h1>
          <p className="text-sm opacity-70">{t("updates.subtitle")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void loadStatus()} disabled={loading}>
          <RefreshCw className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("common.refresh")}
        </Button>
      </div>

      {info ? <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{info}</div> : null}
      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div> : null}

      <Card className="space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <GitBranch className="h-4 w-4" />
          {t("updates.currentState")}
        </div>
        <div className="text-sm opacity-85">
          <div className="mb-2 flex items-center gap-2">
            <input
              id="update-feature-toggle"
              type="checkbox"
              checked={Boolean(status?.updateEnabled)}
              disabled={toggling}
              onChange={(e) => void setFeatureEnabled(e.target.checked)}
            />
            <label htmlFor="update-feature-toggle" className="cursor-pointer">
              {t("updates.featureToggle")}
            </label>
          </div>
          <p>{t("updates.branch")}: {status?.currentBranch ?? "-"}</p>
          <p>{t("updates.commit")}: <code>{status?.currentCommit?.slice(0, 12) ?? "-"}</code></p>
          <p>{t("updates.remote")}: {status?.configuredRemote ?? "-"}</p>
          <p>{t("updates.trackBranch")}: {status?.configuredBranch ?? "-"}</p>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4" />
          {t("updates.runTitle")}
        </div>
        <p className="text-sm opacity-80">{t("updates.tokenHint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void checkUpdates()} disabled={loading}>
            {t("updates.check")}
          </Button>
          <Button
            type="button"
            onClick={() => void runUpdate()}
            disabled={running || !status?.updateEnabled}
          >
            {running ? t("common.loading") : t("updates.run")}
          </Button>
        </div>
        {!status?.updateEnabled ? <p className="text-xs text-amber-300">{t("updates.disabled")}</p> : null}
        {check ? (
          <p className="text-sm opacity-80">
            {check.updateAvailable ? t("updates.available") : t("updates.none")} ({check.localCommit.slice(0, 8)} /{" "}
            {check.remoteCommit.slice(0, 8) || "?"})
          </p>
        ) : null}
        <p className="text-xs opacity-70">
          Current commit date: {status?.currentCommitDate || "-"} | Remote commit date: {check?.remoteCommitDate || status?.remoteCommitDate || "-"}
        </p>
        <p className="text-xs opacity-70">
          Last check: {status?.lastCheckedAt || "-"} | Last run: {status?.lastRunAt || "-"} | Last result: {status?.lastStatus || "-"}
        </p>
      </Card>
      <ActionDialog
        open={confirmUpdateOpen}
        title={t("updates.run")}
        message={t("updates.confirm")}
        variant="warning"
        confirmLabel={t("updates.run")}
        cancelLabel={t("common.cancel")}
        onClose={() => setConfirmUpdateOpen(false)}
        onConfirm={() => {
          void confirmRunUpdate();
        }}
      />
    </div>
  );
}
