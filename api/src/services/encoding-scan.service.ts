import { randomUUID } from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { hasTable } from "../db/schemaGuards.js";
import {
  analyzeTextCell,
  previewSlice,
  type EncodingAnalysis,
  type RepairStrategy,
} from "../lib/encoding-mojibake.js";
import { writeAuditLog } from "./audit-log.service.js";

const IDENT_RE = /^[a-zA-Z0-9_]+$/;

const DEFAULT_EXCLUDED_TABLES = new Set([
  "encoding_issues",
  "encoding_repair_backups",
  "encoding_scan_runs",
  "radacct",
  "radpostauth",
  "radippool",
  "background_jobs",
  "sessions",
  "radcheck",
  "radreply",
  "radgroupcheck",
  "radgroupreply",
  "radusergroup",
  "nas",
]);

const TEXT_TYPES = new Set([
  "varchar",
  "char",
  "text",
  "tinytext",
  "mediumtext",
  "longtext",
]);

export type ScanParams = {
  tenantId: string;
  staffId?: string | null;
  excludeTables?: string[];
  limitPerTable?: number;
  maxIssues?: number;
  dryRun?: boolean;
};

export type ScanProgress = {
  scanRunId: string;
  rowsScanned: number;
  issuesFound: number;
  tablesCompleted: string[];
  dryRun: boolean;
  dryRunSamples?: Array<{
    table: string;
    column: string;
    rowId: string;
    originalPreview: string;
    proposedPreview: string | null;
    confidence: number;
    status: "open" | "manual_review";
    issueType: string;
  }>;
};

function assertIdent(name: string, ctx: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`invalid_sql_identifier:${ctx}:${name}`);
  }
}

