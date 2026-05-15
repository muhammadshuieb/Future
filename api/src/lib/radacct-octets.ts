import type { Pool } from "mysql2/promise";
import { hasColumn } from "../db/schemaGuards.js";

/** Bytes expression for one radacct row (handles gigaword columns when present). */
export async function radacctSessionOctetsExpr(pool: Pool, tableAlias?: string): Promise<string> {
  const p = tableAlias ? `${tableAlias}.` : "";
  const gIn = await hasColumn(pool, "radacct", "acctinputgigawords");
  const gOut = await hasColumn(pool, "radacct", "acctoutputgigawords");
  if (gIn && gOut) {
    return `(COALESCE(${p}acctinputoctets,0) + COALESCE(${p}acctinputgigawords,0) * 4294967296) + (COALESCE(${p}acctoutputoctets,0) + COALESCE(${p}acctoutputgigawords,0) * 4294967296)`;
  }
  return `COALESCE(${p}acctinputoctets, 0) + COALESCE(${p}acctoutputoctets, 0)`;
}
