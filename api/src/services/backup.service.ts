import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { finished, pipeline } from "stream/promises";
import jwt from "jsonwebtoken";
import type { RowDataPacket } from "mysql2";
import { createGzip } from "zlib";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { getSystemSettings } from "./system-settings.service.js";
import { resolveWhatsAppSessionOwnerPhone, sendOperationalAlertWhatsApp } from "./whatsapp.service.js";

type BackupStatus = "running" | "success" | "failed";
type TriggeredBy = "system" | "manual";

type BackupRunRow = RowDataPacket & {
  id: string;
  tenant_id: string;
  triggered_by: TriggeredBy;
  created_by_staff_id: string | null;
  status: BackupStatus;
  local_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  drive_file_id: string | null;
  drive_uploaded: number;
  local_deleted_count: number;
  drive_deleted_count: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

type ScheduleMode = "daily" | "twice_daily";

type RcloneSettingsRow = RowDataPacket & {
  tenant_id: string;
  enabled: number;
  remote_name: string | null;
  remote_path: string | null;
  config_text: string | null;
  last_check_ok: number | null;
  last_check_at: string | null;
  last_error: string | null;
  schedule_enabled?: number;
  schedule_mode?: ScheduleMode;
  schedule_time_1?: string;
  schedule_time_2?: string | null;
  last_scheduled_slot?: string | null;
  retention_days?: number | null;
};

type RcloneSettings = {
  enabled: boolean;
  remoteName: string | null;
  remotePath: string | null;
  configText: string | null;
  lastCheckOk: boolean | null;
  lastCheckAt: string | null;
  lastError: string | null;
  scheduleEnabled: boolean;
  scheduleMode: ScheduleMode;
  scheduleTime1: string;
  scheduleTime2: string | null;
  lastScheduledSlot: string | null;
  retentionDays: number;
};

export type BackupRunView = {
  id: string;
  status: BackupStatus;
  triggered_by: TriggeredBy;
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

export type BackupFileRef = {
  filePath: string;
  fileName: string;
};

export type RcloneStatus = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  remote_name: string | null;
  remote_path: string | null;
  last_error: string | null;
  last_check_at: string | null;
  google_oauth_available: boolean;
  schedule_enabled: boolean;
  schedule_mode: ScheduleMode;
  schedule_time_1: string;
  schedule_time_2: string | null;
  schedule_timezone: string;
  retention_days: number;
};

export type BackupAlert = {
  last_status: BackupStatus | "none";
  last_success_at: string | null;
  last_failed_at: string | null;
  last_error: string | null;
  has_recent_failure: boolean;
  rclone_enabled: boolean;
  rclone_connected: boolean;
  rclone_last_error: string | null;
  daily_backup_uploaded: boolean;
  daily_backup_at: string | null;
};

const BACKUP_PREFIX = "radius-backup-";
/** Fixed remote name when using Google OAuth (rclone.ini section). */
export const GOOGLE_DRIVE_REMOTE_NAME = "gdrive";
const GDRIVE_OAUTH_SCOPE = "https://www.googleapis.com/auth/drive";

function getBackupDir(): string {
  return process.env.BACKUP_DIR || "/app/backups";
}

function getRetentionDays(): number {
  const parsed = Number.parseInt(process.env.BACKUP_RETENTION_DAYS ?? "7", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 7;
  return Math.min(365, parsed);
}

function toSqlDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function toBackupFilename(now = new Date()): string {
  const stamp = now.toISOString().replaceAll(":", "-");
  return `${BACKUP_PREFIX}${stamp}.sql.gz`;
}

async function notifyBackupRunWhatsApp(input: {
  tenantId: string;
  triggeredBy: TriggeredBy;
  status: BackupStatus;
  fileName: string;
  fileSizeBytes: number | null;
  driveEnabled: boolean;
  driveUploaded: boolean;
  errorMessage?: string | null;
}): Promise<void> {
  if (input.triggeredBy !== "system") return;
  try {
    const s = await getSystemSettings(input.tenantId);
    if (!s.backup_alert_enabled) return;
    let target = (s.backup_alert_phone || "").trim() || null;
    if (s.backup_alert_use_session_owner) {
      const owner = await resolveWhatsAppSessionOwnerPhone(input.tenantId).catch(() => null);
      if (owner) target = owner;
    }
    if (!target) return;

    const sizeMb =
      input.fileSizeBytes && input.fileSizeBytes > 0
        ? `${(input.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`
        : "غير معروف";
    const driveLine = input.driveEnabled
      ? input.driveUploaded
        ? "Google Drive: تم الرفع بنجاح."
        : "Google Drive: لم يتم الرفع."
      : "Google Drive: غير مفعّل.";

    const message =
      input.status === "success"
        ? `تنبيه النسخ الاحتياطي (تلقائي)\nالحالة: ناجح\nالملف: ${input.fileName}\nالحجم: ${sizeMb}\n${driveLine}`
        : `تنبيه النسخ الاحتياطي (تلقائي)\nالحالة: فشل\nالملف: ${input.fileName}\n${driveLine}\nالخطأ: ${String(
            input.errorMessage ?? "unknown_error"
          ).slice(0, 240)}`;

    await sendOperationalAlertWhatsApp(input.tenantId, target, message, {
      preferSessionOwner: false,
    });
  } catch (error) {
    console.warn("[backup] whatsapp backup alert failed", error);
  }
}

function normalizeRemotePath(value: string | null): string {
  return (value ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function buildRemoteBase(remoteName: string, remotePath: string | null): string {
  const clean = normalizeRemotePath(remotePath);
  return clean ? `${remoteName}:${clean}` : `${remoteName}:`;
}

async function ensureBackupSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_runs (
      id CHAR(36) NOT NULL PRIMARY KEY,
      tenant_id CHAR(36) NOT NULL,
      triggered_by ENUM('system','manual') NOT NULL DEFAULT 'system',
      created_by_staff_id CHAR(36) NULL,
      status ENUM('running','success','failed') NOT NULL DEFAULT 'running',
      local_path VARCHAR(512) NULL,
      file_name VARCHAR(255) NULL,
      file_size_bytes BIGINT UNSIGNED NULL,
      drive_file_id VARCHAR(128) NULL,
      drive_uploaded TINYINT(1) NOT NULL DEFAULT 0,
      local_deleted_count INT UNSIGNED NOT NULL DEFAULT 0,
      drive_deleted_count INT UNSIGNED NOT NULL DEFAULT 0,
      error_message TEXT NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_backup_tenant_started (tenant_id, started_at),
      INDEX idx_backup_tenant_status (tenant_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_rclone_settings (
      tenant_id CHAR(36) NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      remote_name VARCHAR(64) NULL,
      remote_path VARCHAR(255) NULL,
      config_text LONGTEXT NULL,
      last_check_ok TINYINT(1) NULL,
      last_check_at DATETIME NULL,
      last_error TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await ensureScheduleColumns();
}

async function ensureScheduleColumns(): Promise<void> {
  const hasColumn = async (name: string): Promise<boolean> => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'backup_rclone_settings'
         AND COLUMN_NAME = ?`,
      [name]
    );
    return Number((rows[0] as { c?: number })?.c ?? 0) > 0;
  };
  if (!(await hasColumn("schedule_enabled"))) {
    await pool.query(
      `ALTER TABLE backup_rclone_settings
         ADD COLUMN schedule_enabled TINYINT(1) NOT NULL DEFAULT 1`
    );
  }
  if (!(await hasColumn("schedule_mode"))) {
    await pool.query(
      `ALTER TABLE backup_rclone_settings
         ADD COLUMN schedule_mode ENUM('daily','twice_daily') NOT NULL DEFAULT 'daily'`
    );
  }
  if (!(await hasColumn("schedule_time_1"))) {
    await pool.query(
      `ALTER TABLE backup_rclone_settings
         ADD COLUMN schedule_time_1 CHAR(5) NOT NULL DEFAULT '03:00'`
    );
  }
  if (!(await hasColumn("schedule_time_2"))) {
    await pool.query(
      `ALTER TABLE backup_rclone_settings
         ADD COLUMN schedule_time_2 CHAR(5) NULL`
    );
  }
  if (!(await hasColumn("last_scheduled_slot"))) {
    await pool.query(
      `ALTER TABLE backup_rclone_settings
         ADD COLUMN last_scheduled_slot VARCHAR(32) NULL`
    );
  }
  if (!(await hasColumn("retention_days"))) {
    await pool.query(
      `ALTER TABLE backup_rclone_settings
         ADD COLUMN retention_days SMALLINT UNSIGNED NOT NULL DEFAULT 7`
    );
  }
}

async function gzipFile(inputPath: string, outputPath: string): Promise<void> {
  await pipeline(createReadStream(inputPath), createGzip({ level: 6 }), createWriteStream(outputPath));
}

async function runProcess(command: string, args: string[], env?: Record<string, string>): Promise<string> {
  const child = spawn(command, args, {
    env: { ...process.env, ...(env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error((stderr || stdout || `${command}_failed_${exitCode}`).trim());
  }
  return stdout;
}

function buildMysqldumpArgs(singleTransaction: boolean): string[] {
  const base: string[] = [
    "--quick",
    "--skip-lock-tables",
    "--default-character-set=utf8mb4",
    "-h",
    config.db.host,
    "-P",
    String(config.db.port),
    "-u",
    config.db.user,
    config.db.database,
  ];
  if (singleTransaction) {
    base.unshift("--single-transaction");
  }
  return base;
}

async function runMysqldumpOnce(filePath: string, singleTransaction: boolean): Promise<void> {
  const args = buildMysqldumpArgs(singleTransaction);
  const child = spawn("mysqldump", args, {
    env: { ...process.env, MYSQL_PWD: config.db.password },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = createWriteStream(filePath);
  child.stdout.pipe(out);

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  await finished(out);
  if (exitCode !== 0) {
    throw new Error(stderr || `mysqldump_failed_${exitCode}`);
  }
}

/**
 * نسخ احتياطي كامل. عند خطأ 1412 (تعريف الجدول تغيّر أثناء snapshot) نعيد المحاولة بدون --single-transaction.
 */
async function runMysqldump(filePath: string): Promise<void> {
  try {
    await runMysqldumpOnce(filePath, true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const is1412 =
      msg.includes("1412") ||
      msg.includes("Table definition has changed") ||
      msg.toLowerCase().includes("retry transaction");
    if (!is1412) throw e;
    console.warn("[backup] mysqldump: retrying without --single-transaction (1412 / concurrent DDL)");
    await runMysqldumpOnce(filePath, false);
  }
}

async function getRcloneSettings(tenantId: string): Promise<RcloneSettings> {
  await ensureBackupSchema();
  const [rows] = await pool.query<RcloneSettingsRow[]>(
    `SELECT *
     FROM backup_rclone_settings
     WHERE tenant_id = ?
     LIMIT 1`,
    [tenantId]
  );
  const row = rows[0];
  if (!row) {
    return {
      enabled: false,
      remoteName: null,
      remotePath: null,
      configText: null,
      lastCheckOk: null,
      lastCheckAt: null,
      lastError: null,
      scheduleEnabled: true,
      scheduleMode: "daily",
      scheduleTime1: "03:00",
      scheduleTime2: null,
      lastScheduledSlot: null,
      retentionDays: getRetentionDays(),
    };
  }
  const mode: ScheduleMode = row.schedule_mode === "twice_daily" ? "twice_daily" : "daily";
  return {
    enabled: Boolean(row.enabled),
    remoteName: row.remote_name ?? null,
    remotePath: row.remote_path ?? null,
    configText: row.config_text ?? null,
    lastCheckOk:
      row.last_check_ok === null || row.last_check_ok === undefined
        ? null
        : Boolean(row.last_check_ok),
    lastCheckAt: row.last_check_at ?? null,
    lastError: row.last_error ?? null,
    scheduleEnabled: row.schedule_enabled === undefined || row.schedule_enabled === null ? true : Boolean(row.schedule_enabled),
    scheduleMode: mode,
    scheduleTime1: (row.schedule_time_1 as string | undefined)?.trim() || "03:00",
    scheduleTime2: row.schedule_time_2 ? String(row.schedule_time_2).trim() : null,
    lastScheduledSlot: row.last_scheduled_slot ? String(row.last_scheduled_slot) : null,
    retentionDays:
      Number.isFinite(Number(row.retention_days)) && Number(row.retention_days) > 0
        ? Math.min(365, Number(row.retention_days))
        : getRetentionDays(),
  };
}

async function setRcloneCheckResult(
  tenantId: string,
  ok: boolean,
  errorMessage: string | null
): Promise<void> {
  await pool.execute(
    `UPDATE backup_rclone_settings
     SET last_check_ok = ?, last_check_at = NOW(), last_error = ?
     WHERE tenant_id = ?`,
    [ok ? 1 : 0, errorMessage, tenantId]
  );
}

function assertRcloneConfigured(settings: RcloneSettings): void {
  if (!settings.enabled) return;
  if (!settings.remoteName || !settings.configText) {
    throw new Error("rclone_not_configured");
  }
}

async function withRcloneConfig<T>(
  settings: RcloneSettings,
  fn: (configPath: string, remoteBase: string) => Promise<T>
): Promise<T> {
  if (!settings.remoteName || !settings.configText) {
    throw new Error("rclone_not_configured");
  }
  const tempDir = await mkdtemp(path.join(tmpdir(), "fr-rclone-"));
  const configPath = path.join(tempDir, "rclone.conf");
  await writeFile(configPath, settings.configText, "utf8");
  const remoteBase = buildRemoteBase(settings.remoteName, settings.remotePath);
  try {
    return await fn(configPath, remoteBase);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function uploadToRemote(filePath: string, tenantId: string): Promise<string | null> {
  const settings = await getRcloneSettings(tenantId);
  if (!settings.enabled) return null;
  assertRcloneConfigured(settings);
  return withRcloneConfig(settings, async (configPath, remoteBase) => {
    const fileName = path.basename(filePath);
    const target = `${remoteBase}/${fileName}`;
    await runProcess("rclone", ["copyto", filePath, target, "--config", configPath]);
    return fileName;
  });
}

async function cleanupLocalBackups(dir: string, retentionDays: number): Promise<number> {
  const files = await readdir(dir);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (const name of files) {
    if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith(".sql.gz")) continue;
    const fullPath = path.join(dir, name);
    try {
      const info = await stat(fullPath);
      if (info.mtimeMs < cutoff) {
        await unlink(fullPath);
        deleted += 1;
      }
    } catch {
      // Ignore local cleanup errors and continue.
    }
  }
  return deleted;
}

async function cleanupRemoteBackups(retentionDays: number, tenantId: string): Promise<number> {
  const settings = await getRcloneSettings(tenantId);
  if (!settings.enabled) return 0;
  assertRcloneConfigured(settings);
  await withRcloneConfig(settings, async (configPath, remoteBase) => {
    await runProcess("rclone", [
      "delete",
      remoteBase,
      "--min-age",
      `${retentionDays}d`,
      "--include",
      `${BACKUP_PREFIX}*.sql.gz`,
      "--config",
      configPath,
    ]);
  });
  return 0;
}

function mapBackupRun(row: BackupRunRow): BackupRunView {
  return {
    id: row.id,
    status: row.status,
    triggered_by: row.triggered_by,
    created_by_staff_id: row.created_by_staff_id,
    file_name: row.file_name,
    file_size_bytes: row.file_size_bytes ? Number(row.file_size_bytes) : null,
    drive_uploaded: Boolean(row.drive_uploaded),
    local_deleted_count: Number(row.local_deleted_count ?? 0),
    drive_deleted_count: Number(row.drive_deleted_count ?? 0),
    error_message: row.error_message,
    started_at: row.started_at,
    finished_at: row.finished_at,
    can_download: Boolean(row.local_path),
  };
}

export async function runDatabaseBackup(opts: {
  tenantId?: string;
  triggeredBy?: TriggeredBy;
  createdByStaffId?: string | null;
} = {}): Promise<BackupRunView> {
  await ensureBackupSchema();
  const tenantId = opts.tenantId ?? config.defaultTenantId;
  const triggeredBy = opts.triggeredBy ?? "system";
  const createdByStaffId = opts.createdByStaffId ?? null;
  const id = randomUUID();
  const dir = getBackupDir();
  const fileName = toBackupFilename();
  const filePath = path.join(dir, fileName);
  const rawSqlPath = filePath.replace(/\.gz$/, "");
  const rcloneSettings = await getRcloneSettings(tenantId);
  const retentionDays = rcloneSettings.retentionDays;

  await mkdir(dir, { recursive: true });
  await pool.execute(
    `INSERT INTO backup_runs (id, tenant_id, triggered_by, created_by_staff_id, status, started_at)
     VALUES (?, ?, ?, ?, 'running', NOW())`,
    [id, tenantId, triggeredBy, createdByStaffId]
  );

  try {
    await runMysqldump(rawSqlPath);
    await gzipFile(rawSqlPath, filePath);
    await unlink(rawSqlPath).catch(() => {});
    const info = await stat(filePath);
    let remoteRef: string | null = null;
    if (rcloneSettings.enabled) {
      remoteRef = await uploadToRemote(filePath, tenantId);
      await setRcloneCheckResult(tenantId, true, null);
    }
    const localDeleted = await cleanupLocalBackups(dir, retentionDays);
    let remoteDeleted = 0;
    try {
      remoteDeleted = await cleanupRemoteBackups(retentionDays, tenantId);
    } catch (cleanupError) {
      console.warn("backup cleanupRemoteBackups", cleanupError);
    }
    await pool.execute(
      `UPDATE backup_runs
       SET status = 'success',
           local_path = ?,
           file_name = ?,
           file_size_bytes = ?,
           drive_file_id = ?,
           drive_uploaded = ?,
           local_deleted_count = ?,
           drive_deleted_count = ?,
           finished_at = NOW()
       WHERE id = ?`,
      [
        filePath,
        fileName,
        info.size,
        remoteRef,
        remoteRef ? 1 : 0,
        localDeleted,
        remoteDeleted,
        id,
      ]
    );
    await notifyBackupRunWhatsApp({
      tenantId,
      triggeredBy,
      status: "success",
      fileName,
      fileSizeBytes: info.size,
      driveEnabled: rcloneSettings.enabled,
      driveUploaded: Boolean(remoteRef),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await unlink(rawSqlPath).catch(() => {});
    const latestRcloneSettings = await getRcloneSettings(tenantId);
    if (latestRcloneSettings.enabled) {
      await setRcloneCheckResult(tenantId, false, message.slice(0, 4000));
    }
    await pool.execute(
      `UPDATE backup_runs
       SET status = 'failed', local_path = ?, file_name = ?, error_message = ?, finished_at = NOW()
       WHERE id = ?`,
      [filePath, fileName, message.slice(0, 4000), id]
    );
    await notifyBackupRunWhatsApp({
      tenantId,
      triggeredBy,
      status: "failed",
      fileName,
      fileSizeBytes: null,
      driveEnabled: latestRcloneSettings.enabled,
      driveUploaded: false,
      errorMessage: message,
    });
  }

  const [rows] = await pool.query<BackupRunRow[]>(
    `SELECT *
     FROM backup_runs
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  if (!rows[0]) throw new Error("backup_run_not_found");
  return mapBackupRun(rows[0]);
}

export async function listBackupRuns(tenantId: string, limit = 50): Promise<BackupRunView[]> {
  await ensureBackupSchema();
  const safeLimit = Math.max(1, Math.min(200, limit));
  const [rows] = await pool.query<BackupRunRow[]>(
    `SELECT *
     FROM backup_runs
     WHERE tenant_id = ?
     ORDER BY started_at DESC
     LIMIT ${safeLimit}`,
    [tenantId]
  );
  return rows.map(mapBackupRun);
}

export async function getBackupFileForDownload(
  tenantId: string,
  id: string
): Promise<BackupFileRef | null> {
  await ensureBackupSchema();
  const [rows] = await pool.query<BackupRunRow[]>(
    `SELECT local_path, file_name
     FROM backup_runs
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, id]
  );
  const row = rows[0];
  if (!row?.local_path || !row?.file_name) return null;
  return { filePath: row.local_path, fileName: row.file_name };
}

export async function getRcloneStatus(tenantId: string): Promise<RcloneStatus> {
  const settings = await getRcloneSettings(tenantId);
  const configured = Boolean(settings.configText && settings.remoteName);
  const googleReady =
    Boolean(config.googleBackupOAuth.clientId && config.googleBackupOAuth.clientSecret);
  return {
    enabled: settings.enabled,
    configured,
    connected: Boolean(settings.enabled && configured && settings.lastCheckOk),
    remote_name: settings.remoteName,
    remote_path: settings.remotePath,
    last_error: settings.lastError,
    last_check_at: settings.lastCheckAt,
    google_oauth_available: googleReady,
    schedule_enabled: settings.scheduleEnabled,
    schedule_mode: settings.scheduleMode,
    schedule_time_1: settings.scheduleTime1,
    schedule_time_2: settings.scheduleTime2,
    schedule_timezone: config.appTimezone,
    retention_days: settings.retentionDays,
  };
}

export async function testRcloneConnection(tenantId: string): Promise<RcloneStatus> {
  const settings = await getRcloneSettings(tenantId);
  if (!settings.enabled) {
    await setRcloneCheckResult(tenantId, true, null);
    return getRcloneStatus(tenantId);
  }
  try {
    assertRcloneConfigured(settings);
    await withRcloneConfig(settings, async (configPath) => {
      await runProcess("rclone", ["lsd", `${settings.remoteName!}:`, "--config", configPath]);
    });
    await setRcloneCheckResult(tenantId, true, null);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await setRcloneCheckResult(tenantId, false, message.slice(0, 4000));
  }
  return getRcloneStatus(tenantId);
}

export async function updateRcloneSettings(
  tenantId: string,
  input: {
    enabled: boolean;
    remoteName?: string | null;
    remotePath?: string | null;
    configText?: string | null;
  }
): Promise<RcloneStatus> {
  await ensureBackupSchema();
  const hasConfigText = Object.prototype.hasOwnProperty.call(input, "configText");
  const remoteName = input.remoteName?.trim() ?? null;
  const remotePath = input.remotePath?.trim() ?? null;
  if (hasConfigText) {
    const configText = input.configText?.trim() ?? null;
    await pool.execute(
      `INSERT INTO backup_rclone_settings
        (tenant_id, enabled, remote_name, remote_path, config_text, last_check_ok, last_check_at, last_error)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
       ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        remote_name = VALUES(remote_name),
        remote_path = VALUES(remote_path),
        config_text = VALUES(config_text),
        last_check_ok = NULL,
        last_check_at = NULL,
        last_error = NULL`,
      [tenantId, input.enabled ? 1 : 0, remoteName, remotePath, configText]
    );
  } else {
    await pool.execute(
      `INSERT INTO backup_rclone_settings
        (tenant_id, enabled, remote_name, remote_path, last_check_ok, last_check_at, last_error)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL)
       ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        remote_name = VALUES(remote_name),
        remote_path = VALUES(remote_path),
        last_check_ok = NULL,
        last_check_at = NULL,
        last_error = NULL`,
      [tenantId, input.enabled ? 1 : 0, remoteName, remotePath]
    );
  }
  return testRcloneConnection(tenantId);
}

export function isGoogleDriveOAuthConfigured(): boolean {
  return Boolean(config.googleBackupOAuth.clientId && config.googleBackupOAuth.clientSecret);
}

function buildDriveRcloneIniFromToken(token: {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expiry?: string;
}): string {
  const tokenJson = JSON.stringify({
    access_token: token.access_token,
    token_type: token.token_type || "Bearer",
    refresh_token: token.refresh_token ?? "",
    expiry: token.expiry ?? "",
  });
  return `[${GOOGLE_DRIVE_REMOTE_NAME}]
type = drive
scope = drive
token = ${tokenJson}
`;
}

async function exchangeGoogleOAuthCode(code: string, redirectUri: string): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}> {
  const body = new URLSearchParams({
    code,
    client_id: config.googleBackupOAuth.clientId,
    client_secret: config.googleBackupOAuth.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`google_token_exchange_failed: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    token_type: string;
  };
}

export function getGoogleDriveAuthUrl(
  tenantId: string,
  ctx: { apiPublicOrigin: string; returnFrontendOrigin: string }
): string {
  if (!isGoogleDriveOAuthConfigured()) {
    throw new Error("google_oauth_not_configured");
  }
  const apiBase = ctx.apiPublicOrigin.replace(/\/+$/, "");
  const redirectUri = `${apiBase}/api/maintenance/rclone/google/callback`;
  const returnBase = ctx.returnFrontendOrigin.replace(/\/+$/, "");
  const state = jwt.sign(
    { p: "gdrive_oauth", tenantId, redirectUri, returnBase },
    config.jwtSecret,
    { expiresIn: "15m" }
  );
  const params = new URLSearchParams({
    client_id: config.googleBackupOAuth.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GDRIVE_OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function completeGoogleDriveOAuthCallback(opts: {
  code: string;
  state: string;
  /** @deprecated use redirectUri embedded in signed state */
  redirectUri?: string;
}): Promise<{ returnBase: string }> {
  if (!isGoogleDriveOAuthConfigured()) {
    throw new Error("google_oauth_not_configured");
  }
  let tenantId: string;
  let redirectUri: string;
  let returnBase: string;
  try {
    const decoded = jwt.verify(opts.state, config.jwtSecret) as {
      p?: string;
      tenantId?: string;
      redirectUri?: string;
      returnBase?: string;
    };
    if (decoded.p !== "gdrive_oauth" || !decoded.tenantId) throw new Error("invalid_state");
    tenantId = decoded.tenantId;
    redirectUri =
      typeof decoded.redirectUri === "string" && decoded.redirectUri.trim()
        ? decoded.redirectUri.trim()
        : `${config.publicAppUrl.replace(/\/+$/, "")}/api/maintenance/rclone/google/callback`;
    returnBase =
      typeof decoded.returnBase === "string" && decoded.returnBase.trim()
        ? decoded.returnBase.trim()
        : config.publicFrontendUrl.replace(/\/+$/, "");
  } catch {
    throw new Error("invalid_oauth_state");
  }
  const raw = await exchangeGoogleOAuthCode(opts.code, redirectUri);
  const expiryIso = new Date(Date.now() + (raw.expires_in ?? 3600) * 1000).toISOString();
  const configText = buildDriveRcloneIniFromToken({
    access_token: raw.access_token,
    token_type: raw.token_type,
    refresh_token: raw.refresh_token,
    expiry: expiryIso,
  });
  await ensureBackupSchema();
  await ensureScheduleColumns();
  const defaultPath = "FutureRadius/backups";
  await pool.execute(
    `INSERT INTO backup_rclone_settings
      (tenant_id, enabled, remote_name, remote_path, config_text, last_check_ok, last_check_at, last_error)
     VALUES (?, 1, ?, ?, ?, NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE
      enabled = 1,
      remote_name = VALUES(remote_name),
      remote_path = VALUES(remote_path),
      config_text = VALUES(config_text),
      last_check_ok = NULL,
      last_check_at = NULL,
      last_error = NULL`,
    [tenantId, GOOGLE_DRIVE_REMOTE_NAME, defaultPath, configText]
  );
  await testRcloneConnection(tenantId);
  return { returnBase };
}

/**
 * Apply a Google Drive OAuth token JSON (same shape as rclone's `token = {...}` in rclone.conf)
 * after the admin runs `rclone authorize "drive"` on a machine that has a browser.
 */
export async function applyGoogleDrivePasteToken(tenantId: string, tokenInput: string): Promise<RcloneStatus> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tokenInput.trim());
  } catch {
    throw new Error("invalid_token_json");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("invalid_token_json");
  const t = parsed as Record<string, unknown>;
  if (typeof t.access_token !== "string" || !t.access_token) {
    throw new Error("invalid_token_json");
  }
  const expiry =
    typeof t.expiry === "string"
      ? t.expiry
      : t.expiry instanceof Date
        ? t.expiry.toISOString()
        : new Date(Date.now() + 3600 * 1000).toISOString();
  const configText = buildDriveRcloneIniFromToken({
    access_token: t.access_token,
    token_type: typeof t.token_type === "string" ? t.token_type : "Bearer",
    refresh_token: typeof t.refresh_token === "string" ? t.refresh_token : undefined,
    expiry,
  });
  await ensureBackupSchema();
  await ensureScheduleColumns();
  const defaultPath = "FutureRadius/backups";
  await pool.execute(
    `INSERT INTO backup_rclone_settings
      (tenant_id, enabled, remote_name, remote_path, config_text, last_check_ok, last_check_at, last_error)
     VALUES (?, 1, ?, ?, ?, NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE
      enabled = 1,
      remote_name = VALUES(remote_name),
      remote_path = VALUES(remote_path),
      config_text = VALUES(config_text),
      last_check_ok = NULL,
      last_check_at = NULL,
      last_error = NULL`,
    [tenantId, GOOGLE_DRIVE_REMOTE_NAME, defaultPath, configText]
  );
  return testRcloneConnection(tenantId);
}

export async function disconnectGoogleDriveBackup(tenantId: string): Promise<void> {
  await ensureBackupSchema();
  await ensureScheduleColumns();
  await pool.execute(
    `UPDATE backup_rclone_settings
     SET enabled = 0,
         config_text = NULL,
         remote_name = NULL,
         remote_path = NULL,
         last_check_ok = NULL,
         last_check_at = NULL,
         last_error = NULL
     WHERE tenant_id = ?`,
    [tenantId]
  );
}

function hhmmToMinutes(hm: string): number {
  const parts = hm.trim().split(":");
  if (parts.length < 2) return -1;
  const h = Number.parseInt(parts[0]!, 10);
  const m = Number.parseInt(parts[1]!, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

function localDateAndHmInZone(now: Date, timeZone: string): { date: string; hm: string } {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return { date, hm: `${hour}:${minute}` };
}

function normalizeHm(raw: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return "03:00";
  const h = Math.min(23, Math.max(0, Number.parseInt(m[1]!, 10)));
  const min = Math.min(59, Math.max(0, Number.parseInt(m[2]!, 10)));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export async function updateBackupSchedule(
  tenantId: string,
  input: {
    enabled: boolean;
    mode: ScheduleMode;
    time1: string;
    time2?: string | null;
    retentionDays?: number;
  }
): Promise<void> {
  await ensureBackupSchema();
  await ensureScheduleColumns();
  const time1 = normalizeHm(input.time1);
  const time2 =
    input.mode === "twice_daily" && input.time2 && input.time2.trim()
      ? normalizeHm(input.time2)
      : null;
  if (input.mode === "twice_daily" && time2 && Math.abs(hhmmToMinutes(time1) - hhmmToMinutes(time2)) < 30) {
    throw new Error("backup_schedule_times_too_close");
  }
  const retentionDays =
    Number.isFinite(Number(input.retentionDays)) && Number(input.retentionDays) > 0
      ? Math.min(365, Math.max(1, Number(input.retentionDays)))
      : getRetentionDays();
  await pool.execute(
    `INSERT INTO backup_rclone_settings
      (tenant_id, schedule_enabled, schedule_mode, schedule_time_1, schedule_time_2, retention_days, last_scheduled_slot)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
      schedule_enabled = VALUES(schedule_enabled),
      schedule_mode = VALUES(schedule_mode),
      schedule_time_1 = VALUES(schedule_time_1),
      schedule_time_2 = VALUES(schedule_time_2),
      retention_days = VALUES(retention_days),
      last_scheduled_slot = NULL`,
    [tenantId, input.enabled ? 1 : 0, input.mode, time1, time2, retentionDays]
  );
}

export async function deleteBackupRunsBulk(
  tenantId: string,
  ids: string[]
): Promise<{ requested: number; deleted: number }> {
  let deleted = 0;
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  for (const id of uniq) {
    const r = await deleteBackupRun(tenantId, id);
    if (r.deleted) deleted += 1;
  }
  return { requested: uniq.length, deleted };
}

export async function maybeRunScheduledBackup(tenantId: string, timeZone: string): Promise<void> {
  await ensureBackupSchema();
  await ensureScheduleColumns();
  const settings = await getRcloneSettings(tenantId);
  if (!settings.scheduleEnabled) return;

  const t1 = normalizeHm(settings.scheduleTime1);
  const t2 = settings.scheduleTime2 ? normalizeHm(settings.scheduleTime2) : null;
  const slots =
    settings.scheduleMode === "twice_daily" && t2
      ? Array.from(new Set([t1, t2])).sort()
      : [t1];

  const now = new Date();
  const { date, hm } = localDateAndHmInZone(now, timeZone);
  const cur = hhmmToMinutes(hm);
  if (cur < 0) return;

  const matches = slots.filter((slot) => {
    const s = hhmmToMinutes(slot);
    return s >= 0 && Math.abs(cur - s) <= 5;
  });
  if (matches.length === 0) return;

  for (const slot of matches) {
    const key = `${date}|${slot}`;
    if (settings.lastScheduledSlot === key) continue;
    await runDatabaseBackup({ tenantId, triggeredBy: "system" });
    await pool.execute(
      `UPDATE backup_rclone_settings SET last_scheduled_slot = ? WHERE tenant_id = ?`,
      [key, tenantId]
    );
    return;
  }
}

export async function getBackupAlert(tenantId: string): Promise<BackupAlert> {
  await ensureBackupSchema();
  const [lastRows] = await pool.query<BackupRunRow[]>(
    `SELECT status, started_at, error_message
     FROM backup_runs
     WHERE tenant_id = ?
     ORDER BY started_at DESC
     LIMIT 1`,
    [tenantId]
  );
  const [successRows] = await pool.query<RowDataPacket[]>(
    `SELECT started_at
     FROM backup_runs
     WHERE tenant_id = ? AND status = 'success'
     ORDER BY started_at DESC
     LIMIT 1`,
    [tenantId]
  );
  const [failedRows] = await pool.query<RowDataPacket[]>(
    `SELECT started_at, error_message
     FROM backup_runs
     WHERE tenant_id = ? AND status = 'failed'
     ORDER BY started_at DESC
     LIMIT 1`,
    [tenantId]
  );
  const [dailyRows] = await pool.query<RowDataPacket[]>(
    `SELECT started_at, status, drive_uploaded
     FROM backup_runs
     WHERE tenant_id = ? AND triggered_by = 'system' AND DATE(started_at) = CURDATE()
     ORDER BY started_at DESC
     LIMIT 1`,
    [tenantId]
  );
  const rclone = await getRcloneStatus(tenantId);
  const last = lastRows[0];
  if (!last) {
    return {
      last_status: "none",
      last_success_at: null,
      last_failed_at: null,
      last_error: null,
      has_recent_failure: false,
      rclone_enabled: rclone.enabled,
      rclone_connected: rclone.connected,
      rclone_last_error: rclone.last_error,
      daily_backup_uploaded: false,
      daily_backup_at: null,
    };
  }
  const daily = dailyRows[0] as
    | {
        started_at?: string;
        status?: BackupStatus;
        drive_uploaded?: number;
      }
    | undefined;
  return {
    last_status: last.status,
    last_success_at: successRows[0]?.started_at ? toSqlDate(new Date(successRows[0].started_at)) : null,
    last_failed_at: failedRows[0]?.started_at ? toSqlDate(new Date(failedRows[0].started_at)) : null,
    last_error: (failedRows[0]?.error_message as string | undefined) ?? null,
    has_recent_failure: last.status === "failed",
    rclone_enabled: rclone.enabled,
    rclone_connected: rclone.connected,
    rclone_last_error: rclone.last_error,
    daily_backup_uploaded:
      Boolean(daily?.started_at) &&
      daily?.status === "success" &&
      Number(daily?.drive_uploaded ?? 0) === 1,
    daily_backup_at: daily?.started_at ? toSqlDate(new Date(daily.started_at)) : null,
  };
}

export async function deleteBackupRun(tenantId: string, id: string): Promise<{
  deleted: boolean;
  local_deleted: boolean;
  remote_deleted: boolean;
}> {
  await ensureBackupSchema();
  const [rows] = await pool.query<BackupRunRow[]>(
    `SELECT id, local_path, file_name, drive_uploaded
     FROM backup_runs
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, id]
  );
  const row = rows[0];
  if (!row) return { deleted: false, local_deleted: false, remote_deleted: false };

  let localDeleted = false;
  let remoteDeleted = false;
  if (row.local_path) {
    try {
      await unlink(row.local_path);
      localDeleted = true;
    } catch {
      localDeleted = false;
    }
  }

  if (Number(row.drive_uploaded ?? 0) === 1 && row.file_name) {
    try {
      const settings = await getRcloneSettings(tenantId);
      if (settings.enabled && settings.remoteName && settings.configText) {
        await withRcloneConfig(settings, async (configPath, remoteBase) => {
          await runProcess("rclone", ["deletefile", `${remoteBase}/${row.file_name}`, "--config", configPath]);
        });
        remoteDeleted = true;
      }
    } catch {
      remoteDeleted = false;
    }
  }

  await pool.execute(`DELETE FROM backup_runs WHERE tenant_id = ? AND id = ?`, [tenantId, id]);
  return { deleted: true, local_deleted: localDeleted, remote_deleted: remoteDeleted };
}
