import { config } from "../config.js";

const FORBIDDEN = new Set(["subscribers", "packages", "nas_servers"]);

export class DmaForbiddenHybridSqlError extends Error {
  readonly table: string;
  constructor(table: string) {
    super(`dma_mode_forbidden_table:${table}`);
    this.name = "DmaForbiddenHybridSqlError";
    this.table = table;
  }
}

/** Strip block and line SQL comments (best-effort) before pattern matching. */
function stripSqlComments(sql: string): string {
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/--[^\n]*/g, " ");
  return s;
}

/**
 * Detects hybrid-table references in executable SQL. Not a full parser; targets common
 * FROM / JOIN / UPDATE / INTO / DELETE FROM shapes.
 */
function findForbiddenTableReference(sql: string): string | null {
  const s = stripSqlComments(sql);
  for (const tbl of FORBIDDEN) {
    const id = `(?:\`${tbl}\`|\\b${tbl}\\b)`;
    const patterns = [
      new RegExp(`\\bFROM\\s+${id}`, "i"),
      new RegExp(`\\bJOIN\\s+${id}`, "i"),
      new RegExp(`\\bINTO\\s+${id}`, "i"),
      new RegExp(`\\bUPDATE\\s+${id}`, "i"),
      new RegExp(`\\bDELETE\\s+FROM\\s+${id}`, "i"),
      new RegExp(`,\\s*${id}\\s+(?:AS\\b|,|WHERE|JOIN|ON|LIMIT|ORDER|GROUP)`, "i"),
    ];
    for (const re of patterns) {
      if (re.test(s)) return tbl;
    }
  }
  return null;
}

export function assertDmaSqlSafe(sql: unknown): void {
  if (!config.dmaMode) return;
  if (sql == null) return;
  const text = typeof sql === "string" ? sql : typeof sql === "object" && sql !== null && "sql" in sql ? String((sql as { sql: unknown }).sql) : "";
  if (!text.trim()) return;
  const hit = findForbiddenTableReference(text);
  if (hit) {
    throw new DmaForbiddenHybridSqlError(hit);
  }
}
