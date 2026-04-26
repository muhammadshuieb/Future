import { spawn } from "child_process";
import { createReadStream, existsSync, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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

async function pipeFileToMysql(sqlPath: string): Promise<string> {
  const args: string[] = [
    "-h",
    config.db.host,
    "-P",
    String(config.db.port),
    "-u",
    config.db.user,
    "--default-character-set=utf8mb4",
    config.db.database,
  ];
  const child = spawn(mysqlBin(), args, {
    env: { ...process.env, MYSQL_PWD: config.db.password },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const input = createReadStream(sqlPath);
  input.pipe(child.stdin!);
  let stderr = "";
  child.stderr.on("data", (c: Buffer) => {
    stderr += c.toString("utf8");
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  try {
    await input.close();
  } catch {
    /* ignore */
  }
  if (exitCode !== 0) {
    return stderr || `mysql_exit_${exitCode}`;
  }
  return "";
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
export async function importSqlFilePathIntoAppDatabase(
  sqlFilePath: string,
  options: { applySchemaExtensions: boolean }
): Promise<
  { ok: true; detail: { bytes: number; appliedSchemaExtensions: boolean } } | { ok: false; error: string }
> {
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
  let err: string;
  try {
    err = await pipeFileToMysql(sqlFilePath);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (err) {
    return { ok: false, error: err.slice(0, 8000) };
  }
  let appliedSchemaExtensions = false;
  if (options.applySchemaExtensions) {
    const ext = resolveSchemaExtensionsPath();
    if (!ext) {
      return { ok: false, error: "schema_extensions_not_found" };
    }
    try {
      err = await pipeFileToMysql(ext);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (err) {
      return { ok: false, error: `schema_extensions_failed: ${err.slice(0, 4000)}` };
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
): Promise<{ ok: true; detail: { bytes: number; appliedSchemaExtensions: boolean } } | { ok: false; error: string }> {
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