async function tableHasColumn(pool: Pool, table: string, column: string): Promise<boolean> {
  assertIdent(table, "table");
  assertIdent(column, "column");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 AS o FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function getPrimaryKeyColumns(pool: Pool, table: string): Promise<string[]> {
  assertIdent(table, "table");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS c, ORDINAL_POSITION AS o
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = 'PRIMARY'
     ORDER BY ORDINAL_POSITION ASC`,
    [table]
  );
  return rows.map((r) => String(r.c));
}

async function listTextColumns(pool: Pool, exclude: Set<string>): Promise<Array<{ table: string; column: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND DATA_TYPE IN ('varchar','char','text','tinytext','mediumtext','longtext')
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  const out: Array<{ table: string; column: string }> = [];
  for (const r of rows) {
    const t = String(r.t);
    const c = String(r.c);
    const d = String(r.d).toLowerCase();
    if (!TEXT_TYPES.has(d)) continue;
    if (!IDENT_RE.test(t) || !IDENT_RE.test(c)) continue;
    if (exclude.has(t.toLowerCase())) continue;
    out.push({ table: t, column: c });
  }
  return out;
}

function stringifyCell(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean" || typeof val === "bigint") return String(val);
  if (Buffer.isBuffer(val)) return val.toString("utf8");
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function rowIdFromPk(pk: Record<string, unknown>): string {
  const keys = Object.keys(pk).sort();
  return keys.map((k) => `${k}=${String(pk[k] ?? "")}`).join("&");
}

function initialStatusForConfidence(conf: number): "open" | "manual_review" {
  return conf >= 0.52 ? "open" : "manual_review";
}

function issueTypeFromAnalysis(a: EncodingAnalysis): string {
  return a.issueKinds.join(",");
}

function strategyForAnalysis(a: EncodingAnalysis): RepairStrategy | null {
  return a.bestRepair?.strategy ?? null;
}

export async function runEncodingScan(pool: Pool, params: ScanParams): Promise<ScanProgress> {
  const exclude = new Set(DEFAULT_EXCLUDED_TABLES);
  for (const t of params.excludeTables ?? []) {
    if (IDENT_RE.test(t)) exclude.add(t.toLowerCase());
  }
  const limitPerTable = Math.min(Math.max(params.limitPerTable ?? 80_000, 100), 500_000);
  const maxIssues = Math.min(Math.max(params.maxIssues ?? 20_000, 10), 200_000);
  const dryRun = Boolean(params.dryRun);

  if (!(await hasTable(pool, "encoding_issues"))) {
    throw new Error("encoding_tables_missing_run_migrations");
  }

  const scanRunId = randomUUID();
  if (!dryRun) {
    await pool.execute(
      `INSERT INTO encoding_scan_runs (id, tenant_id, status, params_json)
       VALUES (?, ?, 'running', ?)`,
      [scanRunId, params.tenantId, JSON.stringify({ exclude: [...exclude], limitPerTable, maxIssues })]
    );
    await pool.execute(
      `UPDATE encoding_issues SET status = 'superseded', notes = COALESCE(notes,'') WHERE tenant_id <=> ? AND status IN ('open','manual_review')`,
      [params.tenantId]
    );
  }

  const cols = await listTextColumns(pool, exclude);
  let rowsScanned = 0;
  let issuesFound = 0;
  const tablesCompleted: string[] = [];
  const seenTables = new Set<string>();

  const issueBuffer: Array<{
    id: string;
    tenantId: string | null;
    scanRunId: string;
    table: string;
    column: string;
    rowId: string;
    pk: Record<string, unknown>;
    originalPreview: string;
    proposedPreview: string | null;
    issueType: string;
    confidence: number;
    status: "open" | "manual_review";
    repairStrategy: string | null;
  }> = [];

  for (const { table, column } of cols) {
    if (issuesFound >= maxIssues) break;
    assertIdent(table, "scan_table");
    assertIdent(column, "scan_column");

    const hasTenant = await tableHasColumn(pool, table, "tenant_id");
    const isTenantsSelf = table === "tenants";

    const pkCols = await getPrimaryKeyColumns(pool, table);
    if (pkCols.length === 0) continue;

    for (const pkc of pkCols) assertIdent(pkc, "pk");

    const selectCols = new Set<string>([...pkCols, column]);
    if (hasTenant) selectCols.add("tenant_id");
    const selectList = [...selectCols].join(", ");

    let whereClause = "";
    const qParams: unknown[] = [];
    if (isTenantsSelf) {
      whereClause = "WHERE id = ?";
      qParams.push(params.tenantId);
    } else if (hasTenant) {
      whereClause = "WHERE tenant_id = ?";
      qParams.push(params.tenantId);
    }

    let offset = 0;
    const batch = 400;
    while (offset < limitPerTable && issuesFound < maxIssues) {
      const sql = `SELECT ${selectList} FROM \`${table}\` ${whereClause} LIMIT ? OFFSET ?`;
      const execParams = [...qParams, batch, offset];
      const [rows] = await pool.query<RowDataPacket[]>(sql, execParams);
      if (rows.length === 0) break;
      offset += rows.length;
      rowsScanned += rows.length;

      for (const row of rows) {
        if (issuesFound >= maxIssues) break;

        const raw = stringifyCell(row[column]);
        if (raw === null) continue;
        const analysis = analyzeTextCell(raw);
        if (!analysis) continue;

        const pk: Record<string, unknown> = {};
        for (const k of pkCols) pk[k] = row[k];

        const proposed = analysis.bestRepair?.text ?? null;
        const proposedPreview = proposed ? previewSlice(proposed, 500) : null;
        const status = initialStatusForConfidence(analysis.confidence);
        const repairStrategy = strategyForAnalysis(analysis);

        issuesFound++;
        if (dryRun) {
          if (issuesFound <= 500) {
            issueBuffer.push({
              id: randomUUID(),
              tenantId: params.tenantId,
              scanRunId,
              table,
              column,
              rowId: rowIdFromPk(pk),
              pk,
              originalPreview: previewSlice(analysis.original, 500),
              proposedPreview,
              issueType: issueTypeFromAnalysis(analysis),
              confidence: analysis.confidence,
              status,
              repairStrategy,
            });
          }
          continue;
        }

        const issueId = randomUUID();
        await pool.execute(
          `INSERT INTO encoding_issues (
            id, tenant_id, scan_run_id, table_name, column_name, row_id, primary_key_json,
            original_preview, proposed_preview, issue_type, confidence_score, status, repair_strategy
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            issueId,
            params.tenantId,
            scanRunId,
            table,
            column,
            rowIdFromPk(pk),
            JSON.stringify(pk),
            previewSlice(analysis.original, 500),
            proposedPreview,
            issueTypeFromAnalysis(analysis),
            analysis.confidence,
            status,
            repairStrategy,
          ]
        );
      }
      if (rows.length < batch) break;
    }
    if (!seenTables.has(table)) {
      seenTables.add(table);
      tablesCompleted.push(table);
    }
  }

  if (!dryRun) {
    await pool.execute(
      `UPDATE encoding_scan_runs SET finished_at = CURRENT_TIMESTAMP(3), rows_scanned = ?, issues_found = ?, status = 'completed' WHERE id = ?`,
      [rowsScanned, issuesFound, scanRunId]
    );
    await writeAuditLog(pool, {
      tenantId: params.tenantId,
      staffId: params.staffId ?? null,
      action: "encoding_scan_completed",
      entityType: "encoding_scan_run",
      entityId: scanRunId,
      payload: { rowsScanned, issuesFound, tables: tablesCompleted.length },
    });
  }

  return {
    scanRunId,
    rowsScanned,
    issuesFound,
    tablesCompleted,
    dryRun,
    dryRunSamples: dryRun
      ? issueBuffer.map((x) => ({
          table: x.table,
          column: x.column,
          rowId: x.rowId,
          originalPreview: x.originalPreview,
          proposedPreview: x.proposedPreview,
          confidence: x.confidence,
          status: x.status,
          issueType: x.issueType,
        }))
      : undefined,
  };
}

export async function approveEncodingRepair(
  pool: Pool,
  input: {
    tenantId: string;
    staffId?: string | null;
    issueId: string;
    /** When false, only validate and return preview (no writes). */
    commit: boolean;
  }
): Promise<{ ok: boolean; error?: string; preview?: { table: string; column: string; current: string; repaired: string } }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, table_name, column_name, primary_key_json, proposed_preview, repair_strategy, status, repaired
     FROM encoding_issues WHERE id = ? LIMIT 1`,
    [input.issueId]
  );
  if (rows.length === 0) return { ok: false, error: "issue_not_found" };
  const r = rows[0]!;
  if (String(r.tenant_id ?? "") !== input.tenantId) return { ok: false, error: "tenant_mismatch" };
  if (Number(r.repaired) === 1) return { ok: false, error: "already_repaired" };
  if (String(r.status) === "superseded") return { ok: false, error: "issue_superseded" };
  if (String(r.status) === "ignored") return { ok: false, error: "issue_ignored" };

  const table = String(r.table_name);
  const column = String(r.column_name);
  assertIdent(table, "repair_table");
  assertIdent(column, "repair_column");
  let pk: Record<string, unknown>;
  try {
    pk = typeof r.primary_key_json === "string" ? JSON.parse(r.primary_key_json) : r.primary_key_json;
  } catch {
    return { ok: false, error: "invalid_primary_key_json" };
  }

  const pkCols = Object.keys(pk);
  for (const c of pkCols) assertIdent(c, "repair_pk");

  const whereSql = pkCols.map((c) => `\`${c}\` = ?`).join(" AND ");
  const pkVals = pkCols.map((c) => pk[c]);
  const [curRows] = await pool.query<RowDataPacket[]>(
    `SELECT \`${column}\` AS v FROM \`${table}\` WHERE ${whereSql} LIMIT 1`,
    pkVals
  );
  if (curRows.length === 0) return { ok: false, error: "row_missing" };
  const current = stringifyCell(curRows[0]!.v) ?? "";

  const analysis = analyzeTextCell(current);
  const repaired = analysis?.bestRepair?.text ?? "";
  if (!repaired || repaired === current) {
    return {
      ok: false,
      error: "no_safe_repair",
      preview: { table, column, current, repaired },
    };
  }

  if (!input.commit) {
    return {
      ok: true,
      preview: { table, column, current, repaired },
    };
  }

  const backupId = randomUUID();
  await pool.execute(
    `INSERT INTO encoding_repair_backups (id, issue_id, original_value) VALUES (?,?,?)`,
    [backupId, input.issueId, current]
  );

  await pool.execute(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE ${whereSql}`, [
    repaired,
    ...(pkVals as Array<string | number | null | bigint>),
  ]);
  await pool.execute(
    `UPDATE encoding_issues SET repaired = 1, repaired_at = CURRENT_TIMESTAMP(3), repaired_by = ?, status = 'repaired' WHERE id = ?`,
    [input.staffId ?? null, input.issueId]
  );

  await writeAuditLog(pool, {
    tenantId: input.tenantId,
    staffId: input.staffId ?? null,
    action: "encoding_repair_applied",
    entityType: "encoding_issue",
    entityId: input.issueId,
    payload: { table, column, backup_id: backupId, strategy: r.repair_strategy },
  });

  return { ok: true, preview: { table, column, current, repaired } };
}

export async function rollbackEncodingRepair(
  pool: Pool,
  input: { tenantId: string; staffId?: string | null; issueId: string }
): Promise<{ ok: boolean; error?: string }> {
  const [issues] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, table_name, column_name, primary_key_json, repaired FROM encoding_issues WHERE id = ? LIMIT 1`,
    [input.issueId]
  );
  if (issues.length === 0) return { ok: false, error: "issue_not_found" };
  const iss = issues[0]!;
  if (String(iss.tenant_id ?? "") !== input.tenantId) return { ok: false, error: "tenant_mismatch" };
  if (Number(iss.repaired) !== 1) return { ok: false, error: "not_repaired" };

  const table = String(iss.table_name);
  const column = String(iss.column_name);
  assertIdent(table, "rollback_table");
  assertIdent(column, "rollback_column");
  let pk: Record<string, unknown>;
  try {
    pk = typeof iss.primary_key_json === "string" ? JSON.parse(iss.primary_key_json) : iss.primary_key_json;
  } catch {
    return { ok: false, error: "invalid_primary_key_json" };
  }
  const pkCols = Object.keys(pk);
  for (const c of pkCols) assertIdent(c, "rollback_pk");
  const whereSql = pkCols.map((c) => `\`${c}\` = ?`).join(" AND ");
  const pkVals = pkCols.map((c) => pk[c]);

  const [backs] = await pool.query<RowDataPacket[]>(
    `SELECT id, original_value FROM encoding_repair_backups WHERE issue_id = ? ORDER BY created_at DESC LIMIT 1`,
    [input.issueId]
  );
  if (backs.length === 0) return { ok: false, error: "backup_missing" };
  const original = String(backs[0]!.original_value ?? "");

  await pool.execute(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE ${whereSql}`, [
    original,
    ...(pkVals as Array<string | number | null | bigint>),
  ]);
  await pool.execute(
    `UPDATE encoding_issues SET repaired = 0, repaired_at = NULL, repaired_by = NULL, status = 'open' WHERE id = ?`,
    [input.issueId]
  );

  await writeAuditLog(pool, {
    tenantId: input.tenantId,
    staffId: input.staffId ?? null,
    action: "encoding_repair_rolled_back",
    entityType: "encoding_issue",
    entityId: input.issueId,
    payload: { table, column, backup_id: backs[0]!.id },
  });

  return { ok: true };
}

export async function ignoreEncodingIssue(
  pool: Pool,
  input: { tenantId: string; staffId?: string | null; issueId: string }
): Promise<void> {
  await pool.execute(
    `UPDATE encoding_issues SET status = 'ignored', notes = 'ignored_by_operator' WHERE id = ? AND tenant_id <=> ? AND repaired = 0`,
    [input.issueId, input.tenantId]
  );
  await writeAuditLog(pool, {
    tenantId: input.tenantId,
    staffId: input.staffId ?? null,
    action: "encoding_issue_ignored",
    entityType: "encoding_issue",
    entityId: input.issueId,
    payload: {},
  });
}
