import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Download, Link2, Play, RefreshCw, Trash2, Upload } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ActionDialog } from "../components/ui/ActionDialog";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/LocaleContext";

type BackupItem = {
  id: string;
  status: "running" | "success" | "failed";
  triggered_by: "system" | "manual";
  created_by_staff_id: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  drive_uploaded: boolean;
  local_deleted_count: number;
  drive_deleted_count: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  can_download: boolean;
};

type RcloneStatus = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  remote_name: string | null;
  remote_path: string | null;
  last_error: string | null;
  last_check_at: string | null;
  google_oauth_available: boolean;
  schedule_enabled: boolean;
  schedule_mode: "daily" | "twice_daily";
  schedule_time_1: string;
  schedule_time_2: string | null;
  schedule_timezone: string;
  retention_days: number;
};

type DatabaseSizeInfo = {
  data_bytes?: number;
  index_bytes?: number;
  total_bytes: number;
  table_count: number;
};

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function fmtDate(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 19).replace("T", " ");
  return d.toLocaleString();
}

export function MaintenancePage() {
  const { user } = useAuth();
  const { t, isRtl } = useI18n();
  const [items, setItems] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [rcloneStatus, setRcloneStatus] = useState<RcloneStatus | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleMode, setScheduleMode] = useState<"daily" | "twice_daily">("daily");
  const [scheduleTime1, setScheduleTime1] = useState("03:00");
  const [scheduleTime2, setScheduleTime2] = useState("15:00");
  const [retentionDays, setRetentionDays] = useState(7);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [testingRclone, setTestingRclone] = useState(false);
  const [pasteTokenJson, setPasteTokenJson] = useState("");
  const [savingPasteToken, setSavingPasteToken] = useState(false);
  const oauthReturnHandled = useRef(false);
  const [selectedBackupIds, setSelectedBackupIds] = useState<string[]>([]);
  const [deletingMany, setDeletingMany] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [pruneYear, setPruneYear] = useState<number>(new Date().getFullYear() - 1);
  const [prunePreviewLoading, setPrunePreviewLoading] = useState(false);
  const [pruneRunning, setPruneRunning] = useState(false);
  const [prunePreview, setPrunePreview] = useState<{
    year: number;
    from: string;
    to_exclusive: string;
    radacct_rows: number;
    rm_radacct_rows: number;
    radacct_distinct_users: number;
    rm_radacct_distinct_users: number;
  } | null>(null);
  const [restoreInfo, setRestoreInfo] = useState<{
    max_bytes: number;
    schema_extensions_resolved: string | null;
    target_database: string;
    last_success: {
      file_name: string;
      created_at: string;
      target_database: string;
    } | null;
    last_failed: {
      file_name: string;
      created_at: string;
      error_message: string | null;
      mysql_output_excerpt?: string | null;
    } | null;
  } | null>(null);
  const [databaseSize, setDatabaseSize] = useState<DatabaseSizeInfo | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    variant: "warning" | "danger";
    action: (() => void) | null;
  }>({
    message: "",
    variant: "warning",
    action: null,
  });

  function openConfirm(message: string, action: () => void, variant: "warning" | "danger" = "warning") {
    setConfirmDialog({ message, action, variant });
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/maintenance/backups");
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      const json = (await res.json()) as { items: BackupItem[] };
      setItems(json.items);
      const g = await apiFetch("/api/maintenance/rclone");
      if (g.ok) {
        const gj = (await g.json()) as { status: RcloneStatus };
        setRcloneStatus(gj.status);
        setScheduleEnabled(Boolean(gj.status.schedule_enabled));
        setScheduleMode(gj.status.schedule_mode === "twice_daily" ? "twice_daily" : "daily");
        setScheduleTime1((gj.status.schedule_time_1 || "03:00").slice(0, 5));
        setScheduleTime2((gj.status.schedule_time_2 || "15:00").slice(0, 5));
        setRetentionDays(Number(gj.status.retention_days || 7));
      }
      const dbSizeRes = await apiFetch("/api/maintenance/database-size");
      if (dbSizeRes.ok) {
        const dbSizeJson = (await dbSizeRes.json()) as DatabaseSizeInfo;
        setDatabaseSize(dbSizeJson);
      } else {
        setDatabaseSize(null);
      }
      setSelectedBackupIds([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!(user?.role === "admin" || user?.role === "manager")) return;
    void load();
  }, [load, user?.role]);

  useEffect(() => {
    if (oauthReturnHandled.current) return;
    const q = window.location.search;
    if (!q.includes("gdrive=")) return;
    oauthReturnHandled.current = true;
    const p = new URLSearchParams(q);
    const g = p.get("gdrive");
    const clean = () => {
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
    };
    if (g === "connected") {
      setInfo(t("maintenance.gdriveConnected"));
      clean();
      void load();
    } else if (g) {
      setError(t("maintenance.gdriveError").replace("{code}", g));
      clean();
    }
  }, [load, t]);

  const loadRestoreInfo = useCallback(async () => {
    if (user?.role !== "admin") {
      setRestoreInfo(null);
      return;
    }
    const res = await apiFetch("/api/maintenance/restore-sql/info");
    if (res.ok) {
      const j = (await res.json()) as {
        max_bytes: number;
        schema_extensions_resolved: string | null;
        target_database: string;
        last_success: {
          file_name: string;
          created_at: string;
          target_database: string;
        } | null;
        last_failed: {
          file_name: string;
          created_at: string;
          error_message: string | null;
          mysql_output_excerpt?: string | null;
        } | null;
      };
      setRestoreInfo(j);
    }
  }, [user?.role]);

  useEffect(() => {
    void loadRestoreInfo();
  }, [loadRestoreInfo]);

  if (!(user?.role === "admin" || user?.role === "manager")) {
    return <p className="text-sm opacity-70">{t("api.error_403")}</p>;
  }

  async function runBackupNow() {
    setRunning(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/backups/run", { method: "POST", body: "{}" });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      setInfo(t("maintenance.started"));
      await load();
    } finally {
      setRunning(false);
    }
  }

  async function downloadBackup(item: BackupItem) {
    setError(null);
    const res = await apiFetch(`/api/maintenance/backups/${item.id}/download`);
    if (!res.ok) {
      setError(await readApiError(res));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.file_name || `backup-${item.id}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteBackup(item: BackupItem) {
    openConfirm(
      t("maintenance.deleteConfirm"),
      () => {
        void confirmDeleteBackup(item);
      },
      "danger"
    );
  }

  async function confirmDeleteBackup(item: BackupItem) {
    setError(null);
    setInfo(null);
    const res = await apiFetch(`/api/maintenance/backups/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await readApiError(res));
      return;
    }
    setInfo(t("maintenance.deleted"));
    await load();
  }

  async function runSqlRestore() {
    if (!restoreFile) {
      setError(t("maintenance.restorePickFile"));
      return;
    }
    openConfirm(t("maintenance.restoreConfirm"), () => void confirmRunSqlRestore());
  }

  async function previewRadacctPrune() {
    setPrunePreviewLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/radacct/prune-year/preview", {
        method: "POST",
        body: JSON.stringify({ year: pruneYear }),
      });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      const j = (await res.json()) as {
        ok: boolean;
        preview: {
          year: number;
          from: string;
          to_exclusive: string;
          radacct_rows: number;
          rm_radacct_rows: number;
          radacct_distinct_users: number;
          rm_radacct_distinct_users: number;
        };
      };
      setPrunePreview(j.preview);
    } finally {
      setPrunePreviewLoading(false);
    }
  }

  async function runRadacctPrune() {
    if (!prunePreview) {
      setError("اعمل معاينة أولاً قبل التنفيذ.");
      return;
    }
    openConfirm(
      `سيتم حذف جلسات سنة ${prunePreview.year} من radacct و rm_radacct فقط. لا يتم تعديل جداول البطاقات أو المشتركين. هل تريد المتابعة؟`,
      () => {
        void confirmRunRadacctPrune();
      },
      "danger"
    );
  }

  async function confirmRunRadacctPrune() {
    setPruneRunning(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/radacct/prune-year/run", {
        method: "POST",
        body: JSON.stringify({ year: pruneYear, confirm: true }),
      });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      const j = (await res.json()) as {
        ok: boolean;
        deleted: {
          year: number;
          radacct_rows: number;
          rm_radacct_rows: number;
        };
      };
      setInfo(
        `تم حذف جلسات السنة ${j.deleted.year}: radacct=${j.deleted.radacct_rows}, rm_radacct=${j.deleted.rm_radacct_rows}.`
      );
      await previewRadacctPrune();
    } finally {
      setPruneRunning(false);
    }
  }

  async function confirmRunSqlRestore() {
    if (!restoreFile) return;
    setRestoring(true);
    setError(null);
    setInfo(null);
    try {
      const fd = new FormData();
      fd.append("file", restoreFile);
      fd.append("applySchemaExtensions", "false");
      const res = await apiFetch("/api/maintenance/restore-sql", { method: "POST", body: fd });
      const text = await res.text();
      let j: {
        ok?: boolean;
        detail?: string;
        error?: string;
        mysql_output?: string | null;
        target_database?: string;
        restored_at?: string;
        bytes?: number;
        database?: string;
        dma_subscriber_sync?: { usernamesConsidered: number; created: number; updated: number } | null;
        applied_schema_extensions?: boolean;
      } = {};
      try {
        j = text ? (JSON.parse(text) as typeof j) : {};
      } catch {
        if (res.status === 404 && /Cannot POST\s+\/api\/maintenance\/restore-sql/i.test(text)) {
          setError(t("maintenance.restoreEndpoint404"));
        } else {
          setError(text.slice(0, 500) || res.statusText);
        }
        return;
      }
      if (!res.ok) {
        const parts = [
          j.error === "restore_sql_failed" ? t("maintenance.restoreFailed") : j.error ?? "",
          j.detail ?? "",
          j.mysql_output ? `\n--- mysql ---\n${j.mysql_output}` : "",
          j.target_database ? `\nDB: ${j.target_database}` : "",
        ].filter(Boolean);
        setError(parts.join("\n").trim() || (await readApiError(res)));
        await loadRestoreInfo();
        return;
      }
      if (j.ok) {
        const db = j.target_database ?? j.database ?? "?";
        const at = j.restored_at ? fmtDate(j.restored_at) : fmtDate(new Date().toISOString());
        const bytes = fmtBytes(j.bytes ?? restoreFile.size);
        const detail = t("maintenance.restoreSuccessDetail")
          .replace("{db}", db)
          .replace("{at}", at)
          .replace("{bytes}", bytes);
        const sync =
          j.dma_subscriber_sync != null
            ? `\n${t("maintenance.restoreDmaSyncSummary")
                .replace("{n}", String(j.dma_subscriber_sync.usernamesConsidered))
                .replace("{c}", String(j.dma_subscriber_sync.created))
                .replace("{u}", String(j.dma_subscriber_sync.updated))}`
            : "";
        setInfo(`${t("maintenance.restoreSuccess")} ${detail}${sync}`);
        setRestoreFile(null);
        await loadRestoreInfo();
      } else {
        setError(t("maintenance.restoreFailed"));
      }
    } finally {
      setRestoring(false);
    }
  }

  async function openGoogleDriveConnect() {
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/rclone/google/authorize-url");
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      const json = (await res.json()) as { url?: string };
      if (!json.url) {
        setError(t("maintenance.gdriveUrlMissing"));
        return;
      }
      window.open(json.url, "_blank", "noopener,noreferrer");
      setInfo(t("maintenance.gdrivePopupHint"));
    } catch {
      setError(t("maintenance.gdriveUrlMissing"));
    }
  }

  async function testRcloneConfig() {
    setTestingRclone(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/rclone/test", {
        method: "POST",
        body: "{}",
      });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      const json = (await res.json()) as { status: RcloneStatus };
      setRcloneStatus(json.status);
      setInfo(json.status.connected ? t("maintenance.rcloneConnected") : t("maintenance.rcloneNotConnected"));
    } finally {
      setTestingRclone(false);
    }
  }

  async function pasteGoogleTokenFromCli() {
    if (!pasteTokenJson.trim()) {
      setError(t("maintenance.gdrivePasteTokenEmpty"));
      return;
    }
    setSavingPasteToken(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/rclone/google/paste-token", {
        method: "POST",
        body: JSON.stringify({ tokenJson: pasteTokenJson.trim() }),
      });
      const raw = await res.text();
      if (!res.ok) {
        let errCode = "";
        try {
          errCode = (JSON.parse(raw) as { error?: string }).error ?? "";
        } catch {
          errCode = "";
        }
        if (errCode === "invalid_token_json") {
          setError(t("maintenance.gdrivePasteTokenInvalid"));
        } else {
          setError(raw.trim().slice(0, 400) || res.statusText);
        }
        return;
      }
      const json = JSON.parse(raw) as { status: RcloneStatus };
      setRcloneStatus(json.status);
      setPasteTokenJson("");
      setInfo(t("maintenance.gdrivePasteTokenOk"));
      await load();
    } finally {
      setSavingPasteToken(false);
    }
  }

  async function saveBackupSchedule() {
    setSavingSchedule(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/backup-schedule", {
        method: "PUT",
        body: JSON.stringify({
          enabled: scheduleEnabled,
          mode: scheduleMode,
          time1: scheduleTime1,
          time2: scheduleMode === "twice_daily" ? scheduleTime2 : null,
          retentionDays,
        }),
      });
      const raw = await res.text();
      if (!res.ok) {
        let errCode = "";
        try {
          errCode = (JSON.parse(raw) as { error?: string }).error ?? "";
        } catch {
          errCode = "";
        }
        if (res.status === 400 && errCode === "backup_schedule_times_too_close") {
          setError(t("maintenance.backupScheduleTimesTooClose"));
        } else {
          setError(raw.trim().slice(0, 400) || res.statusText);
        }
        return;
      }
      setInfo(t("maintenance.scheduleSaved"));
      await load();
    } finally {
      setSavingSchedule(false);
    }
  }

  async function deleteSelectedBackups() {
    if (selectedBackupIds.length === 0) return;
    openConfirm(
      t("maintenance.deleteSelectedConfirm").replace("{count}", String(selectedBackupIds.length)),
      () => {
        void confirmDeleteSelectedBackups();
      },
      "danger"
    );
  }

  async function confirmDeleteSelectedBackups() {
    if (selectedBackupIds.length === 0) return;
    setDeletingMany(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch("/api/maintenance/backups/delete-many", {
        method: "POST",
        body: JSON.stringify({ ids: selectedBackupIds }),
      });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      setInfo(t("maintenance.deletedSelected").replace("{count}", String(selectedBackupIds.length)));
      await load();
    } finally {
      setDeletingMany(false);
    }
  }

  function toggleSelectAll() {
    if (selectedBackupIds.length === items.length) {
      setSelectedBackupIds([]);
      return;
    }
    setSelectedBackupIds(items.map((i) => i.id));
  }

  function toggleSelectOne(id: string) {
    setSelectedBackupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const statusLabel = (status: BackupItem["status"]) => {
    if (status === "success") return t("maintenance.statusSuccess");
    if (status === "failed") return t("maintenance.statusFailed");
    return t("maintenance.statusRunning");
  };

  const statusClass = (status: BackupItem["status"]) => {
    if (status === "success") return "text-emerald-400";
    if (status === "failed") return "text-red-400";
    return "text-amber-300";
  };

  const driveUploadLabel = (item: BackupItem) => {
    if (!rcloneStatus?.enabled || !rcloneStatus.connected) return t("maintenance.driveDisconnected");
    if (item.drive_uploaded) return t("maintenance.uploaded");
    if (item.status === "running") return t("maintenance.drivePending");
    return t("maintenance.driveUploadFailed");
  };

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("maintenance.title")}</h1>
          <p className="text-sm opacity-70">{t("maintenance.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""} ${isRtl ? "ms-2" : "me-2"}`} />
            {t("common.refresh")}
          </Button>
          <Button type="button" onClick={() => void runBackupNow()} disabled={running}>
            <Play className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
            {running ? t("common.loading") : t("maintenance.runNow")}
          </Button>
        </div>
      </div>

      {info ? <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{info}</div> : null}
      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div> : null}

      {user?.role === "admin" ? (
        <Card className="space-y-4 border-amber-500/30">
          <div className="flex items-center gap-2 font-semibold text-amber-200">
            <Upload className="h-4 w-4" />
            {t("maintenance.restoreTitle")}
          </div>
          <p className="text-sm opacity-80">{t("maintenance.restoreHint")}</p>
          {restoreInfo ? (
            <div className="space-y-2 text-xs opacity-80">
              <p>
                <span className="font-medium text-[hsl(var(--foreground))]">{t("maintenance.restoreTargetDb")}:</span>{" "}
                <code className="rounded bg-[hsl(var(--muted))] px-1 py-0.5">{restoreInfo.target_database}</code>
              </p>
              <p>
                {t("maintenance.restoreMaxSize")}: {fmtBytes(restoreInfo.max_bytes)}
              </p>
              {restoreInfo.last_success ? (
                <p className="text-emerald-400/90">
                  ✓ {t("maintenance.restoreLastSuccess")}: {restoreInfo.last_success.file_name} — {fmtDate(restoreInfo.last_success.created_at)}
                </p>
              ) : (
                <p className="opacity-60">{t("maintenance.restoreNoHistory")}</p>
              )}
              {restoreInfo.last_failed ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-red-200/90">
                  <div className="font-medium">✗ {t("maintenance.restoreLastFailed")}</div>
                  <div>
                    {restoreInfo.last_failed.file_name} — {fmtDate(restoreInfo.last_failed.created_at)}
                  </div>
                  {restoreInfo.last_failed.error_message ? (
                    <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] opacity-90">
                      {restoreInfo.last_failed.error_message}
                    </div>
                  ) : null}
                  {restoreInfo.last_failed.mysql_output_excerpt ? (
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] opacity-80">
                      {restoreInfo.last_failed.mysql_output_excerpt}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div>
            <label className="block text-sm font-medium">{t("maintenance.restorePickFile")}</label>
            <input
              type="file"
              accept=".sql,.txt,application/sql,text/plain"
              className="mt-1 block w-full text-sm"
              onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
            />
            {restoreFile ? (
              <div className="mt-1 text-xs opacity-80">
                {restoreFile.name} — {fmtBytes(restoreFile.size)}
              </div>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
            {t("maintenance.restoreAutoFollowup")}
          </p>
          <Button type="button" onClick={() => void runSqlRestore()} disabled={restoring || !restoreFile}>
            <Upload className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
            {restoring ? t("common.loading") : t("maintenance.restoreRun")}
          </Button>
        </Card>
      ) : null}

      {user?.role === "admin" ? (
        <Card className="space-y-4 border-red-500/30">
          <div className="font-semibold text-red-200">تنظيف جلسات المحاسبة حسب السنة (آمن)</div>
          <p className="text-sm opacity-80">
            هذه العملية تحذف فقط من <code>radacct</code> و <code>rm_radacct</code> حسب السنة المحددة. لا تمس جداول البطاقات أو المشتركين.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs opacity-80">السنة</label>
              <input
                type="number"
                min={2000}
                max={2100}
                className="rounded-lg border border-[hsl(var(--border))] bg-transparent px-2 py-1.5 text-sm"
                value={pruneYear}
                onChange={(e) => setPruneYear(Math.max(2000, Math.min(2100, Number(e.target.value || 2000))))}
              />
            </div>
            <Button type="button" variant="outline" onClick={() => void previewRadacctPrune()} disabled={prunePreviewLoading}>
              {prunePreviewLoading ? t("common.loading") : "معاينة قبل الحذف"}
            </Button>
            <Button type="button" onClick={() => void runRadacctPrune()} disabled={pruneRunning || !prunePreview}>
              {pruneRunning ? t("common.loading") : "تنفيذ الحذف للسنة"}
            </Button>
          </div>
          {prunePreview ? (
            <div className="rounded-xl border border-[hsl(var(--border))]/60 bg-[hsl(var(--muted))]/20 p-3 text-sm">
              <div>النطاق: {prunePreview.from} → {prunePreview.to_exclusive}</div>
              <div>صفوف `radacct` المرشحة: {prunePreview.radacct_rows}</div>
              <div>صفوف `rm_radacct` المرشحة: {prunePreview.rm_radacct_rows}</div>
              <div>عدد مستخدمي `radacct` المتأثرين: {prunePreview.radacct_distinct_users}</div>
              <div>عدد مستخدمي `rm_radacct` المتأثرين: {prunePreview.rm_radacct_distinct_users}</div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Link2 className="h-4 w-4" />
          {t("maintenance.gdriveCardTitle")}
        </div>
        <div className="space-y-2 rounded-xl border border-[hsl(var(--border))]/70 bg-[hsl(var(--muted))]/20 p-3 text-sm">
          <div className="font-semibold">{t("maintenance.connectGuideTitle")}</div>
          <ol className="list-decimal space-y-1 ps-5 text-xs opacity-90">
            <li>{t("maintenance.connectGuideStep1")}</li>
            <li>{t("maintenance.connectGuideStep2")}</li>
            <li>{t("maintenance.connectGuideStep3")}</li>
            <li>{t("maintenance.connectGuideStep4")}</li>
          </ol>
        </div>
        {rcloneStatus?.google_oauth_available ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void openGoogleDriveConnect()}>
                {t("maintenance.gdriveConnectButton")}
              </Button>
            </div>
            <p className="text-xs opacity-70">{t("maintenance.gdriveConnectSub")}</p>
          </div>
        ) : null}
        <div className="space-y-2 rounded-xl border border-[hsl(var(--border))]/70 bg-[hsl(var(--muted))]/10 p-3">
          <label className="block text-xs font-medium opacity-85">{t("maintenance.gdrivePasteTokenLabel")}</label>
          <textarea
            className="h-28 w-full rounded-lg border border-[hsl(var(--border))] bg-transparent px-2 py-1.5 text-xs font-mono"
            value={pasteTokenJson}
            onChange={(e) => setPasteTokenJson(e.target.value)}
            placeholder={t("maintenance.gdrivePasteTokenPlaceholder")}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void pasteGoogleTokenFromCli()} disabled={savingPasteToken}>
              {savingPasteToken ? t("common.loading") : t("maintenance.gdrivePasteTokenSubmit")}
            </Button>
            <Button type="button" variant="outline" onClick={() => void testRcloneConfig()} disabled={testingRclone}>
              {testingRclone ? t("common.loading") : t("maintenance.rcloneTest")}
            </Button>
          </div>
        </div>
        {rcloneStatus ? (
          <div className="text-sm opacity-80">
            <div>
              {t("maintenance.rcloneStatus")}:{" "}
              {rcloneStatus.connected ? (
                <span className="text-emerald-400">{t("maintenance.rcloneConnected")}</span>
              ) : (
                <span className="text-red-400">{t("maintenance.rcloneNotConnected")}</span>
              )}
            </div>
            {rcloneStatus.last_error ? <div className="text-xs text-red-300">{rcloneStatus.last_error}</div> : null}
          </div>
        ) : null}

        <div className="border-t border-[hsl(var(--border))]/60 pt-4">
          <div className="mb-2 font-semibold">{t("maintenance.scheduleTitle")}</div>
          <p className="mb-3 text-sm opacity-80">{t("maintenance.scheduleHint")}</p>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={scheduleEnabled}
              onChange={(e) => setScheduleEnabled(e.target.checked)}
            />
            {t("maintenance.scheduleEnable")}
          </label>
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="sched-mode"
                checked={scheduleMode === "daily"}
                onChange={() => setScheduleMode("daily")}
              />
              {t("maintenance.scheduleDaily")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="sched-mode"
                checked={scheduleMode === "twice_daily"}
                onChange={() => setScheduleMode("twice_daily")}
              />
              {t("maintenance.scheduleTwice")}
            </label>
          </div>
          <div className="mb-3 flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs opacity-80">{t("maintenance.scheduleTime1")}</label>
              <input
                type="time"
                className="rounded-lg border border-[hsl(var(--border))] bg-transparent px-2 py-1.5 text-sm"
                value={scheduleTime1.length === 5 ? scheduleTime1 : "03:00"}
                onChange={(e) => setScheduleTime1(e.target.value)}
              />
            </div>
            {scheduleMode === "twice_daily" ? (
              <div>
                <label className="mb-1 block text-xs opacity-80">{t("maintenance.scheduleTime2")}</label>
                <input
                  type="time"
                  className="rounded-lg border border-[hsl(var(--border))] bg-transparent px-2 py-1.5 text-sm"
                  value={scheduleTime2.length === 5 ? scheduleTime2 : "15:00"}
                  onChange={(e) => setScheduleTime2(e.target.value)}
                />
              </div>
            ) : null}
          </div>
          <div className="mb-3 max-w-xs">
            <label className="mb-1 block text-xs opacity-80">{t("maintenance.retentionDays")}</label>
            <input
              type="number"
              min={1}
              max={365}
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-transparent px-2 py-1.5 text-sm"
              value={retentionDays}
              onChange={(e) => setRetentionDays(Math.min(365, Math.max(1, Number(e.target.value || 7))))}
            />
            <p className="mt-1 text-xs opacity-70">{t("maintenance.retentionHint")}</p>
          </div>
          {rcloneStatus ? (
            <p className="mb-3 text-xs opacity-70">
              {t("maintenance.scheduleTimezone")}: {rcloneStatus.schedule_timezone}
            </p>
          ) : null}
          <Button type="button" onClick={() => void saveBackupSchedule()} disabled={savingSchedule}>
            {savingSchedule ? t("common.loading") : t("maintenance.scheduleSave")}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--border))]/70 px-4 py-3">
          <div className="space-y-1 text-sm opacity-80">
            <div>{t("maintenance.selectedBackups").replace("{count}", String(selectedBackupIds.length))}</div>
            {databaseSize ? (
              <div className="rounded-xl border border-[hsl(var(--border))]/70 bg-[hsl(var(--muted))]/20 p-3 text-[hsl(var(--foreground))]">
                <div className="flex items-center gap-2 text-[13px] opacity-90">
                  <Database className="h-4 w-4 text-[hsl(var(--primary))]" />
                  <span>{t("maintenance.databaseSize")}</span>
                </div>
                <div className="mt-1 text-lg font-semibold">
                  {fmtBytes(databaseSize.total_bytes)}
                </div>
                <div className="text-xs opacity-80">
                  {databaseSize.table_count} {t("maintenance.tablesCount")} — {t("maintenance.databaseData")}:{" "}
                  {fmtBytes(databaseSize.data_bytes ?? null)} — {t("maintenance.databaseIndexes")}:{" "}
                  {fmtBytes(databaseSize.index_bytes ?? null)}
                </div>
                <div className="mt-1 text-[11px] opacity-70">
                  {t("maintenance.databaseSizeHint")}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => toggleSelectAll()} disabled={items.length === 0}>
              {selectedBackupIds.length === items.length && items.length > 0
                ? t("maintenance.unselectAll")
                : t("maintenance.selectAll")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void deleteSelectedBackups()}
              disabled={selectedBackupIds.length === 0 || deletingMany}
            >
              {deletingMany ? t("common.loading") : t("maintenance.deleteSelected")}
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selectedBackupIds.length === items.length}
                    onChange={() => toggleSelectAll()}
                  />
                </th>
                <th className="px-4 py-3 text-left">{t("maintenance.status")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.startedAt")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.file")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.size")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.local")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.cleanup")}</th>
                <th className="px-4 py-3 text-right">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[hsl(var(--border))]/50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedBackupIds.includes(item.id)}
                      onChange={() => toggleSelectOne(item.id)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className={`font-semibold ${statusClass(item.status)}`}>{statusLabel(item.status)}</div>
                    <div className="text-xs opacity-75">
                      {t("maintenance.drive")}: {driveUploadLabel(item)}
                    </div>
                  </td>
                  <td className="px-4 py-3">{fmtDate(item.started_at)}</td>
                  <td className="px-4 py-3">
                    <div>{item.file_name || "-"}</div>
                    {item.error_message ? <div className="max-w-xs truncate text-xs text-red-300">{item.error_message}</div> : null}
                  </td>
                  <td className="px-4 py-3">{fmtBytes(item.file_size_bytes)}</td>
                  <td className="px-4 py-3">{item.can_download ? t("maintenance.available") : "-"}</td>
                  <td className="px-4 py-3">
                    {item.local_deleted_count + item.drive_deleted_count > 0
                      ? `${item.local_deleted_count} / ${item.drive_deleted_count}`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded-lg p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
                      onClick={() => void downloadBackup(item)}
                      disabled={!item.can_download}
                      title={t("maintenance.download")}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-red-400 hover:bg-[hsl(var(--muted))]"
                      onClick={() => void deleteBackup(item)}
                      title={t("common.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ActionDialog
        open={Boolean(confirmDialog.action)}
        title={t("common.actions")}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onClose={() => setConfirmDialog({ message: "", variant: "warning", action: null })}
        onConfirm={() => {
          const action = confirmDialog.action;
          setConfirmDialog({ message: "", variant: "warning", action: null });
          action?.();
        }}
      />
    </div>
  );
}
