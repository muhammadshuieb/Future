import { useEffect, useState, useRef } from "react";
import { RefreshCw, ShieldCheck, GitBranch } from "lucide-react";
import {
  apiFetch,
  readApiError,
  streamMaintenanceUpdateRun,
  formatMaintenanceUpdateSseError,
} from "../lib/api";
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
  updateInProgress?: boolean;
  lastError?: { timestamp: string; message: string } | null;
};

type CheckResult = {
  updateAvailable: boolean;
  localCommit: string;
  remoteCommit?: string | null;
  remote: string;
  branch: string;
  remoteCommitDate?: string | null;
};

type UpdateLogRow = {
  type: string;
  data: unknown;
  timestamp?: string;
};

function formatLogLine(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

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
  const [logs, setLogs] = useState<UpdateLogRow[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const runAbortRef = useRef<AbortController | null>(null);

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

  function runUpdate() {
    setConfirmUpdateOpen(true);
  }

  function confirmRunUpdate() {
    setConfirmUpdateOpen(false);
    setRunning(true);
    setError(null);
    setInfo(null);
    setLogs([]);
    setShowLogs(true);

    runAbortRef.current?.abort();
    const ctrl = new AbortController();
    runAbortRef.current = ctrl;

    let sawTerminal = false;

    void (async () => {
      try {
        const result = await streamMaintenanceUpdateRun("/api/maintenance/updates/run", (parsed) => {
          if (parsed.type === "complete") {
            sawTerminal = true;
            const d = parsed.data as { changed?: boolean; beforeCommit?: string; afterCommit?: string };
            const before = (d?.beforeCommit ?? "").slice(0, 8);
            const after = (d?.afterCommit ?? "").slice(0, 8);
            const base = d?.changed ? `${t("updates.done")} (${before} -> ${after})` : t("updates.noChange");
            setInfo(base);
            setLogs((prev) => [...prev, parsed]);
            void loadStatus();
            void checkUpdates();
          } else if (parsed.type === "error") {
            sawTerminal = true;
            const msg = formatMaintenanceUpdateSseError(parsed.data) || t("updates.unknownError");
            setError(msg);
            setLogs((prev) => [...prev, parsed]);
          } else if (parsed.type === "step") {
            const d = parsed.data as { msg?: string };
            const stepMsg = `$ ${d?.msg ?? ""}`;
            setLogs((prev) => [...prev, { ...parsed, data: stepMsg }]);
          } else if (parsed.type === "output") {
            setLogs((prev) => [...prev, parsed]);
          }
        }, { signal: ctrl.signal });

        if (ctrl.signal.aborted) return;

        if (!result.ok) {
          setError(result.error);
        } else if (!sawTerminal) {
          setError(t("updates.streamIncomplete"));
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (runAbortRef.current === ctrl) runAbortRef.current = null;
        setRunning(false);
      }
    })();
  }

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    return () => {
      runAbortRef.current?.abort();
    };
  }, []);

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

      {status?.updateInProgress && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          ⏳ {t("updates.inProgressBanner")}
        </div>
      )}

      {status?.lastError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-red-300/70">
          <div className="font-semibold">
            {t("updates.lastErrorHeading")} ({status.lastError.timestamp})
          </div>
          <div className="mt-1 font-mono text-xs">{status.lastError.message}</div>
        </div>
      )}

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
            disabled={running || !status?.updateEnabled || status?.updateInProgress}
          >
            {running ? t("common.loading") : t("updates.run")}
          </Button>
        </div>
        {!status?.updateEnabled ? <p className="text-xs text-amber-300">{t("updates.disabled")}</p> : null}
        {check ? (
          <p className="text-sm opacity-80">
            {check.updateAvailable ? t("updates.available") : t("updates.none")} ({check.localCommit.slice(0, 8)} /{" "}
            {(check.remoteCommit ?? "").slice(0, 8) || "?"})
          </p>
        ) : null}
        <p className="text-xs opacity-70">
          {t("updates.currentCommitDateLabel")}: {status?.currentCommitDate || "-"} | {t("updates.remoteCommitDateLabel")}:{" "}
          {check?.remoteCommitDate || status?.remoteCommitDate || "-"}
        </p>
        <p className="text-xs opacity-70">
          {t("updates.lastCheckLabel")}: {status?.lastCheckedAt || "-"} | {t("updates.lastRunLabel")}: {status?.lastRunAt || "-"} |{" "}
          {t("updates.lastResultLabel")}: {status?.lastStatus || "-"}
        </p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2 font-semibold">🛡️ {t("updates.safetyTitle")}</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">✓</span>
            <span>{t("updates.safetyLock")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">✓</span>
            <span>{t("updates.safetyRollback")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">✓</span>
            <span>{t("updates.safetyConflict")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">✓</span>
            <span>{t("updates.safetyPreflight")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={status?.updateInProgress ? "text-amber-400" : "text-emerald-400"}>
              {status?.updateInProgress ? "⚠" : "✓"}
            </span>
            <span>
              {t("updates.safetyStateLine")}:{" "}
              {status?.updateInProgress ? t("updates.safetyStateProgress") : t("updates.safetyStateReady")}
            </span>
          </div>
        </div>
      </Card>

      {showLogs && logs.length > 0 ? (
        <Card className="space-y-3">
          <div className="font-semibold">📋 {t("updates.liveLogTitle")}</div>
          <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-700/50 bg-black/30 p-3 font-mono text-xs">
            {logs.map((log, idx) => (
              <div key={idx} className="mb-1">
                {log.type === "step" && <div className="text-cyan-400">{String(log.data)}</div>}
                {log.type === "output" && <div className="text-green-400">{formatLogLine(log.data)}</div>}
                {log.type === "error" && (
                  <div className="text-red-400">❌ {formatMaintenanceUpdateSseError(log.data) || t("updates.unknownError")}</div>
                )}
                {log.type === "complete" && (
                  <div className="text-emerald-400">
                    ✅{" "}
                    {(log.data as { changed?: boolean })?.changed ? t("updates.logApplied") : t("updates.logUpToDate")}
                  </div>
                )}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </Card>
      ) : null}
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
