import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { finished } from "stream/promises";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { config } from "../config.js";

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

type RcloneSettingsRow = RowDataPacket & {
  tenant_id: string;
  enabled: number;
  remote_name: string | null;
  remote_path: string | null;
  config_text: string | null;
  last_check_ok: number | null;
  last_check_at: string | null;
  last_error: string | null;
};

type RcloneSettings = {
  enabled: boolean;
  remoteName: string | null;
  remotePath: string | null;
  configText: string | null;
  lastCheckOk: boolean | null;
  lastCheckAt: string | null;
  lastError: string | null;
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

function getBackupDir(): string {
  return process.env.BACKUP_DIR || "/app/backups";
}

function getRetentionDays(): number {
  const parsed = Number.parseInt(process.env.BACKUP_RETENTION_DAYS ?? "7", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 7;
  return parsed;
}

function toSqlDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function toBackupFilename(now = new Date()): string {
  const stamp = now.toISOString().replaceAll(":", "-");
  return `${BACKUP_PREFIX}${stamp}.sql`;
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
    };
  }
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
    if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith(".sql")) continue;
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
      `${BACKUP_PREFIX}*.sql`,
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
  const retentionDays = getRetentionDays();

  await mkdir(dir, { recursive: true });
  await pool.execute(
    `INSERT INTO backup_runs (id, tenant_id, triggered_by, created_by_staff_id, status, started_at)
     VALUES (?, ?, ?, ?, 'running', NOW())`,
    [id, tenantId, triggeredBy, createdByStaffId]
  );

  try {
    await runMysqldump(filePath);
    const info = await stat(filePath);
    const settings = await getRcloneSettings(tenantId);
    let remoteRef: string | null = null;
    if (settings.enabled) {
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
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const settings = await getRcloneSettings(tenantId);
    if (settings.enabled) {
      await setRcloneCheckResult(tenantId, false, message.slice(0, 4000));
    }
    await pool.execute(
      `UPDATE backup_runs
       SET status = 'failed', local_path = ?, file_name = ?, error_message = ?, finished_at = NOW()
       WHERE id = ?`,
      [filePath, fileName, message.slice(0, 4000), id]
    );
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
  return {
    enabled: settings.enabled,
    configured,
    connected: Boolean(settings.enabled && configured && settings.lastCheckOk),
    remote_name: settings.remoteName,
    remote_path: settings.remotePath,
    last_error: settings.lastError,
    last_check_at: settings.lastCheckAt,
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
