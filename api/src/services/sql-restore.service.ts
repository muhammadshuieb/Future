import { spawn } from "child_process";
import { createReadStream, createWriteStream, existsSync, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipeline } from "stream/promises";
import { createInterface } from "readline";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { invalidateTableExistenceCache } from "../db/table-exists.js";
import { hasTable, invalidateColumnCache } from "../db/schemaGuards.js";
import { syncStaffUsersFromRmManagers } from "./rm-legacy-staff.service.js";

/** حد أقصى ~2GB؛ يضبط عبر RESTORE_MAX_SQL_BYTES ويتوافق مع client_max_body_size في nginx */
const MAX_BYTES = Math.min(
  Math.max(1, parseInt(process.env.RESTORE_MAX_SQL_BYTES ?? `${2 * 1024 * 1024 * 1024}`, 10)),
  2 * 1024 * 1024 * 1024
);

function mysqlBin(): string {
  return (process.env.MYSQL_CLIENT ?? "mysql").trim() || "mysql";
}

/**
 * اكتشاف مسار `sql/schema_extensions.sql` (للعرض فقط — الاستعادة لا تعيد تشغيله).
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

async function runPostRestoreAnalyze(): Promise<void> {
  const targets = ["radacct", "rm_users", "rm_services", "radcheck", "radreply"] as const;
  const existing: string[] = [];
  for (const table of targets) {
    try {
      if (await hasTable(pool, table)) existing.push(table);
    } catch {
      // best effort only
    }
  }
  if (existing.length === 0) return;
  try {
    await pool.query(`ANALYZE TABLE ${existing.map((t) => `\`${t}\``).join(", ")}`);
  } catch (error) {
    // Do not fail restore if ANALYZE has a transient lock/permission issue.
    console.warn("[restore] post-restore ANALYZE skipped", error);
  }
}

async function runPostRestoreManagerSync(): Promise<void> {
  try {
    const out = await syncStaffUsersFromRmManagers(pool, config.defaultTenantId);
    if (out.synced > 0) {
      console.log(`[restore] synced ${out.synced} manager/admin rows from rm_managers`);
    }
  } catch (error) {
    // Keep restore successful even if legacy-manager sync fails.
    console.warn("[restore] post-restore manager sync skipped", error);
  }
}

export type SqlImportResult =
  | {
      ok: true;
      detail: {
        bytes: number;
        restore_report: {
          executed_statements: number;
          ignored_statements: number;
          restored_users: number;
          restored_networks: number;
          restored_packages: number;
          restored_cards: number;
          restored_managers: number;
        };
      };
    }
  | { ok: false; error: string; mysql_output?: string };

type SqlImportOptions = {
  applySchemaExtensions: boolean;
  allowedTables?: string[];
};

function extractTableName(raw: string): string {
  const cleaned = raw.trim().replace(/[`"']/g, "");
  const parts = cleaned.split(".");
  return (parts[parts.length - 1] ?? "").trim().toLowerCase();
}

function collectReferencedTablesFromLine(line: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\b(?:INSERT\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+([`"'A-Za-z0-9_.]+)/gi,
    /\b(?:CREATE|DROP|ALTER|TRUNCATE)\s+TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([`"'A-Za-z0-9_.]+)/gi,
    /\bLOCK\s+TABLES\s+([`"'A-Za-z0-9_.]+)/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null = re.exec(line);
    while (m) {
      const table = extractTableName(m[1] ?? "");
      if (table) out.add(table);
      m = re.exec(line);
    }
  }
  return [...out];
}

async function ensureSqlOnlyTouchesAllowedTables(
  sqlFilePath: string,
  allowedTables: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = new Set(allowedTables.map((t) => t.trim().toLowerCase()).filter(Boolean));
  if (allowed.size === 0) return { ok: true };

  const stream = createReadStream(sqlFilePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber += 1;
    const tables = collectReferencedTablesFromLine(line);
    for (const table of tables) {
      if (!allowed.has(table)) {
        return {
          ok: false,
          error: `table_not_allowed:${table}:line_${lineNumber}`,
        };
      }
    }
  }

  return { ok: true };
}

function statementShouldBeKeptWithoutTableMatch(statement: string): boolean {
  const s = statement.trim();
  if (!s) return false;
  return (
    /^SET\b/i.test(s) ||
    /^USE\b/i.test(s) ||
    /^START\s+TRANSACTION\b/i.test(s) ||
    /^COMMIT\b/i.test(s) ||
    /^ROLLBACK\b/i.test(s) ||
    /^DELIMITER\b/i.test(s) ||
    /^\/\*![0-9]+\s+SET\b/i.test(s) ||
    /^UNLOCK\s+TABLES\b/i.test(s)
  );
}

function shouldSkipLegacyCharsetRestoreStatement(statement: string): boolean {
  const s = statement.trim();
  return (
    /SET\s+CHARACTER_SET_CLIENT\s*=\s*@OLD_CHARACTER_SET_CLIENT/i.test(s) ||
    /SET\s+CHARACTER_SET_RESULTS\s*=\s*@OLD_CHARACTER_SET_RESULTS/i.test(s) ||
    /SET\s+COLLATION_CONNECTION\s*=\s*@OLD_COLLATION_CONNECTION/i.test(s)
  );
}

function extractInsertTargetTable(statement: string): string | null {
  const m = /\b(?:INSERT\s+INTO|REPLACE\s+INTO)\s+([`"'A-Za-z0-9_.]+)/i.exec(statement);
  if (!m) return null;
  const t = extractTableName(m[1] ?? "");
  return t || null;
}

function estimateInsertedRows(statement: string): number {
  const upper = statement.toUpperCase();
  const valuesIdx = upper.indexOf("VALUES");
  if (valuesIdx < 0) return 0;
  const valuesPart = statement.slice(valuesIdx + "VALUES".length);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let rows = 0;
  for (let i = 0; i < valuesPart.length; i += 1) {
    const ch = valuesPart[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === "(") {
      if (depth === 0) rows += 1;
      depth += 1;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth -= 1;
    }
  }
  return rows;
}

async function buildFilteredSqlForAllowedTables(
  sqlFilePath: string,
  allowedTables: string[]
): Promise<{
  path: string;
  keptStatements: number;
  ignoredStatements: number;
  insertedRowsByTable: Record<string, number>;
}> {
  const allowed = new Set(allowedTables.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const filteredPath = join(tmpdir(), `fr-restore-filtered-${Date.now()}-${process.pid}.sql`);
  const out = createWriteStream(filteredPath, { encoding: "utf8", mode: 0o600 });
  const input = createReadStream(sqlFilePath, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  let buffer = "";
  let keptStatements = 0;
  let ignoredStatements = 0;
  const insertedRowsByTable: Record<string, number> = {};

  const flushStatement = async (statement: string): Promise<void> => {
    const trimmed = statement.trim();
    if (!trimmed) return;
    if (shouldSkipLegacyCharsetRestoreStatement(trimmed)) {
      return;
    }
    const touched = collectReferencedTablesFromLine(statement);
    let keep = false;
    if (touched.length > 0) {
      keep = touched.every((t) => allowed.has(t));
    } else {
      keep = statementShouldBeKeptWithoutTableMatch(trimmed);
    }
    if (!keep) return;
    await new Promise<void>((resolve, reject) => {
      out.write(`${statement.trimEnd()}\n`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    const insertTable = extractInsertTargetTable(statement);
    if (insertTable) {
      insertedRowsByTable[insertTable] = (insertedRowsByTable[insertTable] ?? 0) + estimateInsertedRows(statement);
    }
    keptStatements += 1;
  };

  try {
    for await (const line of rl) {
      buffer += `${line}\n`;
      if (line.trimEnd().endsWith(";")) {
        const beforeKept = keptStatements;
        await flushStatement(buffer);
        if (keptStatements === beforeKept && buffer.trim()) ignoredStatements += 1;
        buffer = "";
      }
    }
    if (buffer.trim()) {
      const beforeKept = keptStatements;
      await flushStatement(buffer);
      if (keptStatements === beforeKept) ignoredStatements += 1;
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }

  return { path: filteredPath, keptStatements, ignoredStatements, insertedRowsByTable };
}

export async function importSqlFilePathIntoAppDatabase(
  sqlFilePath: string,
  options: SqlImportOptions
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
  let importPath = sqlFilePath;
  let filteredTmpPath: string | null = null;
  let restoreReport = {
    executed_statements: 0,
    ignored_statements: 0,
    restored_users: 0,
    restored_networks: 0,
    restored_packages: 0,
    restored_cards: 0,
    restored_managers: 0,
  };
  if ((options.allowedTables?.length ?? 0) > 0) {
    const filtered = await buildFilteredSqlForAllowedTables(sqlFilePath, options.allowedTables ?? []);
    if (filtered.keptStatements === 0) {
      await fs.unlink(filtered.path).catch(() => undefined);
      return { ok: false, error: "no_allowed_tables_found_in_sql" };
    }
    restoreReport = {
      executed_statements: filtered.keptStatements,
      ignored_statements: filtered.ignoredStatements,
      restored_users: filtered.insertedRowsByTable.rm_users ?? 0,
      restored_networks: filtered.insertedRowsByTable.nas ?? 0,
      restored_packages: filtered.insertedRowsByTable.rm_services ?? 0,
      restored_cards: filtered.insertedRowsByTable.rm_cards ?? 0,
      restored_managers: filtered.insertedRowsByTable.rm_managers ?? 0,
    };
    importPath = filtered.path;
    filteredTmpPath = filtered.path;
  }
  const main = await pipeFileToMysql(importPath);
  if (filteredTmpPath) {
    await fs.unlink(filteredTmpPath).catch(() => undefined);
  }
  if (!main.ok) {
    return { ok: false, error: main.error, mysql_output: main.output };
  }
  invalidateTableExistenceCache();
  invalidateColumnCache();
  await runPostRestoreManagerSync();
  await runPostRestoreAnalyze();
  return { ok: true, detail: { bytes: st.size, restore_report: restoreReport } };
}

export async function importSqlBufferIntoAppDatabase(
  buffer: Buffer,
  options: SqlImportOptions
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
    const ex =
      r.mysql_output_excerpt != null && String(r.mysql_output_excerpt).trim()
        ? String(r.mysql_output_excerpt)
        : null;
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
