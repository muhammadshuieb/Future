import fs from "fs";
import path from "path";
import { pool } from "../db/pool.js";
import { invalidateColumnCache } from "../db/schemaGuards.js";

/**
 * Directory containing SQL migration files (ordered by filename prefix).
 * Mounted from repo root via docker-compose at /app/sql, with a local fallback
 * to the source tree so `npm run dev` also works.
 */
function resolveMigrationsDir(): string | null {
  const candidates = [
    process.env.SQL_MIGRATIONS_DIR,
    "/app/sql/migrations",
    path.resolve(process.cwd(), "sql", "migrations"),
    path.resolve(process.cwd(), "..", "sql", "migrations"),
  ].filter((value): value is string => Boolean(value));
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Split a SQL script into individual statements. All our migrations use the
 * standard `;` terminator — no stored-procedure DELIMITER blocks — so a simple
 * splitter that tracks string literals is sufficient.
 */
function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    const next = script[i + 1];
    if (inLineComment) {
      buffer += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      buffer += ch;
      if (ch === "*" && next === "/") {
        buffer += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "-" && next === "-") {
        buffer += ch;
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        buffer += ch + next;
        i++;
        inBlockComment = true;
        continue;
      }
    }
    if (!inDouble && !inBacktick && ch === "'") {
      if (inSingle && script[i - 1] !== "\\") inSingle = false;
      else if (!inSingle) inSingle = true;
      buffer += ch;
      continue;
    }
    if (!inSingle && !inBacktick && ch === '"') {
      if (inDouble && script[i - 1] !== "\\") inDouble = false;
      else if (!inDouble) inDouble = true;
      buffer += ch;
      continue;
    }
    if (!inSingle && !inDouble && ch === "`") {
      inBacktick = !inBacktick;
      buffer += ch;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick && ch === ";") {
      const trimmed = buffer.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  const tail = buffer.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

/** MySQL errors that are normal when re-applying migrations on an already-migrated DB. */
function isBenignMigrationError(err: unknown): boolean {
  const e = err as { errno?: number; code?: string; message?: string };
  const errno = e.errno;
  const code = String(e.code ?? "");
  const msg = String(e.message ?? "").toLowerCase();
  if (
    code === "ER_DUP_FIELDNAME" ||
    code === "ER_DUP_KEYNAME" ||
    code === "ER_TABLE_EXISTS_ERROR" ||
    code === "ER_FK_DUP_NAME"
  ) {
    return true;
  }
  const benignErrnos = new Set([
    1050, // ER_TABLE_EXISTS_ERROR
    1060, // ER_DUP_FIELDNAME
    1061, // ER_DUP_KEYNAME
    1826, // duplicate foreign key constraint name (MySQL 8+)
  ]);
  if (errno !== undefined && benignErrnos.has(errno)) return true;
  if (
    msg.includes("duplicate column name") ||
    msg.includes("duplicate key name") ||
    msg.includes("duplicate foreign key constraint name") ||
    msg.includes("duplicate key") ||
    (msg.includes("already exists") && (msg.includes("table") || msg.includes("database")))
  ) {
    return true;
  }
  return false;
}

/**
 * Apply all idempotent SQL migrations in filename order. Each statement is
 * executed independently so a broken migration does not block later ones.
 *
 * Migrations are written to be safely re-runnable (conditional ALTER, CREATE
 * TABLE IF NOT EXISTS, etc.), so we simply run them on every boot.
 */
export async function applyAllMigrations(): Promise<{
  ran: number;
  failed: number;
  skipped: number;
  benign: number;
}> {
  const dir = resolveMigrationsDir();
  if (!dir) {
    console.warn("[migrations] no sql/migrations directory found — skipping");
    return { ran: 0, failed: 0, skipped: 0, benign: 0 };
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort();
  let ran = 0;
  let failed = 0;
  let skipped = 0;
  let benignTotal = 0;
  for (const file of files) {
    const full = path.join(dir, file);
    let script: string;
    try {
      script = fs.readFileSync(full, "utf8");
    } catch (error) {
      console.error(`[migrations] read failed ${file}`, error);
      skipped++;
      continue;
    }
    const statements = splitSqlStatements(script);
    if (statements.length === 0) {
      skipped++;
      continue;
    }
    // Use a single connection per file so session-scoped user variables
    // (e.g. `SET @sql = …; PREPARE stmt FROM @sql; EXECUTE stmt;`) share state.
    const conn = await pool.getConnection();
    let perFileFailures = 0;
    try {
      for (const sql of statements) {
        try {
          await conn.query(sql);
        } catch (error) {
          if (isBenignMigrationError(error)) {
            benignTotal++;
          } else {
            perFileFailures++;
            console.error(`[migrations] ${file} statement failed`, {
              message: (error as Error).message,
              snippet: sql.slice(0, 180),
            });
          }
        }
      }
    } finally {
      conn.release();
    }
    if (perFileFailures === 0) ran++;
    else failed++;
  }
  invalidateColumnCache();
  console.log(
    `[migrations] applied=${ran} failed=${failed} skipped=${skipped} benign=${benignTotal} (of ${files.length})`
  );
  return { ran, failed, skipped, benign: benignTotal };
}
