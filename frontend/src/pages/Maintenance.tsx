import { useCallback, useEffect, useState } from "react";
import { Download, Link2, Play, RefreshCw, Trash2, Upload } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextField } from "../components/ui/TextField";
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
  const [rcloneEnabled, setRcloneEnabled] = useState(false);
  const [rcloneRemoteName, setRcloneRemoteName] = useState("");
  const [rcloneRemotePath, setRcloneRemotePath] = useState("");
  const [rcloneConfigText, setRcloneConfigText] = useState("");
  const [savingRclone, setSavingRclone] = useState(false);
  const [testingRclone, setTestingRclone] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [applySchemaExtensions, setApplySchemaExtensions] = useState(true);
  const [restoring, setRestoring] = useState(false);
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
        setRcloneEnabled(Boolean(gj.status.enabled));
        setRcloneRemoteName(gj.status.remote_name ?? "");
        setRcloneRemotePath(gj.status.remote_path ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!(user?.role === "admin" || user?.role === "manager")) return;
    void load();
  }, [load, user?.role]);

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
    if (!window.confirm(t("maintenance.deleteConfirm"))) return;
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

  async function saveRcloneConfig() {
    setSavingRclone(true);
    setError(null);
    setInfo(null);
    try {
      const body = {
        enabled: rcloneEnabled,
        remoteName: rcloneRemoteName || null,
        remotePath: rcloneRemotePath || null,
        configText: rcloneConfigText.trim() ? rcloneConfigText.trim() : undefined,
      };
      const res = await apiFetch("/api/maintenance/rclone", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await readApiError(res));
        return;
      }
      const json = (await res.json()) as { status: RcloneStatus };
      setRcloneStatus(json.status);
      setRcloneConfigText("");
      setInfo(t("maintenance.rcloneSaved"));
    } finally {
      setSavingRclone(false);
    }
  }

  async function runSqlRestore() {
    if (!restoreFile) {
      setError(t("maintenance.restorePickFile"));
      return;
    }
    if (!window.confirm(t("maintenance.restoreConfirm"))) {
      return;
    }
    setRestoring(true);
    setError(null);
    setInfo(null);
    try {
      const fd = new FormData();
      fd.append("file", restoreFile);
      fd.append("applySchemaExtensions", applySchemaExtensions ? "true" : "false");
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
      } = {};
      try {
        j = text ? (JSON.parse(text) as typeof j) : {};
      } catch {
        setError(text.slice(0, 500) || res.statusText);
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
        setInfo(`${t("maintenance.restoreSuccess")} ${detail}`);
        setRestoreFile(null);
        await loadRestoreInfo();
      } else {
        setError(t("maintenance.restoreFailed"));
      }
    } finally {
      setRestoring(false);
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={applySchemaExtensions}
              onChange={(e) => setApplySchemaExtensions(e.target.checked)}
            />
            {t("maintenance.restoreApplyExtensions")}
          </label>
          <Button type="button" onClick={() => void runSqlRestore()} disabled={restoring || !restoreFile}>
            <Upload className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
            {restoring ? t("common.loading") : t("maintenance.restoreRun")}
          </Button>
        </Card>
      ) : null}

      <Card className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Link2 className="h-4 w-4" />
          {t("maintenance.rcloneTitle")}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rcloneEnabled} onChange={(e) => setRcloneEnabled(e.target.checked)} />
          {t("maintenance.rcloneEnable")}
        </label>
        <TextField
          label={t("maintenance.rcloneRemote")}
          value={rcloneRemoteName}
          onChange={(e) => setRcloneRemoteName(e.target.value)}
          placeholder="gdrive"
        />
        <TextField
          label={t("maintenance.rclonePath")}
          value={rcloneRemotePath}
          onChange={(e) => setRcloneRemotePath(e.target.value)}
          placeholder="future-radius/backups"
        />
        <div>
          <label className="mb-1 block text-sm">{t("maintenance.rcloneConfig")}</label>
          <textarea
            className="min-h-28 w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
            value={rcloneConfigText}
            onChange={(e) => setRcloneConfigText(e.target.value)}
            placeholder={t("maintenance.rcloneConfigHint")}
          />
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
        <div className="flex gap-2">
          <Button type="button" onClick={() => void saveRcloneConfig()} disabled={savingRclone}>
            {savingRclone ? t("common.loading") : t("common.save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void testRcloneConfig()} disabled={testingRclone}>
            {testingRclone ? t("common.loading") : t("maintenance.rcloneTest")}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
                <th className="px-4 py-3 text-left">{t("maintenance.status")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.startedAt")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.file")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.size")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.local")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.drive")}</th>
                <th className="px-4 py-3 text-left">{t("maintenance.cleanup")}</th>
                <th className="px-4 py-3 text-right">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[hsl(var(--border))]/50">
                  <td className={`px-4 py-3 font-semibold ${statusClass(item.status)}`}>{statusLabel(item.status)}</td>
                  <td className="px-4 py-3">{fmtDate(item.started_at)}</td>
                  <td className="px-4 py-3">
                    <div>{item.file_name || "-"}</div>
                    {item.error_message ? <div className="max-w-xs truncate text-xs text-red-300">{item.error_message}</div> : null}
                  </td>
                  <td className="px-4 py-3">{fmtBytes(item.file_size_bytes)}</td>
                  <td className="px-4 py-3">{item.can_download ? t("maintenance.available") : "-"}</td>
                  <td className="px-4 py-3">{item.drive_uploaded ? t("maintenance.uploaded") : t("maintenance.notUploaded")}</td>
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
    </div>
  );
}
