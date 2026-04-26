import { spawn } from "child_process";
import { createReadStream, existsSync, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { config } from "../config.js";

/** حد أقصى ~2GB؛ يضبط عبر RESTORE_MAX_SQL_BYTES ويتوافق مع client_max_body_size في nginx */
const MAX_BYTES = Math.min(
  Math.max(1, parseInt(process.env.RESTORE_MAX_SQL_BYTES ?? `${2 * 1024 * 1024 * 1024}`, 10)),
  2 * 1024 * 1024 * 1024
);

function mysqlBin(): string {
  return (process.env.MYSQL_CLIENT ?? "mysql").trim() || "mysql";
}

/**
 * اكتشاف مسار `sql/schema_extensions.sql` (مستودع + Docker: `/app/sql`).
 */
export function resolveSchemaExtensionsPath(): string | null {
  const fromEnv = process.env.FUTURERADIUS_SQL_DIR?.trim();
  if (fromEnv) {
    const p = join(fromEnv, "schema_extensions.sql");
    if (existsSync(p)) return p;
  }
  const candidates = [
    join(process.cwd(), "sql", "schema_extensions.sql"),
    join(process.cwd(), "..", "sql", "schema_extensions.sql"),
    "/app/sql/schema_extensions.sql",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * مخرجات عميل MySQL: غالباً تُسجّل أخطاء SQL حتى مع exit=0 (حسب إعدادات).
 * كذلك: إن احتوى الـ dump على `USE` لقاعدة أخرى دون -o قد يُستورد خارج القاعدة المضبوطة.
 */
function mysqlClientOutputIndicatesError(combined: string, exitCode: number): string | null {
  if (exitCode !== 0) {
    return combined.trim() || `mysql_exited_with_${exitCode}`;
  }
  if (!combined.trim()) return null;
  if (/\bERROR \d+/.test(combined) || /ERROR at line \d+/i.test(combined)) {
    return combined.trim();
  }
  if (/^ERROR\b/m.test(combined) || /mysql: \[ERROR\]/i.test(combined)) {
    return combined.trim();
  }
  return null;
}

async function pipeFileToMysql(sqlPath: string): Promise<{ ok: true } | { ok: false; error: string; output: string }> {
  const args: string[] = [
    "-h",
    config.db.host,
    "-P",
    String(config.db.port),
    "-u",
    config.db.user,
    "--default-character-set=utf8mb4",
    /** ينفّذ فقط الجمل الخاصة بقاعدة `DATABASE_URL` (يتجاهل `USE` لقاعدة أخرى داخل الـ dump) */
    "-o",
    config.db.database,
  ];
  const child = spawn(mysqlBin(), args, {
    env: { ...process.env, MYSQL_PWD: config.db.password },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (c: Buffer) => {
    stderr += c.toString("utf8");
  });
  child.stdout.on("data", (c: Buffer) => {
    stdout += c.toString("utf8");
  });
  if (!child.stdin) {
    return { ok: false, error: "mysql_no_stdin", output: "" };
  }
  const exitPromise = new Promise<number>((resolve) => {
    child.once("close", (c) => resolve(c ?? 1));
  });
  try {
    await pipeline(createReadStream(sqlPath), child.stdin);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      output: (stderr + stdout).trim(),
    };
  }
  const exitCode = await exitPromise;
  const combined = `${stderr}\n${stdout}`.trim();
  const asErr = mysqlClientOutputIndicatesError(combined, exitCode);
  if (asErr) {
    return { ok: false, error: asErr, output: combined };
  }
  return { ok: true };
}

async function readFirstBytes(path: string, n: number): Promise<Buffer> {
  const h = await fs.open(path, "r");
  try {
    const b = Buffer.alloc(n);
    await h.read(b, 0, n, 0);
    return b;
  } finally {
    await h.close();
  }
}

/**
 * تطبيق ملف .sql من مسار على القرص (يُفضّل للملفات الضخمة — لا يُحمّل الملف في RAM).
 */
export type SqlImportResult =
  | { ok: true; detail: { bytes: number; appliedSchemaExtensions: boolean } }
  | { ok: false; error: string; mysql_output?: string };

export async function importSqlFilePathIntoAppDatabase(
  sqlFilePath: string,
  options: { applySchemaExtensions: boolean }
): Promise<SqlImportResult> {
  const st = await fs.stat(sqlFilePath);
  if (st.size < 8) {
    return { ok: false, error: "sql_too_short" };
  }
  if (st.size > MAX_BYTES) {
    return { ok: false, error: "sql_too_large" };
  }
  const head = await readFirstBytes(sqlFilePath, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    return { ok: false, error: "gzip_not_supported" };
  }
  const main = await pipeFileToMysql(sqlFilePath);
  if (!main.ok) {
    return { ok: false, error: main.error, mysql_output: main.output };
  }
  let appliedSchemaExtensions = false;
  if (options.applySchemaExtensions) {
    const ext = resolveSchemaExtensionsPath();
    if (!ext) {
      return { ok: false, error: "schema_extensions_not_found" };
    }
    const extR = await pipeFileToMysql(ext);
    if (!extR.ok) {
      return {
        ok: false,
        error: `schema_extensions_failed: ${extR.error}`,
        mysql_output: extR.output,
      };
    }
    appliedSchemaExtensions = true;
  }
  return { ok: true, detail: { bytes: st.size, appliedSchemaExtensions } };
}

/**
 * تطبيق نسخة .sql (مثل `radius.phpMyAdmin` dump) على قاعدة الاتصال الحالية.
 * @returns خطأ نصي أو null عند النجاح
 */
export async function importSqlBufferIntoAppDatabase(
  buffer: Buffer,
  options: { applySchemaExtensions: boolean }
): Promise<SqlImportResult> {
  if (buffer.length < 8) {
    return { ok: false, error: "sql_too_short" };
  }
  if (buffer.length > MAX_BYTES) {
    return { ok: false, error: "sql_too_large" };
  }
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return { ok: false, error: "gzip_not_supported" };
  }

  const tmpFile = join(tmpdir(), `fr-restore-${Date.now()}.sql`);
  await fs.writeFile(tmpFile, buffer, { mode: 0o600 });
  try {
    return await importSqlFilePathIntoAppDatabase(tmpFile, options);
  } finally {
    await fs.unlink(tmpFile).catch(() => undefined);
  }
}

export function getRestoreMaxBytes(): number {
  return MAX_BYTES;
}

export type SqlRestoreRunRow = {
  id: string;
  file_name: string;
  file_size_bytes: number;
  status: "success" | "failed";
  error_message: string | null;
  target_database: string;
  apply_schema_extensions: boolean;
  created_at: string;
  /** يُملأ لعمليات فاشلة فقط */
  mysql_output_excerpt?: string | null;
};

let restoreHistoryTableReady = false;

export async function ensureSqlRestoreHistoryTable(): Promise<void> {
  if (restoreHistoryTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sql_restore_runs (
      id CHAR(36) NOT NULL,
      tenant_id CHAR(36) NOT NULL,
      staff_id CHAR(36) NULL,
      file_name VARCHAR(512) NOT NULL DEFAULT '',
      file_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
      status ENUM('success','failed') NOT NULL,
      error_message TEXT NULL,
      target_database VARCHAR(128) NOT NULL,
      apply_schema_extensions TINYINT(1) NOT NULL DEFAULT 0,
      mysql_output_excerpt TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_sql_restore_tenant_time (tenant_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  restoreHistoryTableReady = true;
}

export async function recordSqlRestoreRun(input: {
  tenantId: string;
  staffId: string | null;
  fileName: string;
  fileSizeBytes: number;
  success: boolean;
  errorMessage: string | null;
  targetDatabase: string;
  applySchemaExtensions: boolean;
  mysqlOutputExcerpt: string | null;
}): Promise<void> {
  await ensureSqlRestoreHistoryTable();
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO sql_restore_runs (
       id, tenant_id, staff_id, file_name, file_size_bytes, status, error_message,
       target_database, apply_schema_extensions, mysql_output_excerpt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.tenantId,
      input.staffId,
      input.fileName,
      input.fileSizeBytes,
      input.success ? "success" : "failed",
      input.errorMessage,
      input.targetDatabase,
      input.applySchemaExtensions ? 1 : 0,
      input.mysqlOutputExcerpt
        ? input.mysqlOutputExcerpt.slice(0, 4000)
        : null,
    ]
  );
}

export async function getSqlRestoreInfoForApi(tenantId: string): Promise<{
  max_bytes: number;
  schema_extensions_resolved: string | null;
  target_database: string;
  last_success: SqlRestoreRunRow | null;
  last_failed: SqlRestoreRunRow | null;
  recent: SqlRestoreRunRow[];
}> {
  const schema = resolveSchemaExtensionsPath();
  await ensureSqlRestoreHistoryTable();
  const [lastOk] = await pool.query<RowDataPacket[]>(
    `SELECT id, file_name, file_size_bytes, status, error_message, target_database,
            apply_schema_extensions, created_at
     FROM sql_restore_runs
     WHERE tenant_id = ? AND status = 'success'
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId]
  );
  const [lastBad] = await pool.query<RowDataPacket[]>(
    `SELECT id, file_name, file_size_bytes, status, error_message, target_database,
            apply_schema_extensions, created_at, mysql_output_excerpt
     FROM sql_restore_runs
     WHERE tenant_id = ? AND status = 'failed'
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId]
  );
  const [rec] = await pool.query<RowDataPacket[]>(
    `SELECT id, file_name, file_size_bytes, status, error_message, target_database,
            apply_schema_extensions, created_at, mysql_output_excerpt
     FROM sql_restore_runs
     WHERE tenant_id = ?
     ORDER BY created_at DESC
     LIMIT 20`,
    [tenantId]
  );
  const map = (r: RowDataPacket): SqlRestoreRunRow => {
    const ex = r.mysql_output_excerpt != null && String(r.mysql_output_excerpt).trim() ? String(r.mysql_output_excerpt) : null;
    return {
      id: r.id as string,
      file_name: r.file_name as string,
      file_size_bytes: Number(r.file_size_bytes ?? 0),
      status: r.status as "success" | "failed",
      error_message: r.error_message != null ? String(r.error_message) : null,
      target_database: r.target_database as string,
      apply_schema_extensions: Number(r.apply_schema_extensions) === 1,
      created_at: String(r.created_at),
      mysql_output_excerpt: ex,
    };
  };
  return {
    max_bytes: getRestoreMaxBytes(),
    schema_extensions_resolved: schema,
    target_database: config.db.database,
    last_success: lastOk[0] ? map(lastOk[0] as RowDataPacket) : null,
    last_failed: lastBad[0] ? map(lastBad[0] as RowDataPacket) : null,
    recent: (rec as RowDataPacket[]).map(map),
  };
}
